import type { Codex as CodexClient, ModelReasoningEffort, Thread, UserInput } from "@openai/codex-sdk";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverCodexProjects } from "./services/codexDiscovery";
import { codexInputWithAttachments, safeCodexAttachmentName } from "./services/codexAttachments";
import { discoverCodexThreads } from "./services/codexThreadDiscovery";

type WorkerConfig = {
  serviceUrl: string;
  token: string;
  workerId: string;
  pollMs: number;
  syncMs: number;
  heartbeatMs: number;
  networkAccessEnabled: boolean;
  maxAttachmentBytes: number;
};

type WorkerJob = {
  id: string;
  prompt: string;
  threadId?: string | null;
  model?: string | null;
  reasoningEffort?: ModelReasoningEffort | null;
  project: { alias: string; path: string };
  attachments: Array<{
    id: string;
    kind: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number | null;
  }>;
};

loadLocalWorkerEnv();

const config = workerConfig();
let codex: CodexClient;
let stopping = false;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

void runWorker().catch((error) => {
  console.error(`[codex-worker] Fatal: ${errorMessage(error)}`);
  process.exitCode = 1;
});

async function runWorker(): Promise<void> {
  const { Codex } = await loadCodexSdk();
  codex = new Codex();
  console.log(`[codex-worker] Starting ${config.workerId}.`);
  console.log(`[codex-worker] Relay: ${config.serviceUrl}`);
  let nextSyncAt = 0;

  while (!stopping) {
    try {
      if (Date.now() >= nextSyncAt) {
        const projects = await discoverCodexProjects();
        if (projects.length === 0) {
          console.warn("[codex-worker] Discovery returned no projects; keeping the server registry unchanged.");
        } else {
          let threads;
          try {
            threads = await discoverCodexThreads(projects.map((project) => project.path));
          } catch (error) {
            console.warn(`[codex-worker] Task discovery failed; keeping the server task registry unchanged: ${errorMessage(error)}`);
          }
          const response = await workerRequest<{
            projects: Array<{ alias: string; path: string }>;
            threadCount?: number;
          }>("/codex/worker/sync", {
            workerId: config.workerId,
            projects,
            threads
          });
          console.log(`[codex-worker] Synced ${response.projects.length} projects.`);
          if (response.threadCount !== undefined) {
            console.log(`[codex-worker] Synced ${response.threadCount} Codex tasks.`);
          }
        }
        nextSyncAt = Date.now() + config.syncMs;
      }

      const job = await claimJob();
      if (!job) {
        await delay(config.pollMs);
        continue;
      }

      await executeJob(job);
    } catch (error) {
      console.error(`[codex-worker] Relay error: ${errorMessage(error)}`);
      await delay(Math.max(config.pollMs, 5_000));
    }
  }

  console.log("[codex-worker] Stopped.");
}

async function claimJob(): Promise<WorkerJob | undefined> {
  const response = await fetch(workerUrl("/codex/worker/claim"), {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({ workerId: config.workerId })
  });
  if (response.status === 204) return undefined;
  if (!response.ok) throw new Error(`Claim failed (${response.status}): ${await safeResponseText(response)}`);
  return await response.json() as WorkerJob;
}

async function executeJob(job: WorkerJob): Promise<void> {
  console.log(`[codex-worker] Running ${job.id} in ${job.project.alias}.`);
  let thread: Thread | undefined;
  let attachmentDirectory: string | undefined;
  const heartbeat = startJobHeartbeat(job.id);
  try {
    let finalResponse: string;
    try {
      assertRunnableProject(job.project.path);
      const prepared = await prepareJobInput(job);
      attachmentDirectory = prepared.directory;
      const options = {
        workingDirectory: job.project.path,
        sandboxMode: "workspace-write" as const,
        approvalPolicy: "never" as const,
        networkAccessEnabled: config.networkAccessEnabled,
        model: job.model ?? undefined,
        modelReasoningEffort: job.reasoningEffort ?? undefined,
        additionalDirectories: attachmentDirectory ? [attachmentDirectory] : undefined
      };
      thread = job.threadId ? codex.resumeThread(job.threadId, options) : codex.startThread(options);
      const result = await thread.run(prepared.input);
      finalResponse = result.finalResponse;
    } catch (error) {
      const message = errorMessage(error);
      console.error(`[codex-worker] Job ${job.id} failed: ${message}`);
      await terminalRequestUntilAccepted(`/codex/worker/jobs/${encodeURIComponent(job.id)}/fail`, {
        workerId: config.workerId,
        error: message,
        threadId: thread?.id ?? undefined
      }, job.id, "failure");
      return;
    }

    await terminalRequestUntilAccepted(`/codex/worker/jobs/${encodeURIComponent(job.id)}/complete`, {
      workerId: config.workerId,
      finalResponse,
      threadId: thread.id ?? undefined
    }, job.id, "completion");
    console.log(`[codex-worker] Completed ${job.id}.`);
  } finally {
    clearInterval(heartbeat);
    if (attachmentDirectory) {
      try {
        await rm(attachmentDirectory, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[codex-worker] Could not remove temporary attachments for ${job.id}: ${errorMessage(error)}`);
      }
    }
  }
}

async function terminalRequestUntilAccepted(
  path: string,
  body: unknown,
  jobId: string,
  outcome: "completion" | "failure"
): Promise<void> {
  let retryMs = 1_000;
  while (!stopping) {
    try {
      const response = await fetch(workerUrl(path), {
        method: "POST",
        headers: workerHeaders(),
        body: JSON.stringify(body)
      });
      if (response.ok) return;
      const detail = await safeResponseText(response);
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`${outcome} report was rejected (${response.status}): ${detail}`);
      }
      throw new RetryableTerminalReportError(`${outcome} report failed (${response.status}): ${detail}`);
    } catch (error) {
      if (!(error instanceof RetryableTerminalReportError) && error instanceof Error && !isNetworkError(error)) {
        throw error;
      }
      console.warn(
        `[codex-worker] Could not relay ${outcome} for ${jobId}; retrying in ${retryMs}ms: ${errorMessage(error)}`
      );
      await delay(retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }
  throw new Error(`Worker stopped before the ${outcome} report for ${jobId} was accepted.`);
}

class RetryableTerminalReportError extends Error {}

function isNetworkError(error: Error): boolean {
  return error instanceof TypeError || /fetch|network|socket|connect|timed?\s*out/i.test(error.message);
}

function startJobHeartbeat(jobId: string): NodeJS.Timeout {
  let active = false;
  return setInterval(() => {
    if (active) return;
    active = true;
    void workerRequest(`/codex/worker/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      workerId: config.workerId
    }).catch((error) => {
      console.warn(`[codex-worker] Heartbeat failed for ${jobId}: ${errorMessage(error)}`);
    }).finally(() => {
      active = false;
    });
  }, config.heartbeatMs);
}

