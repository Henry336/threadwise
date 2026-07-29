import type { Codex as CodexClient, ModelReasoningEffort, Thread, UserInput } from "@openai/codex-sdk";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverCodexProjects } from "./services/codexDiscovery";
import { codexInputWithAttachments, safeCodexAttachmentName } from "./services/codexAttachments";
import { discoverCodexThreads } from "./services/codexThreadDiscovery";
import { detectGeminiCli, runGeminiIdeaPrompt } from "./services/geminiCli";
import {
  captureTrustedGitSnapshot,
  publishTrustedCodexChanges,
  type TrustedGitSnapshot,
  type TrustedPublishEvent,
  type TrustedPublishResult
} from "./services/trustedGitPublisher";
import {
  createSafeFileSnapshot,
  parseFileRoots,
  searchLaptopFiles,
  validateConfiguredFileRoots,
  type LocalFileMetadata
} from "./services/fileCourierLocal";

type WorkerConfig = {
  serviceUrl: string;
  token: string;
  workerId: string;
  pollMs: number;
  syncMs: number;
  heartbeatMs: number;
  networkAccessEnabled: boolean;
  maxAttachmentBytes: number;
  geminiModel: string;
  geminiTimeoutMs: number;
  geminiWorkingDirectory: string;
  publishCheckTimeoutMs: number;
  publishGithubTimeoutMs: number;
  fileRoots: string[];
  fileMaxBytes: number;
  fileScanLimit: number;
};

type WorkerJob = {
  id: string;
  prompt: string;
  threadId?: string | null;
  model?: string | null;
  reasoningEffort?: ModelReasoningEffort | null;
  threadTitle?: string | null;
  publishRequested?: boolean;
  publishAutoMerge?: boolean;
  project: { alias: string; path: string };
  attachments: Array<{
    id: string;
    kind: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number | null;
  }>;
};

type GeminiIdeaWorkerJob = {
  id: string;
  prompt: string;
  model?: string | null;
};

type FileCourierWorkerJob = {
  id: string;
  kind: "SEARCH" | "RECENT" | "LOOKUP" | "SEND";
  query?: string | null;
  sortLatest: boolean;
  maxBytes: number;
  selected?: {
    path: string;
    fileName: string;
    parentPath?: string | null;
    sizeBytes: number;
    modifiedAt: string;
    identityKey: string;
    mimeType?: string | null;
    fileType?: string | null;
  };
};

loadLocalWorkerEnv();

const config = workerConfig();
let codex: CodexClient;
let stopping = false;
let fileCourierAvailable = false;
let fileCourierError: string | undefined;

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
  await refreshFileCourierReadiness();
  const fileCourierLoop = runFileCourierLoop();
  let nextSyncAt = 0;

  while (!stopping) {
    try {
      if (Date.now() >= nextSyncAt) {
        const projects = await discoverCodexProjects();
        let threads;
        if (projects.length === 0) {
          console.warn("[codex-worker] Discovery returned no projects; keeping the server registry unchanged.");
        } else {
          try {
            threads = await discoverCodexThreads(projects.map((project) => project.path));
          } catch (error) {
            console.warn(`[codex-worker] Task discovery failed; keeping the server task registry unchanged: ${errorMessage(error)}`);
          }
        }
        await refreshFileCourierReadiness();
        const geminiCapabilities = await detectGeminiCli(config.geminiModel);
        const capabilities = {
          ...geminiCapabilities,
          fileCourierAvailable,
          fileRootCount: config.fileRoots.length,
          fileCourierMaxBytes: config.fileMaxBytes,
          fileCourierError
        };
        const response = await workerRequest<{
          projects: Array<{ alias: string; path: string }>;
          threadCount?: number;
        }>("/codex/worker/sync", {
          workerId: config.workerId,
          projects,
          threads,
          capabilities
        });
        console.log(`[codex-worker] Synced ${response.projects.length} projects.`);
        if (response.threadCount !== undefined) {
          console.log(`[codex-worker] Synced ${response.threadCount} Codex tasks.`);
        }
        nextSyncAt = Date.now() + config.syncMs;
      }

      const job = await claimJob();
      if (job) {
        await executeJob(job);
        continue;
      }
      const ideaJob = await claimGeminiIdeaJob();
      if (ideaJob) {
        await executeGeminiIdeaJob(ideaJob);
        continue;
      }
      await delay(config.pollMs);
    } catch (error) {
      console.error(`[codex-worker] Relay error: ${errorMessage(error)}`);
      await delay(Math.max(config.pollMs, 5_000));
    }
  }

  await fileCourierLoop;
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

