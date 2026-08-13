import type { Codex as CodexClient, ModelReasoningEffort, Thread, UserInput } from "@openai/codex-sdk";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverCodexProjects } from "./services/codexDiscovery";
import { codexInputWithAttachments, safeCodexAttachmentName } from "./services/codexAttachments";
import { resolveCodexAdditionalDirectories } from "./services/codexAdditionalDirectories";
import { discoverCodexThreads } from "./services/codexThreadDiscovery";
import { inferCapabilityFromError, type CodexCapability } from "./services/codexCapabilities";
import { diagnoseCodexProjects } from "./services/codexWorkerDiagnostics";
import {
  codexSubprocessEnvironment,
  parseCredentialEnvironmentAllowlist
} from "./services/codexSubprocessEnv";
import { detectGeminiCli, runGeminiIdeaPrompt } from "./services/geminiCli";
import {
  publishTrustedCodexChanges,
  repairTrustedPublishedChanges,
  runCommand,
  type TrustedPublishEvent,
  type TrustedPublishResult
} from "./services/trustedGitPublisher";
import { createTrustedGitWorktree, type TrustedGitWorktree } from "./services/trustedGitWorktree";
import {
  parseTrustedDeployTargets,
  verifyTrustedDeployment,
  type TrustedDeployTarget
} from "./services/trustedDeployment";
import {
  createSafeFileSnapshot,
  parseFileRoots,
  searchLaptopFiles,
  validateConfiguredFileRoots,
  type LocalFileMetadata
} from "./services/fileCourierLocal";
import { FILE_COURIER_RESULT_LIMIT } from "./services/fileCourierPolicy";

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
  additionalRoots: string[];
  worktreeRoot?: string;
  deployTargets: Record<string, TrustedDeployTarget>;
  deployHealthTimeoutMs: number;
  credentialEnvAllowlist: string[];
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
  requestedCapabilities: CodexCapability[];
  approvedCapabilities: CodexCapability[];
  repairAttempt: number;
  maxRepairAttempts: number;
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
let hostCapabilities: Awaited<ReturnType<typeof detectHostCapabilities>>;

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
  codex = new Codex({
    env: codexSubprocessEnvironment(process.env, process.execPath, config.credentialEnvAllowlist),
    config: {
      shell_environment_policy: {
        inherit: "all",
        exclude: ["CODEX_HOME", ...config.credentialEnvAllowlist]
      }
    }
  });
  console.log(`[codex-worker] Starting ${config.workerId}.`);
  console.log(`[codex-worker] Relay: ${config.serviceUrl}`);
  await refreshFileCourierReadiness();
  hostCapabilities = await detectHostCapabilities();
  const fileCourierLoop = runFileCourierLoop();
  let nextSyncAt = 0;

  while (!stopping) {
    try {
      if (Date.now() >= nextSyncAt) {
        const projects = await diagnoseCodexProjects(await discoverCodexProjects());
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
        hostCapabilities = await detectHostCapabilities();
        const geminiCapabilities = await detectGeminiCli(config.geminiModel);
        const capabilities = {
          ...geminiCapabilities,
          fileCourierAvailable,
          fileRootCount: config.fileRoots.length,
          fileCourierMaxBytes: config.fileMaxBytes,
          fileCourierError,
          ...hostCapabilities
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
        take: FILE_COURIER_RESULT_LIMIT
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
  let trustedWorktree: TrustedGitWorktree | undefined;
  const heartbeat = startJobHeartbeat(job.id);
  try {
    try {
      assertRunnableProject(job.project.path);
      assertAvailableCapabilities(job);
      if (job.publishRequested) {
        trustedWorktree = await createTrustedGitWorktree({
          cwd: job.project.path,
          jobId: job.id,
          root: config.worktreeRoot,
          timeoutMs: config.publishGithubTimeoutMs
        });
      }
      const executionDirectory = trustedWorktree?.path ?? job.project.path;
      let publishResult: TrustedPublishResult | undefined;
      let repairAttempt = job.repairAttempt ?? 0;
      if (job.publishRequested) {
        console.log(`[codex-worker] Isolated publish worktree: ${executionDirectory}`);
      }
      const prepared = await prepareJobInput(job);
      attachmentDirectory = prepared.directory;
      const approvedAdditionalDirectories = job.approvedCapabilities.includes("files")
        ? await resolveCodexAdditionalDirectories(config.additionalRoots, job.prompt)
        : [];
      if (
        job.approvedCapabilities.includes("files")
        && config.additionalRoots.length > 0
        && approvedAdditionalDirectories.length === 0
      ) {
        throw new Error(
          "Windows drive-wide file access requires the exact absolute file or folder path in quotes in the prompt."
        );
      }
      const additionalDirectories = [
        ...(attachmentDirectory ? [attachmentDirectory] : []),
        ...approvedAdditionalDirectories
      ];
      const options = {
        workingDirectory: executionDirectory,
        sandboxMode: "workspace-write" as const,
        approvalPolicy: "never" as const,
        networkAccessEnabled: config.networkAccessEnabled && job.approvedCapabilities.includes("internet"),
        model: job.model ?? undefined,
        modelReasoningEffort: job.reasoningEffort ?? undefined,
        additionalDirectories: additionalDirectories.length ? additionalDirectories : undefined
      };
      thread = job.threadId ? codex.resumeThread(job.threadId, options) : codex.startThread(options);
      const result = await thread.run(job.publishRequested
        ? trustedPublishingInput(prepared.input)
        : prepared.input);
      let finalResponse = result.finalResponse;

      if (job.publishRequested) {
        publishResult = await publishTrustedCodexChanges({
          cwd: executionDirectory,
          jobId: job.id,
          title: job.threadTitle || job.prompt,
          autoMerge: Boolean(job.publishAutoMerge),
          snapshot: trustedWorktree!.snapshot,
          checkTimeoutMs: config.publishCheckTimeoutMs,
          githubTimeoutMs: config.publishGithubTimeoutMs,
          report: async (event) => await reportPublishEvent(job.id, event)
        });

        while (publishResult.repairPrompt && repairAttempt < job.maxRepairAttempts) {
          repairAttempt += 1;
          console.log(`[codex-worker] Repair attempt ${repairAttempt}/${job.maxRepairAttempts} for ${job.id}.`);
          const repaired = await thread.run(publishResult.repairPrompt);
          finalResponse = [finalResponse, `\n\nRepair attempt ${repairAttempt}:\n${repaired.finalResponse}`].join("");
          publishResult = publishResult.branch && publishResult.commitSha && publishResult.prUrl
            ? await repairTrustedPublishedChanges({
                cwd: executionDirectory,
                jobId: job.id,
                title: job.threadTitle || job.prompt,
                autoMerge: Boolean(job.publishAutoMerge),
                branch: publishResult.branch,
                commitSha: publishResult.commitSha,
                prUrl: publishResult.prUrl,
                checkTimeoutMs: config.publishCheckTimeoutMs,
                githubTimeoutMs: config.publishGithubTimeoutMs,
                eventPrefix: `r${repairAttempt}-`,
                report: async (event) => await reportPublishEvent(job.id, event)
              })
            : await publishTrustedCodexChanges({
                cwd: executionDirectory,
                jobId: job.id,
                title: job.threadTitle || job.prompt,
                autoMerge: Boolean(job.publishAutoMerge),
                snapshot: trustedWorktree!.snapshot,
                checkTimeoutMs: config.publishCheckTimeoutMs,
                githubTimeoutMs: config.publishGithubTimeoutMs,
                eventPrefix: `r${repairAttempt}-`,
                report: async (event) => await reportPublishEvent(job.id, event)
              });
        }
        if (job.approvedCapabilities.includes("deploy")) {
          if (publishResult.status !== "MERGED" || !publishResult.mergeCommitSha) {
            publishResult = {
              ...publishResult,
              status: "BLOCKED",
              blocker: "Deployment was not attempted because the pull request is not merged yet."
            };
            await reportPublishEvent(job.id, {
              eventKey: `r${repairAttempt}-deploy-blocked`,
              action: "DEPLOY",
              status: "BLOCKED",
              branch: publishResult.branch,
              commitSha: publishResult.commitSha,
              prNumber: publishResult.prNumber,
              prUrl: publishResult.prUrl,
              details: { message: publishResult.blocker }
            });
          } else {
            const deployment = await verifyTrustedDeployment({
              alias: job.project.alias,
              mergeCommitSha: publishResult.mergeCommitSha,
              targets: config.deployTargets,
              timeoutMs: config.deployHealthTimeoutMs
            });
            await reportPublishEvent(job.id, {
              eventKey: `r${repairAttempt}-deploy-${deployment.status.toLowerCase()}`,
              action: "DEPLOY",
              status: deployment.status,
              branch: publishResult.branch,
              commitSha: publishResult.commitSha,
              prNumber: publishResult.prNumber,
              prUrl: publishResult.prUrl,
              details: deployment
            });
            if (deployment.status === "BLOCKED") {
              publishResult = { ...publishResult, status: "BLOCKED", blocker: deployment.blocker };
            } else {
              publishResult.checks = `${publishResult.checks ?? "Checks passed"}; deployment: verified`;
              finalResponse += `\n\nDeployment verified: ${deployment.healthUrl}`;
            }
          }
        }
      }

      await terminalRequestUntilAccepted(`/codex/worker/jobs/${encodeURIComponent(job.id)}/complete`, {
        workerId: config.workerId,
        finalResponse,
        threadId: thread.id ?? undefined,
        publishResult: publishResult ? publicPublishResult(publishResult) : undefined,
        repairAttempt
      }, job.id, "completion");
      console.log(`[codex-worker] Completed ${job.id}.`);
    } catch (error) {
      const message = errorMessage(error);
      console.error(`[codex-worker] Job ${job.id} failed: ${message}`);
      const capability = inferCapabilityFromError(message);
      if (
        capability
        && hostCapabilities.allowedCapabilities.includes(capability)
        && !job.approvedCapabilities.includes(capability)
      ) {
        await terminalRequestUntilAccepted(`/codex/worker/jobs/${encodeURIComponent(job.id)}/approval-required`, {
          workerId: config.workerId,
          capability,
          reason: message,
          threadId: thread?.id ?? undefined
        }, job.id, "approval request");
        console.log(`[codex-worker] Paused ${job.id} for ${capability} approval.`);
        return;
      }
      await terminalRequestUntilAccepted(`/codex/worker/jobs/${encodeURIComponent(job.id)}/fail`, {
        workerId: config.workerId,
        error: message,
        threadId: thread?.id ?? undefined
      }, job.id, "failure");
      return;
    }
  } finally {
    clearInterval(heartbeat);
    if (attachmentDirectory) {
      try {
        await rm(attachmentDirectory, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[codex-worker] Could not remove temporary attachments for ${job.id}: ${errorMessage(error)}`);
      }
    }
    if (trustedWorktree) {
      try {
        await trustedWorktree.cleanup();
      } catch (error) {
        console.warn(`[codex-worker] Could not remove trusted worktree for ${job.id}: ${errorMessage(error)}`);
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
  const additionalRoots = parseFileRoots(process.env.THREADWISE_CODEX_ADDITIONAL_ROOTS);
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
    fileScanLimit: positiveInteger(process.env.THREADWISE_FILE_SCAN_LIMIT, 50_000, 1_000, 1_000_000),
    additionalRoots,
    worktreeRoot: process.env.CODEX_WORKER_WORKTREE_ROOT?.trim()
      ? resolve(process.env.CODEX_WORKER_WORKTREE_ROOT.trim())
      : undefined,
    deployTargets: parseTrustedDeployTargets(process.env.THREADWISE_DEPLOY_TARGETS),
    deployHealthTimeoutMs: positiveInteger(
      process.env.CODEX_DEPLOY_HEALTH_TIMEOUT_MS,
      20 * 60_000,
      30_000
    ),
    credentialEnvAllowlist: parseCredentialEnvironmentAllowlist(
      process.env.CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST
    )
  };
}

async function detectHostCapabilities(): Promise<{
  codexHome?: string;
  codexConfigAvailable: boolean;
  codexAuthAvailable: boolean;
  networkAccessAvailable: boolean;
  gitAvailable: boolean;
  githubAvailable: boolean;
  githubAuthenticated: boolean;
  browserAvailable: boolean;
  additionalRootCount: number;
  deployTargets: string[];
  credentialBrokerVariables: string[];
  allowedCapabilities: CodexCapability[];
  diagnostics: Record<string, string>;
}> {
  const codexHome = process.env.CODEX_HOME?.trim();
  const codexConfigAvailable = Boolean(codexHome && existsSync(join(codexHome, "config.toml")));
  const codexAuthAvailable = Boolean(codexHome && existsSync(join(codexHome, "auth.json")));
  const [git, gh, ghAuth] = await Promise.all([
    runCommand("where.exe", ["git.exe"], { cwd: process.cwd(), timeoutMs: 15_000 }),
    runCommand("where.exe", ["gh.exe"], { cwd: process.cwd(), timeoutMs: 15_000 }),
    runCommand("gh", ["auth", "status", "--hostname", "github.com"], { cwd: process.cwd(), timeoutMs: 30_000 })
  ]);
  const browserAvailable = [
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"]!, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter(Boolean).some(existsSync);
  let additionalRootsReady = false;
  let additionalRootsError: string | undefined;
  if (config.additionalRoots.length) {
    try {
      await validateConfiguredFileRoots(config.additionalRoots);
      additionalRootsReady = true;
    } catch (error) {
      additionalRootsError = errorMessage(error);
    }
  }
  const allowedCapabilities: CodexCapability[] = [];
  if (config.networkAccessEnabled) allowedCapabilities.push("internet");
  if (git.exitCode === 0 && gh.exitCode === 0 && ghAuth.exitCode === 0) allowedCapabilities.push("publish");
  if (browserAvailable && config.networkAccessEnabled) allowedCapabilities.push("browser");
  if (additionalRootsReady) allowedCapabilities.push("files");
  const deployTargets = Object.keys(config.deployTargets);
  if (deployTargets.length > 0 && allowedCapabilities.includes("publish")) allowedCapabilities.push("deploy");
  return {
    codexHome,
    codexConfigAvailable,
    codexAuthAvailable,
    networkAccessAvailable: config.networkAccessEnabled,
    gitAvailable: git.exitCode === 0,
    githubAvailable: gh.exitCode === 0,
    githubAuthenticated: ghAuth.exitCode === 0,
    browserAvailable,
    additionalRootCount: additionalRootsReady ? config.additionalRoots.length : 0,
    deployTargets,
    credentialBrokerVariables: config.credentialEnvAllowlist.filter((name) => Boolean(process.env[name])),
    allowedCapabilities,
    diagnostics: {
      codex: codexConfigAvailable && codexAuthAvailable
        ? "Desktop Codex config and authentication are available."
        : "Set persistent CODEX_HOME to the desktop Codex data directory.",
      github: ghAuth.exitCode === 0
        ? "GitHub CLI is authenticated in the worker account."
        : "Run gh auth login in the same Windows account as the worker.",
      internet: config.networkAccessEnabled
        ? "Available after per-job Telegram approval."
        : "Set CODEX_WORKER_NETWORK_ACCESS=true to make approval possible.",
      files: additionalRootsReady
        ? "Additional roots are available after per-job Telegram approval."
        : additionalRootsError
          ? `Additional roots are invalid: ${additionalRootsError.slice(0, 500)}`
          : "Set THREADWISE_CODEX_ADDITIONAL_ROOTS to explicit project/file roots.",
      deploy: deployTargets.length
        ? "Git-connected deployment targets are configured."
        : "Set THREADWISE_DEPLOY_TARGETS after choosing deployment targets.",
      plugins: config.credentialEnvAllowlist.length
        ? "Allowlisted plugin credentials are hidden from model-run shell commands."
        : "No plugin credential environment variables are allowlisted."
    }
  };
}

function assertAvailableCapabilities(job: WorkerJob): void {
  const missing = job.requestedCapabilities.filter(
    (capability) => !hostCapabilities.allowedCapabilities.includes(capability)
  );
  if (missing.length) {
    throw new Error(
      `This worker is not configured for: ${missing.join(", ")}. Run /codex doctor for the exact host setup.`
    );
  }
}

function trustedPublishingInput(input: string | UserInput[]): string | UserInput[] {
  const instruction = [
    "",
    "",
    "Trusted publishing was requested.",
    "Make the requested implementation and verify it, but do not run git commit, git push, gh, or merge commands.",
    "Do not run Render, Vercel, or other deployment commands.",
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

function publicPublishResult(result: TrustedPublishResult): TrustedPublishResult {
  const { repairPrompt: _repairPrompt, repairStage: _repairStage, ...publicResult } = result;
  return publicResult;
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