async function prepareJobInput(job: WorkerJob): Promise<{ input: string | UserInput[]; directory?: string }> {
  if (!job.attachments?.length) return { input: job.prompt };
  const directory = await mkdtemp(join(tmpdir(), "threadwise-codex-attachments-"));
  const images: UserInput[] = [];
  const files: string[] = [];

  try {
    for (let index = 0; index < job.attachments.length; index += 1) {
      const attachment = job.attachments[index]!;
      if (attachment.fileSize && attachment.fileSize > config.maxAttachmentBytes) {
        throw new Error(`${attachment.fileName} exceeds the configured attachment limit.`);
      }
      const response = await fetch(workerUrl(`/codex/worker/attachments/${encodeURIComponent(attachment.id)}`), {
        headers: workerHeaders()
      });
      if (!response.ok) {
        throw new Error(`Could not download ${attachment.fileName} (${response.status}): ${await safeResponseText(response)}`);
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > config.maxAttachmentBytes) {
        throw new Error(`${attachment.fileName} exceeds the configured attachment limit.`);
      }
      const buffer = await responseBufferWithinLimit(response, config.maxAttachmentBytes);
      if (!buffer) {
        throw new Error(`${attachment.fileName} exceeds the configured attachment limit.`);
      }
      const path = join(directory, safeCodexAttachmentName(attachment.fileName, index));
      await writeFile(path, buffer);
      if (attachment.kind === "image" || attachment.mimeType?.startsWith("image/")) {
        images.push({ type: "local_image", path });
      } else {
        files.push(path);
      }
    }

    return {
      directory,
      input: codexInputWithAttachments(
        job.prompt,
        images.flatMap((input) => input.type === "local_image" ? [input.path] : []),
        files
      )
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function workerRequest<T = { ok: true }>(path: string, body: unknown): Promise<T> {
  const response = await fetch(workerUrl(path), {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${await safeResponseText(response)}`);
  }
  return await response.json() as T;
}

function workerHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${config.token}`,
    "x-threadwise-worker-id": config.workerId,
    "content-type": "application/json"
  };
}

function workerUrl(path: string): string {
  return `${config.serviceUrl}${path}`;
}

function workerConfig(): WorkerConfig {
  const rawUrl = requiredEnv("THREADWISE_CODEX_URL").replace(/\/+$/, "");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("THREADWISE_CODEX_URL must use HTTPS unless it points to localhost.");
  }
  return {
    serviceUrl: rawUrl,
    token: process.env.THREADWISE_CODEX_WORKER_TOKEN?.trim() || requiredEnv("CODEX_WORKER_TOKEN"),
    workerId: process.env.CODEX_WORKER_ID?.trim() || hostname(),
    pollMs: positiveInteger(process.env.CODEX_WORKER_POLL_MS, 3_000, 1_000),
    syncMs: positiveInteger(process.env.CODEX_WORKER_SYNC_MS, 300_000, 30_000),
    heartbeatMs: positiveInteger(process.env.CODEX_WORKER_HEARTBEAT_MS, 30_000, 5_000),
    networkAccessEnabled: /^(?:1|true|yes|on)$/i.test(process.env.CODEX_WORKER_NETWORK_ACCESS ?? ""),
    maxAttachmentBytes: positiveInteger(process.env.CODEX_WORKER_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024, 1_024)
  };
}

function loadLocalWorkerEnv(): void {
  const file = resolve(process.cwd(), ".env.codex-worker");
  if (!existsSync(file) || typeof process.loadEnvFile !== "function") return;
  process.loadEnvFile(file);
}

function isRunnableProject(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, ".git"));
  } catch {
    return false;
  }
}

function assertRunnableProject(path: string): void {
  if (!isRunnableProject(path)) {
    throw new Error(`Project is missing or is no longer a Git repository: ${path}`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 1_000) || response.statusText;
}

async function responseBufferWithinLimit(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function loadCodexSdk(): Promise<typeof import("@openai/codex-sdk")> {
  // Keep native import() intact when this CommonJS project is compiled.
  const nativeImport = new Function("specifier", "return import(specifier)") as
    (specifier: string) => Promise<typeof import("@openai/codex-sdk")>;
  return nativeImport("@openai/codex-sdk");
}