async function runFileCourierLoop(): Promise<void> {
  while (!stopping) {
    if (!fileCourierAvailable) {
      await delay(Math.max(config.pollMs, 5_000));
      continue;
    }
    try {
      const job = await claimFileCourierJob();
      if (!job) {
        await delay(config.pollMs);
        continue;
      }
      await executeFileCourierJob(job);
    } catch (error) {
      console.error(`[file-courier] Relay error: ${errorMessage(error)}`);
      await delay(Math.max(config.pollMs, 5_000));
    }
  }
}

async function claimFileCourierJob(): Promise<FileCourierWorkerJob | undefined> {
  const response = await fetch(workerUrl("/files/worker/claim"), {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({ workerId: config.workerId })
  });
  if (response.status === 204) return undefined;
  if (!response.ok) {
    throw new Error(`File claim failed (${response.status}): ${await safeResponseText(response)}`);
  }
  return await response.json() as FileCourierWorkerJob;
}

async function executeFileCourierJob(job: FileCourierWorkerJob): Promise<void> {
  console.log(`[file-courier] Running ${job.kind.toLowerCase()} request ${job.id}.`);
  const heartbeat = startFileCourierHeartbeat(job.id);
  try {
    if (job.kind === "SEND") {
      await executeFileSend(job);
    } else {
      const results = await searchLaptopFiles({
        roots: config.fileRoots,
        kind: job.kind,
        query: job.query ?? undefined,
        maxBytes: effectiveFileLimit(job),
        scanLimit: config.fileScanLimit,
        take: 8
      });
      await terminalRequestUntilAccepted(
        `/files/worker/jobs/${encodeURIComponent(job.id)}/complete`,
        { workerId: config.workerId, results: results.map(serializableFileMetadata) },
        job.id,
        "file lookup completion"
      );
      console.log(`[file-courier] Found ${results.length} result(s) for ${job.id}.`);
    }
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[file-courier] Request ${job.id} failed: ${message}`);
    await terminalRequestUntilAccepted(
      `/files/worker/jobs/${encodeURIComponent(job.id)}/fail`,
      { workerId: config.workerId, error: message },
      job.id,
      "file failure"
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function executeFileSend(job: FileCourierWorkerJob): Promise<void> {
  if (!job.selected) throw new Error("The server did not provide selected file metadata.");
  const snapshot = await createSafeFileSnapshot({
    path: job.selected.path,
    roots: config.fileRoots,
    maxBytes: effectiveFileLimit(job),
    expected: {
      sizeBytes: job.selected.sizeBytes,
      modifiedAt: job.selected.modifiedAt,
      identityKey: job.selected.identityKey
    }
  });
  try {
    const response = await fetch(
      workerUrl(`/files/worker/jobs/${encodeURIComponent(job.id)}/content`),
      {
        method: "POST",
        headers: {
          ...workerAuthHeaders(),
          "content-type": "application/x-threadwise-file",
          "content-length": String(snapshot.metadata.sizeBytes)
        },
        body: snapshot.stream(),
        duplex: "half"
      } as RequestInit & { duplex: "half" }
    );
    if (!response.ok) {
      throw new Error(`File delivery failed (${response.status}): ${await safeResponseText(response)}`);
    }
    await snapshot.verifyUnchanged();
    console.log(`[file-courier] Delivered ${snapshot.metadata.fileName} for ${job.id}.`);
  } finally {
    await snapshot.cleanup();
  }
}

function effectiveFileLimit(job: FileCourierWorkerJob): number {
  return Number.isSafeInteger(job.maxBytes) && job.maxBytes >= 1_024
    ? Math.min(config.fileMaxBytes, job.maxBytes)
    : config.fileMaxBytes;
}

function serializableFileMetadata(metadata: LocalFileMetadata): LocalFileMetadata {
  return metadata;
}

function startFileCourierHeartbeat(jobId: string): NodeJS.Timeout {
  let active = false;
  return setInterval(() => {
    if (active) return;
    active = true;
    void workerRequest(`/files/worker/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      workerId: config.workerId
    }).catch((error) => {
      console.warn(`[file-courier] Heartbeat failed for ${jobId}: ${errorMessage(error)}`);
    }).finally(() => {
      active = false;
    });
  }, config.heartbeatMs);
}

