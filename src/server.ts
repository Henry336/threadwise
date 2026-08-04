import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InputFile, type Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { AiProvider } from "./ai/types";
import { registerDashboardRoute } from "./dashboard/route";
import { logger } from "./logger";
import { handleCalendarOAuthCallback } from "./services/googleCalendar";
import { handleMicrosoftOAuthCallback } from "./services/excel";
import { getReminderDiagnostics, runReminderPass } from "./services/reminders";
import { appVersion } from "./services/version";
import { env, privateCodexConfig } from "./config/env";
import { CODEX_TASK_SYNC_PUBLIC_KEY_DER_BASE64 } from "./config/codexTaskSyncPublicKey";
import {
  CODEX_TASK_SYNC_PATH,
  isFreshCodexTaskSyncTimestamp,
  shouldReplaceCodexTaskCatalog,
  verifyCodexTaskSyncRequest
} from "./services/codexTaskSyncAuth";
import {
  blockedCodexJobsForQueue,
  codexAttachmentForWorker,
  codexJobForReport,
  claimCodexJob,
  completeCodexJob,
  completedCodexJobForWorker,
  failCodexJob,
  pauseCodexJobForApproval,
  recordCodexPublishAudit,
  renewCodexJobLease,
  syncCodexProjects,
  syncCodexThreads,
  type CodexPublishAuditInput,
  type CodexPublishResultInput
} from "./services/codex";
import { deliverCodexApprovalRequest, deliverCodexJobOnce } from "./bot/codex";
import { isCodexCapability, type CodexCapability } from "./services/codexCapabilities";
import { deliverGeminiIdeaJobOnce } from "./bot/geminiIdeas";
import {
  claimGeminiIdeaJob,
  completeGeminiIdeaJob,
  failGeminiIdeaJob,
  recordLocalWorkerHeartbeat,
  renewGeminiIdeaJobLease,
  terminalGeminiIdeaJobForWorker
} from "./services/geminiIdeas";
import {
  claimFileCourierJob,
  completeFileCourierDelivery,
  completeFileCourierLookup,
  failFileCourierJob,
  fileCourierJobForUpload,
  recordFileCourierAudit,
  renewFileCourierJobLease,
  terminalFileCourierJobForWorker,
  type FileCourierResultInput
} from "./services/fileCourier";
import { deliverFileCourierJobOnce } from "./bot/files";
import { FILE_COURIER_RESULT_LIMIT } from "./services/fileCourierPolicy";

const MAX_CODEX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const FILE_COURIER_CONTENT_TYPE = "application/x-threadwise-file";

