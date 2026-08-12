import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { codexSubprocessEnvironment } from "./codexSubprocessEnv";

export type GeminiCliCapability = {
  geminiAvailable: boolean;
  geminiVersion?: string;
  geminiModel?: string;
  error?: string;
};

type GeminiInvocation = {
  executable: string;
  prefixArgs: string[];
};

let cachedInvocation: GeminiInvocation | undefined;

export async function detectGeminiCli(model: string): Promise<GeminiCliCapability> {
  try {
    const invocation = await resolveGeminiInvocation();
    const result = await runProcess(invocation, ["--version"], {
      timeoutMs: 15_000,
      maximumOutputBytes: 20_000
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `Gemini CLI exited with code ${result.exitCode}.`);
    }
    return {
      geminiAvailable: true,
      geminiVersion: firstNonEmptyLine(result.stdout) ?? "installed",
      geminiModel: model
    };
  } catch (error) {
    return {
      geminiAvailable: false,
      geminiModel: model,
      error: errorMessage(error)
    };
  }
}

export async function runGeminiPrompt(input: {
  prompt: string;
  model: string;
  timeoutMs: number;
  workingDirectory: string;
}): Promise<string> {
  const invocation = await resolveGeminiInvocation();
  const result = await runProcess(invocation, [
    "--model", input.model,
    "--approval-mode", "plan",
    "-e", "none",
    "--output-format", "json",
    "-p", input.prompt
  ], {
    cwd: input.workingDirectory,
    timeoutMs: input.timeoutMs,
    maximumOutputBytes: 1_000_000
  });
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim()
      || result.stdout.trim()
      || `Gemini CLI exited with code ${result.exitCode}.`
    );
  }
  return extractGeminiResponse(result.stdout);
}

// Keep the existing idea-worker API stable while sharing the hardened,
// tool-disabled Gemini invocation with other private worker jobs.
export const runGeminiIdeaPrompt = runGeminiPrompt;

export function extractGeminiResponse(stdout: string): string {
  const clean = stripAnsi(stdout).trim();
  if (!clean) throw new Error("Gemini CLI returned no output.");
  try {
    const parsed = JSON.parse(clean) as Record<string, unknown>;
    for (const key of ["response", "text", "output", "result"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const candidates = parsed.candidates;
    if (Array.isArray(candidates)) {
      const text = candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const content = (candidate as { content?: unknown }).content;
        if (!content || typeof content !== "object") return [];
        const parts = (content as { parts?: unknown }).parts;
        if (!Array.isArray(parts)) return [];
        return parts.flatMap((part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? [(part as { text: string }).text]
            : []
        );
      }).join("\n").trim();
      if (text) return text;
    }
  } catch {
    // Older CLI versions can emit plain text even when JSON output is requested.
  }
  return clean;
}

async function resolveGeminiInvocation(): Promise<GeminiInvocation> {
  if (cachedInvocation) return cachedInvocation;
  const override = process.env.GEMINI_WORKER_EXECUTABLE?.trim();
  if (override) {
    if (!isAbsolute(override) || !existsSync(override)) {
      throw new Error(`GEMINI_WORKER_EXECUTABLE does not exist: ${override}`);
    }
    cachedInvocation = invocationForPath(override);
    return cachedInvocation;
  }

  const localPackage = resolvePackageJson();
  if (localPackage) {
    cachedInvocation = invocationFromPackage(localPackage);
    return cachedInvocation;
  }

  const npmRoot = await globalNpmRoot();
  const globalPackage = join(npmRoot, "@google", "gemini-cli", "package.json");
  if (!existsSync(globalPackage)) {
    throw new Error("Gemini CLI is not installed. Run: npm install -g @google/gemini-cli@latest");
  }
  cachedInvocation = invocationFromPackage(globalPackage);
  return cachedInvocation;
}

function resolvePackageJson(): string | undefined {
  try {
    return require.resolve("@google/gemini-cli/package.json");
  } catch {
    return undefined;
  }
}

function invocationFromPackage(packageJsonPath: string): GeminiInvocation {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relativeBin = typeof packageJson.bin === "string"
    ? packageJson.bin
    : packageJson.bin?.gemini ?? Object.values(packageJson.bin ?? {})[0];
  if (!relativeBin) throw new Error(`Gemini CLI package has no executable: ${packageJsonPath}`);
  const executable = resolve(dirname(packageJsonPath), relativeBin);
  if (!existsSync(executable)) throw new Error(`Gemini CLI executable was not found: ${executable}`);
  return invocationForPath(executable);
}

function invocationForPath(path: string): GeminiInvocation {
  const extension = extname(path).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return { executable: process.execPath, prefixArgs: [path] };
  }
  if (extension === ".cmd" || extension === ".bat") {
    throw new Error(
      "Point GEMINI_WORKER_EXECUTABLE to the Gemini CLI JavaScript entry file, not its .cmd wrapper."
    );
  }
  return { executable: path, prefixArgs: [] };
}

async function globalNpmRoot(): Promise<string> {
  const command = process.platform === "win32"
    ? { executable: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm root -g"] }
    : { executable: "npm", args: ["root", "-g"] };
  const result = await runProcess(
    { executable: command.executable, prefixArgs: command.args },
    [],
    { timeoutMs: 15_000, maximumOutputBytes: 20_000 }
  );
  const root = firstNonEmptyLine(result.stdout);
  if (result.exitCode !== 0 || !root) {
    throw new Error(result.stderr || "Could not locate the global npm package directory.");
  }
  return root;
}

async function runProcess(
  invocation: GeminiInvocation,
  args: string[],
  options: { cwd?: string; timeoutMs: number; maximumOutputBytes: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(invocation.executable, [...invocation.prefixArgs, ...args], {
      cwd: options.cwd,
      env: codexSubprocessEnvironment(process.env, process.execPath, [
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS"
      ]),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      settled = true;
      reject(new Error(`Gemini CLI timed out after ${Math.round(options.timeoutMs / 1_000)} seconds.`));
    }, options.timeoutMs);

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maximumOutputBytes) {
        child.kill();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Gemini CLI produced more output than the worker safety limit."));
        }
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function firstNonEmptyLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