async function refreshFileCourierReadiness(): Promise<void> {
  if (!config.fileRoots.length) {
    fileCourierAvailable = false;
    fileCourierError = "THREADWISE_FILE_ROOTS is empty.";
    return;
  }
  try {
    await validateConfiguredFileRoots(config.fileRoots);
    fileCourierAvailable = true;
    fileCourierError = undefined;
  } catch (error) {
    fileCourierAvailable = false;
    fileCourierError = errorMessage(error);
  }
}

async function claimGeminiIdeaJob(): Promise<GeminiIdeaWorkerJob | undefined> {
  const response = await fetch(workerUrl("/codex/worker/idea-jobs/claim"), {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({ workerId: config.workerId })
  });
  if (response.status === 204) return undefined;
  if (!response.ok) {
    throw new Error(`Gemini idea claim failed (${response.status}): ${await safeResponseText(response)}`);
  }
  return await response.json() as GeminiIdeaWorkerJob;
}

async function executeJob(job: WorkerJob): Promise<void> {
  console.log(`[codex-worker] Running ${job.id} in ${job.project.alias}.`);
  let thread: Thread | undefined;
  let attachmentDirectory: string | undefined;
  const heartbeat = startJobHeartbeat(job.id);
  try {
    let finalResponse: string;
    let publishSnapshot: TrustedGitSnapshot | undefined;
    let publishPreflightError: string | undefined;
    let publishResult: TrustedPublishResult | undefined;
    try {
      assertRunnableProject(job.project.path);
      if (job.publishRequested) {
        try {
          publishSnapshot = await captureTrustedGitSnapshot(job.project.path);
        } catch (error) {
          publishPreflightError = errorMessage(error);
        }
      }
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
      const result = await thread.run(job.publishRequested
        ? trustedPublishingInput(prepared.input)
        : prepared.input);
      finalResponse = result.finalResponse;

      if (job.publishRequested) {
        if (!publishSnapshot) {
          publishResult = {
            status: "BLOCKED",
            blocker: `Trusted publishing preflight failed: ${publishPreflightError || "unknown error"}`
          };
          await reportPublishEvent(job.id, {
            eventKey: "01-blocked",
            action: "BLOCKED",
            status: "BLOCKED",
            details: { message: publishResult.blocker }
          });
        } else {
          publishResult = await publishTrustedCodexChanges({
            cwd: job.project.path,
            jobId: job.id,
            title: job.threadTitle || job.prompt,
            autoMerge: Boolean(job.publishAutoMerge),
            snapshot: publishSnapshot,
            checkTimeoutMs: config.publishCheckTimeoutMs,
            githubTimeoutMs: config.publishGithubTimeoutMs,
            report: async (event) => await reportPublishEvent(job.id, event)
          });
        }
      }
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
      threadId: thread.id ?? undefined,
      publishResult
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

async function executeGeminiIdeaJob(job: GeminiIdeaWorkerJob): Promise<void> {
  const model = job.model?.trim() || config.geminiModel;
  console.log(`[codex-worker] Running Gemini idea job ${job.id} with ${model}.`);
  const heartbeat = startJobHeartbeat(job.id, "idea-jobs");
  try {
    try {
      const finalResponse = await runGeminiIdeaPrompt({
        prompt: job.prompt,
        model,
        timeoutMs: config.geminiTimeoutMs,
        workingDirectory: config.geminiWorkingDirectory
      });
      await terminalRequestUntilAccepted(
        `/codex/worker/idea-jobs/${encodeURIComponent(job.id)}/complete`,
        { workerId: config.workerId, finalResponse, model },
        job.id,
        "completion"
      );
      console.log(`[codex-worker] Completed Gemini idea job ${job.id}.`);
    } catch (error) {
      const message = errorMessage(error);
      console.error(`[codex-worker] Gemini idea job ${job.id} failed: ${message}`);
      await terminalRequestUntilAccepted(
        `/codex/worker/idea-jobs/${encodeURIComponent(job.id)}/fail`,
        { workerId: config.workerId, error: message, model },
        job.id,
        "failure"
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function terminalRequestUntilAccepted(
  path: string,
  body: unknown,
  jobId: string,
  outcome: string
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

function startJobHeartbeat(jobId: string, jobKind = "jobs"): NodeJS.Timeout {
  let active = false;
  return setInterval(() => {
    if (active) return;
    active = true;
    void workerRequest(`/codex/worker/${jobKind}/${encodeURIComponent(jobId)}/heartbeat`, {
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
    ...workerAuthHeaders(),
    "content-type": "application/json"
  };
}

function workerAuthHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${config.token}`,
    "x-threadwise-worker-id": config.workerId
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
    maxAttachmentBytes: positiveInteger(process.env.CODEX_WORKER_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024, 1_024),
    geminiModel: process.env.GEMINI_WORKER_MODEL?.trim() || "auto",
    geminiTimeoutMs: positiveInteger(process.env.GEMINI_WORKER_TIMEOUT_MS, 600_000, 30_000),
    geminiWorkingDirectory: resolve(process.env.GEMINI_WORKER_WORKING_DIRECTORY?.trim() || process.cwd()),
    publishCheckTimeoutMs: positiveInteger(
      process.env.CODEX_PUBLISH_CHECK_TIMEOUT_MS,
      15 * 60_000,
      30_000
    ),
    publishGithubTimeoutMs: positiveInteger(
      process.env.CODEX_PUBLISH_GITHUB_TIMEOUT_MS,
      30 * 60_000,
      60_000
    ),
    fileRoots: parseFileRoots(process.env.THREADWISE_FILE_ROOTS),
    fileMaxBytes: positiveInteger(
      process.env.THREADWISE_FILE_MAX_BYTES,
      50_000_000,
      1_024,
      50_000_000
    ),
    fileScanLimit: positiveInteger(process.env.THREADWISE_FILE_SCAN_LIMIT, 50_000, 1_000, 1_000_000)
  };
}

function trustedPublishingInput(input: string | UserInput[]): string | UserInput[] {
  const instruction = [
    "",
    "",
    "Trusted publishing was requested.",
    "Make the requested implementation and verify it, but do not run git commit, git push, gh, or merge commands.",
    "After this sandboxed turn ends, the trusted Threadwise laptop worker will review only your new diff, run checks, commit it on an agent/* branch, open a PR to main, and handle auto-merge."
  ].join("\n");
  if (typeof input === "string") return `${input}${instruction}`;
  return input.map((item, index) =>
    index === 0 && item.type === "text"
      ? { ...item, text: `${item.text}${instruction}` }
      : item
  );
}

async function reportPublishEvent(jobId: string, event: TrustedPublishEvent): Promise<void> {
  await terminalRequestUntilAccepted(
    `/codex/worker/jobs/${encodeURIComponent(jobId)}/publish-events`,
    { workerId: config.workerId, event },
    jobId,
    `publish ${event.action.toLowerCase()} audit`
  );
}

function loadLocalWorkerEnv(): void {
  const file = resolve(process.cwd(), ".env.codex-worker");
  if (!existsSync(file) || typeof process.loadEnvFile !== "function") return;
  process.loadEnvFile(file);
}

function isRunnableProject(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function assertRunnableProject(path: string): void {
  if (!isRunnableProject(path)) {
    throw new Error(`Project folder is missing or is no longer a directory: ${path}`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
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