export async function startServer(
  bot: Bot,
  ai: AiProvider,
  options: { port: number; webhookPath: string; adminStatusToken?: string; dashboardPublicKey?: string; telegramBotToken?: string }
) {
  const server = Fastify({ logger: false });
  server.addContentTypeParser(FILE_COURIER_CONTENT_TYPE, (_request, payload, done) => {
    done(null, payload);
  });

  server.get("/health", async () => ({
    ok: true,
    service: "threadwise",
    version: appVersion(),
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 12) ?? process.env.GIT_COMMIT?.slice(0, 12) ?? "unknown",
    timestamp: new Date().toISOString()
  }));

  registerDashboardRoute(server, {
    publicKey: options.dashboardPublicKey,
    telegramBotToken: options.telegramBotToken,
    ai
  });

  server.get("/admin/ai/status", async (request, reply) => {
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-admin-token"], options.adminStatusToken)) {
      return reply.code(404).send({ error: "not_found" });
    }

    const query = request.query as { check?: string } | undefined;
    const status = ai.getStatus();
    if (query?.check === "1" || query?.check === "true") {
      return {
        ok: true,
        service: "threadwise",
        timestamp: new Date().toISOString(),
        ai: status,
        liveCheck: await ai.checkHealth()
      };
    }

    return {
      ok: true,
      service: "threadwise",
      timestamp: new Date().toISOString(),
      ai: status
    };
  });

  server.get("/admin/reminders/status", async (request, reply) => {
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-admin-token"], options.adminStatusToken)) {
      return reply.code(404).send({ error: "not_found" });
    }

    return {
      ok: true,
      service: "threadwise",
      timestamp: new Date().toISOString(),
      reminders: getReminderDiagnostics()
    };
  });

  const runRemindersNow = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-admin-token"], options.adminStatusToken)) {
      return reply.code(404).send({ error: "not_found" });
    }

    try {
      const reminders = await runReminderPass(bot, "manual");
      return {
        ok: true,
        service: "threadwise",
        timestamp: new Date().toISOString(),
        reminders
      };
    } catch (error) {
      logger.error("Manual reminder run failed.", { error: String(error) });
      return reply.code(500).send({
        ok: false,
        service: "threadwise",
        timestamp: new Date().toISOString(),
        error: "reminder_run_failed",
        reminders: getReminderDiagnostics()
      });
    }
  };

  server.get("/admin/reminders/run", runRemindersNow);
  server.post("/admin/reminders/run", runRemindersNow);

  server.post("/codex/worker/sync", async (request, reply) => {
    const config = privateCodexConfig();
    const body = request.body as {
      workerId?: unknown;
      projects?: unknown;
      threads?: unknown;
      capabilities?: unknown;
    } | undefined;
    const validSignedBody = validWorkerId(body?.workerId)
      && validProjectList(body?.projects)
      && (body.threads === undefined || validThreadList(body.threads))
      && body.capabilities === undefined;
    const tokenAuthorized = isAdminAuthorized(
      request.headers.authorization,
      request.headers["x-threadwise-codex-token"],
      config?.workerToken
    );
    const signedAuthorized = validSignedBody
      && isSignedCodexTaskSyncAuthorized(request, body!, CODEX_TASK_SYNC_PUBLIC_KEY_DER_BASE64);
    if (!config || (!tokenAuthorized && !signedAuthorized)) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !validWorkerId(body?.workerId)
      || !validProjectList(body?.projects)
      || (body.threads !== undefined && !validThreadList(body.threads))
      || (body.capabilities !== undefined && !validWorkerCapabilities(body.capabilities))
    ) {
      return reply.code(400).send({ error: "invalid_worker_sync" });
    }

    const projects = await syncCodexProjects(codexScope(config!), body.projects);
    // Only the least-privilege Ed25519 sidecar owns the task catalog. The full
    // token worker may run an older discovery build and must not overwrite it.
    const threads = body.threads === undefined
      || !shouldReplaceCodexTaskCatalog(signedAuthorized)
      ? undefined
      : await syncCodexThreads(codexScope(config!), body.threads);
    if (tokenAuthorized) {
      await recordLocalWorkerHeartbeat(
        codexScope(config!),
        body.workerId,
        body.capabilities
      );
    }
    return {
      ok: true,
      projects: projects.map((project) => ({
        alias: project.alias,
        path: project.path,
        lastSeenAt: project.lastSeenAt.toISOString()
      })),
      threadCount: threads?.length
    };
  });

  server.post("/codex/worker/claim", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const body = request.body as { workerId?: unknown } | undefined;
    if (!validWorkerId(body?.workerId)) {
      return reply.code(400).send({ error: "invalid_worker_id" });
    }

    const job = await claimCodexJob(codexScope(config!), body.workerId, config!.jobLeaseSeconds);
    if (!job) return reply.code(204).send();
    return {
      id: job.id,
      prompt: job.prompt,
      threadId: job.threadId,
      threadTitle: job.threadTitle,
      model: job.model,
      reasoningEffort: job.reasoningEffort,
      publishRequested: job.publishRequested,
      publishAutoMerge: job.publishAutoMerge,
      requestedCapabilities: job.requestedCapabilities,
      approvedCapabilities: job.approvedCapabilities,
      repairAttempt: job.repairAttempt,
      maxRepairAttempts: job.maxRepairAttempts,
      project: { alias: job.project.alias, path: job.project.path },
      attachments: job.attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize
      }))
    };
  });

  server.get("/codex/worker/attachments/:id", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const workerId = headerToken(request.headers["x-threadwise-worker-id"]);
    if (!params.id || !validWorkerId(workerId) || !options.telegramBotToken) {
      return reply.code(400).send({ error: "invalid_attachment_request" });
    }
    const attachment = await codexAttachmentForWorker(codexScope(config!), params.id, workerId);
    if (!attachment) return reply.code(404).send({ error: "attachment_not_found" });
    if (attachment.fileSize && attachment.fileSize > MAX_CODEX_ATTACHMENT_BYTES) {
      return reply.code(413).send({ error: "attachment_too_large" });
    }

    const telegramFile = await bot.api.getFile(attachment.telegramFileId);
    if (!telegramFile.file_path) return reply.code(502).send({ error: "telegram_file_unavailable" });
    const response = await fetch(`https://api.telegram.org/file/bot${options.telegramBotToken}/${telegramFile.file_path}`);
    if (!response.ok) return reply.code(502).send({ error: "telegram_file_download_failed" });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CODEX_ATTACHMENT_BYTES) {
      return reply.code(413).send({ error: "attachment_too_large" });
    }
    const buffer = await responseBufferWithinLimit(response, MAX_CODEX_ATTACHMENT_BYTES);
    if (!buffer) {
      return reply.code(413).send({ error: "attachment_too_large" });
    }
    return reply
      .header("content-type", attachment.mimeType || "application/octet-stream")
      .header("content-length", String(buffer.length))
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)
      .send(buffer);
  });

  server.post("/codex/worker/jobs/:id/publish-events", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; event?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId) || !validCodexPublishAudit(body?.event)) {
      return reply.code(400).send({ error: "invalid_publish_audit" });
    }
    const recorded = await recordCodexPublishAudit({
      scope: codexScope(config!),
      jobId: params.id,
      workerId: body.workerId,
      event: body.event
    });
    if (!recorded) return reply.code(409).send({ error: "job_not_claimed" });
    return { ok: true };
  });

  server.post("/codex/worker/jobs/:id/approval-required", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as {
      workerId?: unknown;
      capability?: unknown;
      reason?: unknown;
      threadId?: unknown;
    } | undefined;
    if (
      !params.id
      || !validWorkerId(body?.workerId)
      || typeof body?.capability !== "string"
      || !isCodexCapability(body.capability)
      || !boundedString(body.reason, 1, 8_000)
      || !optionalString(body.threadId)
    ) {
      return reply.code(400).send({ error: "invalid_approval_request" });
    }
    const scope = codexScope(config!);
    const job = await pauseCodexJobForApproval({
      scope,
      id: params.id,
      workerId: body.workerId,
      capability: body.capability,
      reason: body.reason,
      threadId: body.threadId
    });
    if (!job) {
      const existing = await codexJobForReport(scope, params.id);
      if (
        existing?.status === "WAITING_APPROVAL"
        && existing.requestedCapabilities.includes(body.capability)
      ) return { ok: true };
      return reply.code(409).send({ error: "job_not_claimed" });
    }
    await deliverCodexApprovalRequest(bot, job);
    return { ok: true };
  });

  server.post("/codex/worker/jobs/:id/complete", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as {
      workerId?: unknown;
      finalResponse?: unknown;
      threadId?: unknown;
      publishResult?: unknown;
      repairAttempt?: unknown;
    } | undefined;
    if (
      !params.id
      || !validWorkerId(body?.workerId)
      || typeof body?.finalResponse !== "string"
      || !optionalString(body.threadId)
      || (body.repairAttempt !== undefined && (
        typeof body.repairAttempt !== "number"
        || !Number.isInteger(body.repairAttempt)
        || body.repairAttempt < 0
        || body.repairAttempt > 5
      ))
      || (body.publishResult !== undefined && !validCodexPublishResult(body.publishResult))
    ) {
      return reply.code(400).send({ error: "invalid_completion" });
    }

    const job = await completeCodexJob({
      scope: codexScope(config!),
      id: params.id,
      workerId: body.workerId,
      finalResponse: body.finalResponse,
      threadId: body.threadId,
      publishResult: body.publishResult,
      repairAttempt: body.repairAttempt
    }) ?? await completedCodexJobForWorker(codexScope(config!), params.id, body.workerId);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    await deliverCodexJobOnce(bot, job);
    return { ok: true };
  });

  server.post("/codex/worker/jobs/:id/fail", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; error?: unknown; threadId?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId) || typeof body?.error !== "string" || !optionalString(body.threadId)) {
      return reply.code(400).send({ error: "invalid_failure" });
    }

    const job = await failCodexJob({
      scope: codexScope(config!),
      id: params.id,
      workerId: body.workerId,
      error: body.error,
      threadId: body.threadId
    }) ?? await completedCodexJobForWorker(codexScope(config!), params.id, body.workerId);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    await deliverCodexJobOnce(bot, job);
    const blocked = await blockedCodexJobsForQueue(codexScope(config!), job.queueKey);
    for (const dependent of blocked) await deliverCodexJobOnce(bot, dependent);
    return { ok: true };
  });

  server.post("/codex/worker/jobs/:id/heartbeat", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId)) {
      return reply.code(400).send({ error: "invalid_heartbeat" });
    }
    const renewed = await renewCodexJobLease({
      scope: codexScope(config!),
      id: params.id,
      workerId: body.workerId,
      leaseSeconds: config!.jobLeaseSeconds
    });
    if (!renewed) return reply.code(409).send({ error: "job_not_claimed" });
    return { ok: true };
  });

  server.post("/codex/worker/idea-jobs/claim", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const body = request.body as { workerId?: unknown } | undefined;
    if (!validWorkerId(body?.workerId)) {
      return reply.code(400).send({ error: "invalid_worker_id" });
    }
    const job = await claimGeminiIdeaJob(body.workerId, config!.jobLeaseSeconds);
    if (!job) return reply.code(204).send();
    return {
      id: job.id,
      prompt: job.prompt,
      model: job.model
    };
  });

  server.post("/codex/worker/idea-jobs/:id/complete", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; finalResponse?: unknown; model?: unknown } | undefined;
    if (
      !params.id
      || !validWorkerId(body?.workerId)
      || typeof body?.finalResponse !== "string"
      || body.finalResponse.length > 40_000
      || !optionalBoundedString(body.model, 200)
    ) {
      return reply.code(400).send({ error: "invalid_completion" });
    }
    const job = await completeGeminiIdeaJob({
      id: params.id,
      workerId: body.workerId,
      finalResponse: body.finalResponse,
      model: body.model
    }) ?? await terminalGeminiIdeaJobForWorker(params.id, body.workerId);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    await deliverGeminiIdeaJobOnce(bot, job);
    return { ok: true };
  });

  server.post("/codex/worker/idea-jobs/:id/fail", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; error?: unknown; model?: unknown } | undefined;
    if (
      !params.id
      || !validWorkerId(body?.workerId)
      || typeof body?.error !== "string"
      || body.error.length > 8_000
      || !optionalBoundedString(body.model, 200)
    ) {
      return reply.code(400).send({ error: "invalid_failure" });
    }
    const job = await failGeminiIdeaJob({
      id: params.id,
      workerId: body.workerId,
      error: body.error,
      model: body.model
    }) ?? await terminalGeminiIdeaJobForWorker(params.id, body.workerId);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    await deliverGeminiIdeaJobOnce(bot, job);
    return { ok: true };
  });

  server.post("/codex/worker/idea-jobs/:id/heartbeat", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId)) {
      return reply.code(400).send({ error: "invalid_heartbeat" });
    }
    const renewed = await renewGeminiIdeaJobLease(
      params.id,
      body.workerId,
      config!.jobLeaseSeconds
    );
    if (!renewed) return reply.code(409).send({ error: "job_not_claimed" });
    return { ok: true };
  });

  server.post("/files/worker/claim", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const body = request.body as { workerId?: unknown } | undefined;
    if (!validWorkerId(body?.workerId)) {
      return reply.code(400).send({ error: "invalid_worker_id" });
    }
    const job = await claimFileCourierJob(codexScope(config!), body.workerId, config!.jobLeaseSeconds);
    if (!job) return reply.code(204).send();
    return {
      id: job.id,
      kind: job.kind,
      query: job.query,
      sortLatest: job.sortLatest,
      maxBytes: env.FILE_COURIER_MAX_BYTES,
      selected: job.kind === "SEND" && job.selectedPath && job.selectedFileName
        && job.selectedSizeBytes !== null && job.selectedModifiedAt && job.selectedIdentityKey
        ? {
            path: job.selectedPath,
            fileName: job.selectedFileName,
            parentPath: job.selectedParentPath,
            sizeBytes: Number(job.selectedSizeBytes),
            modifiedAt: job.selectedModifiedAt.toISOString(),
            identityKey: job.selectedIdentityKey,
            mimeType: job.selectedMimeType,
            fileType: job.selectedFileType
          }
        : undefined
    };
  });

  server.post("/files/worker/jobs/:id/complete", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; results?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId) || !validFileCourierResults(body?.results)) {
      return reply.code(400).send({ error: "invalid_file_completion" });
    }
    const job = await completeFileCourierLookup({
      scope: codexScope(config!),
      jobId: params.id,
      workerId: body.workerId,
      results: body.results
    }) ?? await terminalFileCourierJobForWorker(codexScope(config!), params.id, body.workerId);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    await deliverFileCourierJobOnce(bot, job);
    return { ok: true };
  });

  server.post("/files/worker/jobs/:id/fail", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; error?: unknown } | undefined;
    if (
      !params.id
      || !validWorkerId(body?.workerId)
      || typeof body?.error !== "string"
      || body.error.length > 8_000
    ) {
      return reply.code(400).send({ error: "invalid_file_failure" });
    }
    const job = await failFileCourierJob({
      scope: codexScope(config!),
      jobId: params.id,
      workerId: body.workerId,
      error: body.error
    });
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    await deliverFileCourierJobOnce(bot, job);
    return { ok: true };
  });

  server.post("/files/worker/jobs/:id/heartbeat", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId)) {
      return reply.code(400).send({ error: "invalid_file_heartbeat" });
    }
    const renewed = await renewFileCourierJobLease({
      scope: codexScope(config!),
      jobId: params.id,
      workerId: body.workerId,
      leaseSeconds: config!.jobLeaseSeconds
    });
    if (!renewed) return reply.code(409).send({ error: "job_not_claimed" });
    return { ok: true };
  });

  server.post("/files/worker/jobs/:id/content", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const workerId = headerToken(request.headers["x-threadwise-worker-id"]);
    if (!params.id || !validWorkerId(workerId)) {
      return reply.code(400).send({ error: "invalid_file_upload" });
    }
    const job = await fileCourierJobForUpload(codexScope(config!), params.id, workerId);
    if (
      !job
      || !job.selectedFileName
      || job.selectedSizeBytes === null
      || !job.selectedModifiedAt
      || !job.selectedIdentityKey
    ) {
      return reply.code(409).send({ error: "job_not_claimed" });
    }
    const expectedBytes = Number(job.selectedSizeBytes);
    const declaredBytes = Number(request.headers["content-length"]);
    if (
      !Number.isSafeInteger(expectedBytes)
      || expectedBytes < 0
      || expectedBytes > env.FILE_COURIER_MAX_BYTES
      || !Number.isSafeInteger(declaredBytes)
      || declaredBytes !== expectedBytes
    ) {
      return reply.code(413).send({
        error: "file_size_rejected",
        maxBytes: env.FILE_COURIER_MAX_BYTES
      });
    }
    await recordFileCourierAudit(job.id, "UPLOAD_STARTED", "RUNNING", {
      workerId,
      sizeBytes: expectedBytes
    });
    try {
      const body = request.body as AsyncIterable<Uint8Array>;
      const sent = await bot.api.sendDocument(
        job.telegramChatId,
        new InputFile(exactLengthStream(body, expectedBytes, env.FILE_COURIER_MAX_BYTES), job.selectedFileName),
        {
          caption: [
            `📎 ${job.selectedFileName}`,
            job.selectedParentPath ? `From ${truncateServerText(job.selectedParentPath, 700)}` : undefined,
            `Laptop file request ${job.id.slice(0, 8)}`
          ].filter(Boolean).join("\n"),
          ...(job.telegramRequestMessageId
            ? { reply_parameters: { message_id: job.telegramRequestMessageId, allow_sending_without_reply: true } }
            : {})
        }
      );
      const completed = await completeFileCourierDelivery({
        scope: codexScope(config!),
        jobId: job.id,
        workerId,
        telegramMessageId: sent.message_id
      });
      if (!completed) {
        return reply.code(409).send({ error: "delivery_state_changed" });
      }
      return { ok: true, telegramMessageId: sent.message_id };
    } catch (error) {
      const failed = await failFileCourierJob({
        scope: codexScope(config!),
        jobId: job.id,
        workerId,
        error: `File delivery failed: ${String(error)}`
      });
      if (failed) {
        await deliverFileCourierJobOnce(bot, failed).catch((deliveryError) => {
          logger.warn("File courier failure notice could not be delivered.", {
            jobId: job.id,
            error: String(deliveryError)
          });
        });
      }
      return reply.code(502).send({ error: "telegram_file_delivery_failed" });
    }
  });

  server.post(options.webhookPath, webhookCallback(bot, "fastify"));

  server.get("/calendar/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const result = await handleCalendarOAuthCallback(bot, query);
    if (result.redirectUrl) return reply.redirect(result.redirectUrl);
    return reply.type("text/html").send(`<html><body><p>${escapeHtml(result.message)}</p></body></html>`);
  });

  server.get("/excel/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    const result = await handleMicrosoftOAuthCallback(bot, query);
    if (result.redirectUrl) return reply.redirect(result.redirectUrl);
    return reply.type("text/html").send(`<html><body><p>${escapeHtml(result.message)}</p></body></html>`);
  });

  await server.listen({ port: options.port, host: "0.0.0.0" });
  logger.info("HTTP server started.", { port: options.port, webhookPath: options.webhookPath });

  return server;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authToken(value?: string): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function headerToken(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAdminAuthorized(authorization: string | undefined, adminHeader: string | string[] | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) {
    return false;
  }

  const token = authToken(authorization) ?? headerToken(adminHeader);
  if (!token) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isSignedCodexTaskSyncAuthorized(
  request: FastifyRequest,
  body: { workerId?: unknown; projects?: unknown; threads?: unknown },
  publicKeyDerBase64: string
): boolean {
  if (!validWorkerId(body.workerId)) return false;
  const workerId = headerToken(request.headers["x-threadwise-worker-id"]);
  const timestamp = headerToken(request.headers["x-threadwise-sync-timestamp"]);
  const signature = headerToken(request.headers["x-threadwise-sync-signature"]);
  if (
    workerId !== body.workerId
    || !timestamp
    || !signature
    || !isFreshCodexTaskSyncTimestamp(timestamp)
  ) {
    return false;
  }

  return verifyCodexTaskSyncRequest(publicKeyDerBase64, {
    timestamp,
    method: request.method,
    path: CODEX_TASK_SYNC_PATH,
    workerId,
    body
  }, signature);
}

function codexScope(config: { ownerTelegramId: string; telegramChatId: string }) {
  return {
    ownerTelegramId: config.ownerTelegramId,
    telegramChatId: config.telegramChatId
  };
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

export async function* exactLengthStream(
  source: AsyncIterable<Uint8Array>,
  expectedBytes: number,
  maxBytes: number
): AsyncGenerator<Uint8Array> {
  let received = 0;
  for await (const chunk of source) {
    received += chunk.byteLength;
    if (received > expectedBytes || received > maxBytes) {
      throw new Error("The worker uploaded more bytes than the validated file snapshot.");
    }
    yield chunk;
  }
  if (received !== expectedBytes) {
    throw new Error(`The worker upload ended at ${received} bytes; expected ${expectedBytes}.`);
  }
}

function validFileCourierResults(value: unknown): value is FileCourierResultInput[] {
  return Array.isArray(value)
    && value.length <= FILE_COURIER_RESULT_LIMIT
    && value.every((item) => {
      if (!item || typeof item !== "object") return false;
      const result = item as Record<string, unknown>;
      return boundedString(result.absolutePath, 1, 2_000)
        && boundedString(result.fileName, 1, 500)
        && boundedString(result.parentPath, 1, 2_000)
        && typeof result.sizeBytes === "number"
        && Number.isSafeInteger(result.sizeBytes)
        && result.sizeBytes >= 0
        && result.sizeBytes <= env.FILE_COURIER_MAX_BYTES
        && boundedString(result.modifiedAt, 1, 100)
        && Number.isFinite(Date.parse(result.modifiedAt as string))
        && boundedString(result.identityKey, 1, 500)
        && optionalBoundedString(result.mimeType, 200)
        && boundedString(result.fileType, 1, 100);
    });
}

function truncateServerText(value: string, maximum: number): string {
  const points = Array.from(value);
  return points.length <= maximum ? value : `${points.slice(0, maximum - 1).join("")}…`;
}

function validWorkerId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 200);
}

