import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { createInterface, type Interface } from "node:readline";

export type DiscoveredCodexThread = {
  threadId: string;
  path: string;
  title: string;
  preview?: string;
  source: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

type AppServerThread = {
  id?: unknown;
  cwd?: unknown;
  name?: unknown;
  preview?: unknown;
  source?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  recencyAt?: unknown;
};

type AppServerListResponse = {
  data?: unknown;
  nextCursor?: unknown;
};

const INTERACTIVE_THREAD_SOURCES = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown"
] as const;
const MAX_DISCOVERED_THREADS = 5_000;

export async function discoverCodexThreads(
  projectPaths: string[],
  executable = configuredCodexExecutable()
): Promise<DiscoveredCodexThread[]> {
  const paths = uniquePaths(projectPaths);
  if (paths.length === 0) return [];

  const client = new AppServerClient(executable);
  try {
    await client.initialize();
    const found: DiscoveredCodexThread[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.request<AppServerListResponse>("thread/list", {
        cursor,
        limit: 100,
        sortKey: "recency_at",
        sortDirection: "desc",
        sourceKinds: [...INTERACTIVE_THREAD_SOURCES],
        cwd: paths
      });
      const page = normalizeAppServerThreads(result.data);
      found.push(...page);
      cursor = typeof result.nextCursor === "string" && result.nextCursor
        ? result.nextCursor
        : undefined;
    } while (cursor && found.length < MAX_DISCOVERED_THREADS);

    return deduplicateThreads(found).slice(0, MAX_DISCOVERED_THREADS);
  } finally {
    client.close();
  }
}

export function normalizeAppServerThreads(value: unknown): DiscoveredCodexThread[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const thread = item as AppServerThread;
    if (typeof thread.id !== "string" || !thread.id.trim()) return [];
    if (typeof thread.cwd !== "string" || !thread.cwd.trim()) return [];

    const rawPreview = typeof thread.preview === "string" ? thread.preview : undefined;
    const preview = cleanText(rawPreview, 1_000);
    const title = threadTitle(thread.name, rawPreview, thread.id);
    const status = threadStatus(thread.status);
    const createdAt = epochSecondsToIso(thread.createdAt);
    const updatedAt = epochSecondsToIso(thread.recencyAt)
      ?? epochSecondsToIso(thread.updatedAt)
      ?? createdAt;

    return [{
      threadId: thread.id.trim(),
      path: normalize(thread.cwd.trim()),
      title,
      preview,
      source: cleanText(thread.source, 40) ?? "unknown",
      status,
      createdAt,
      updatedAt
    }];
  });
}

export function threadTitle(name: unknown, preview: string | undefined, threadId: string): string {
  const explicitName = cleanText(name, 160);
  if (explicitName) return explicitName;
  const firstLine = cleanText(preview?.split(/\r?\n/, 1)[0], 160);
  if (firstLine) return firstLine;
  return `Untitled task ${shortThreadId(threadId)}`;
}

export function shortThreadId(threadId: string): string {
  return threadId.replace(/-/g, "").slice(0, 8);
}

class AppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private stderr = "";
  private closed = false;

  constructor(executable: string) {
    this.child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4_000);
    });
    this.child.stdin.on("error", (error) => this.rejectAll(error));
    this.child.once("error", (error) => this.rejectAll(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed) return;
      this.rejectAll(new Error(
        `Codex app-server exited before responding (${code ?? signal ?? "unknown"}). ${this.stderr}`.trim()
      ));
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "threadwise-worker",
        title: "Threadwise Telegram worker",
        version: "1.0.0"
      }
    });
    this.notify("initialized", {});
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Codex app-server is closed."));
    const id = this.nextId++;
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
    });
    this.write({ method, id, params });
    return withTimeout(response, 60_000, `Codex app-server ${method} timed out.`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.rejectAll(new Error("Codex app-server closed."));
    this.child.kill();
  }

  private notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`Codex app-server request failed: ${JSON.stringify(message.error)}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function configuredCodexExecutable(): string {
  const override = process.env.CODEX_WORKER_EXECUTABLE?.trim();
  if (override) {
    if (!existsSync(override)) throw new Error(`CODEX_WORKER_EXECUTABLE does not exist: ${override}`);
    return override;
  }

  const target = platformTarget();
  const packageJson = require.resolve(`${target.packageName}/package.json`);
  const executable = join(
    dirname(packageJson),
    "vendor",
    target.triple,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex"
  );
  if (!existsSync(executable)) {
    throw new Error(`Bundled Codex executable was not found: ${executable}`);
  }
  return executable;
}

function platformTarget(): { packageName: string; triple: string } {
  const key = `${process.platform}-${process.arch}`;
  const targets: Record<string, { packageName: string; triple: string }> = {
    "win32-x64": { packageName: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc" },
    "win32-arm64": { packageName: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc" },
    "linux-x64": { packageName: "@openai/codex-linux-x64", triple: "x86_64-unknown-linux-musl" },
    "linux-arm64": { packageName: "@openai/codex-linux-arm64", triple: "aarch64-unknown-linux-musl" },
    "darwin-x64": { packageName: "@openai/codex-darwin-x64", triple: "x86_64-apple-darwin" },
    "darwin-arm64": { packageName: "@openai/codex-darwin-arm64", triple: "aarch64-apple-darwin" }
  };
  const target = targets[key];
  if (!target) throw new Error(`Unsupported Codex worker platform: ${key}`);
  return target;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.flatMap((path) => {
    const normalizedPath = normalize(path.trim());
    const key = normalizedPath.toLowerCase();
    if (!normalizedPath || seen.has(key)) return [];
    seen.add(key);
    return [normalizedPath];
  });
}

function deduplicateThreads(threads: DiscoveredCodexThread[]): DiscoveredCodexThread[] {
  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (seen.has(thread.threadId)) return false;
    seen.add(thread.threadId);
    return true;
  });
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return Array.from(clean).slice(0, maxLength).join("");
}

function threadStatus(value: unknown): string | undefined {
  if (typeof value === "string") return cleanText(value, 40);
  if (!value || typeof value !== "object") return undefined;
  return cleanText((value as { type?: unknown }).type, 40);
}

function epochSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