function validProjectList(value: unknown): value is Array<{
  path: string;
  lastSeenAt?: string;
  gitRepository?: boolean;
  gitBranch?: string;
  gitClean?: boolean;
  gitHeadSha?: string;
  gitOriginMainSha?: string;
  gitReady?: boolean;
  gitError?: string;
}> {
  return Array.isArray(value)
    && value.length <= 1_000
    && value.every((item) => {
      if (!item || typeof item !== "object") return false;
      const project = item as Record<string, unknown>;
      return typeof project.path === "string"
        && project.path.length > 0
        && project.path.length <= 2_000
        && optionalString(project.lastSeenAt)
        && optionalBoolean(project.gitRepository)
        && optionalBoundedString(project.gitBranch, 300)
        && optionalBoolean(project.gitClean)
        && optionalCommitSha(project.gitHeadSha)
        && optionalCommitSha(project.gitOriginMainSha)
        && optionalBoolean(project.gitReady)
        && optionalBoundedString(project.gitError, 1_000);
    });
}

function validThreadList(value: unknown): value is Array<{
  threadId: string;
  path: string;
  title: string;
  preview?: string;
  source: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}> {
  return Array.isArray(value)
    && value.length <= 5_000
    && value.every((item) => {
      if (!item || typeof item !== "object") return false;
      const thread = item as Record<string, unknown>;
      return boundedString(thread.threadId, 1, 200)
        && /^[0-9a-f-]{6,200}$/i.test(thread.threadId)
        && boundedString(thread.path, 1, 2_000)
        && boundedString(thread.title, 1, 500)
        && optionalBoundedString(thread.preview, 4_000)
        && boundedString(thread.source, 1, 80)
        && optionalBoundedString(thread.status, 80)
        && optionalBoundedString(thread.createdAt, 200)
        && optionalBoundedString(thread.updatedAt, 200);
    });
}

function validWorkerCapabilities(value: unknown): value is {
  geminiAvailable: boolean;
  geminiVersion?: string;
  geminiModel?: string;
  error?: string;
  fileCourierAvailable?: boolean;
  fileRootCount?: number;
  fileCourierMaxBytes?: number;
  fileCourierError?: string;
  codexHome?: string;
  codexConfigAvailable?: boolean;
  codexAuthAvailable?: boolean;
  networkAccessAvailable?: boolean;
  gitAvailable?: boolean;
  githubAvailable?: boolean;
  githubAuthenticated?: boolean;
  browserAvailable?: boolean;
  additionalRootCount?: number;
  deployTargets?: string[];
  credentialBrokerVariables?: string[];
  allowedCapabilities?: CodexCapability[];
  diagnostics?: Record<string, string>;
} {
  if (!value || typeof value !== "object") return false;
  const capabilities = value as Record<string, unknown>;
  return typeof capabilities.geminiAvailable === "boolean"
    && optionalBoundedString(capabilities.geminiVersion, 200)
    && optionalBoundedString(capabilities.geminiModel, 200)
    && optionalBoundedString(capabilities.error, 1_000)
    && (capabilities.fileCourierAvailable === undefined || typeof capabilities.fileCourierAvailable === "boolean")
    && (capabilities.fileRootCount === undefined || (
      typeof capabilities.fileRootCount === "number"
      && Number.isInteger(capabilities.fileRootCount)
      && capabilities.fileRootCount >= 0
      && capabilities.fileRootCount <= 100
    ))
    && (capabilities.fileCourierMaxBytes === undefined || (
      typeof capabilities.fileCourierMaxBytes === "number"
      && Number.isSafeInteger(capabilities.fileCourierMaxBytes)
      && capabilities.fileCourierMaxBytes >= 1_024
      && capabilities.fileCourierMaxBytes <= 50_000_000
    ))
    && optionalBoundedString(capabilities.fileCourierError, 1_000)
    && optionalBoundedString(capabilities.codexHome, 2_000)
    && optionalBoolean(capabilities.codexConfigAvailable)
    && optionalBoolean(capabilities.codexAuthAvailable)
    && optionalBoolean(capabilities.networkAccessAvailable)
    && optionalBoolean(capabilities.gitAvailable)
    && optionalBoolean(capabilities.githubAvailable)
    && optionalBoolean(capabilities.githubAuthenticated)
    && optionalBoolean(capabilities.browserAvailable)
    && optionalInteger(capabilities.additionalRootCount, 0, 100)
    && optionalStringArray(capabilities.deployTargets, 50, 100)
    && optionalStringArray(capabilities.credentialBrokerVariables, 30, 80)
    && optionalCodexCapabilities(capabilities.allowedCapabilities)
    && optionalStringRecord(capabilities.diagnostics, 20, 1_000);
}

function validCodexPublishResult(value: unknown): value is CodexPublishResultInput {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["BLOCKED", "PR_OPEN", "AUTO_MERGE_ENABLED", "MERGED"].includes(String(result.status))
    && optionalAgentBranch(result.branch)
    && optionalCommitSha(result.commitSha)
    && (result.prNumber === undefined || (
      typeof result.prNumber === "number"
      && Number.isInteger(result.prNumber)
      && result.prNumber > 0
    ))
    && optionalGithubPrUrl(result.prUrl)
    && optionalBoundedString(result.checks, 2_000)
    && optionalCommitSha(result.mergeCommitSha)
    && optionalBoundedString(result.blocker, 4_000);
}

function validCodexPublishAudit(value: unknown): value is CodexPublishAuditInput {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const details = event.details;
  return boundedString(event.eventKey, 1, 120)
    && /^[a-z0-9-]+$/i.test(event.eventKey as string)
    && ["COMMIT", "PUSH", "PR", "CHECKS", "AUTO_MERGE", "MERGE", "DEPLOY", "BLOCKED"].includes(String(event.action))
    && boundedString(event.status, 1, 80)
    && optionalAgentBranch(event.branch)
    && optionalCommitSha(event.commitSha)
    && (event.prNumber === undefined || (
      typeof event.prNumber === "number"
      && Number.isInteger(event.prNumber)
      && event.prNumber > 0
    ))
    && optionalGithubPrUrl(event.prUrl)
    && (details === undefined || (
      Boolean(details)
      && typeof details === "object"
      && !Array.isArray(details)
      && JSON.stringify(details).length <= 8_000
    ));
}

function optionalAgentBranch(value: unknown): value is string | undefined {
  return value === undefined || (
    boundedString(value, 7, 160)
    && /^agent\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..")
    && !value.includes("//")
  );
}

function optionalCommitSha(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value));
}

function optionalGithubPrUrl(value: unknown): value is string | undefined {
  return value === undefined || (
    typeof value === "string"
    && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/i.test(value)
  );
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function optionalInteger(value: unknown, minimum: number, maximum: number): value is number | undefined {
  return value === undefined || (
    typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
  );
}

function optionalStringArray(value: unknown, maximumItems: number, maximumLength: number): value is string[] | undefined {
  return value === undefined || (
    Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => boundedString(item, 1, maximumLength))
  );
}

function optionalCodexCapabilities(value: unknown): value is CodexCapability[] | undefined {
  return value === undefined || (
    Array.isArray(value)
    && value.length <= 10
    && value.every((item) => typeof item === "string" && isCodexCapability(item))
  );
}

function optionalStringRecord(value: unknown, maximumItems: number, maximumLength: number): boolean {
  return value === undefined || (
    Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.entries(value as Record<string, unknown>).length <= maximumItems
    && Object.entries(value as Record<string, unknown>).every(([key, item]) => (
      boundedString(key, 1, 100) && boundedString(item, 1, maximumLength)
    ))
  );
}

function optionalBoundedString(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}
