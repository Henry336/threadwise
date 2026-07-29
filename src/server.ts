import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { AiProvider } from "./ai/types";
import { registerDashboardRoute } from "./dashboard/route";
import { logger } from "./logger";
import { handleCalendarOAuthCallback } from "./services/googleCalendar";
import { handleMicrosoftOAuthCallback } from "./services/excel";
import { getReminderDiagnostics, runReminderPass } from "./services/reminders";
import { appVersion } from "./services/version";
import { privateCodexConfig } from "./config/env";
import { CODEX_TASK_SYNC_PUBLIC_KEY_DER_BASE64 } from "./config/codexTaskSyncPublicKey";
import {
  CODEX_TASK_SYNC_PATH,
  isFreshCodexTaskSyncTimestamp,
  verifyCodexTaskSyncRequest
} from "./services/codexTaskSyncAuth";
import {
  codexAttachmentForWorker,
  claimCodexJob,
  completeCodexJob,
  completedCodexJobForWorker,
  failCodexJob,
  renewCodexJobLease,
  syncCodexProjects,
  syncCodexThreads
} from "./services/codex";
import { deliverCodexJobOnce } from "./bot/codex";
import { deliverGeminiIdeaJobOnce } from "./bot/geminiIdeas";
import {
  claimGeminiIdeaJob,
  completeGeminiIdeaJob,
  failGeminiIdeaJob,
  recordLocalWorkerHeartbeat,
  renewGeminiIdeaJobLease,
  terminalGeminiIdeaJobForWorker
} from "./services/geminiIdeas";

const MAX_CODEX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function startServer(
  bot: Bot,
  ai: AiProvider,
  options: { port: number; webhookPath: string; adminStatusToken?: string; dashboardPublicKey?: string; telegramBotToken?: string }
) {
  const server = Fastify({ logger: false });

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
    const threads = body.threads === undefined
      ? undefined
      : await syncCodexThreads(codexScope(config!), body.threads);
    await recordLocalWorkerHeartbeat(
      codexScope(config!),
      body.workerId,
      body.capabilities
    );
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
      model: job.model,
      reasoningEffort: job.reasoningEffort,
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

  server.post("/codex/worker/jobs/:id/complete", async (request, reply) => {
    const config = privateCodexConfig();
    if (!isAdminAuthorized(request.headers.authorization, request.headers["x-threadwise-codex-token"], config?.workerToken)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const params = request.params as { id?: string };
    const body = request.body as { workerId?: unknown; finalResponse?: unknown; threadId?: unknown } | undefined;
    if (!params.id || !validWorkerId(body?.workerId) || typeof body?.finalResponse !== "string" || !optionalString(body.threadId)) {
      return reply.code(400).send({ error: "invalid_completion" });
    }

    const job = await completeCodexJob({
      scope: codexScope(config!),
      id: params.id,
      workerId: body.workerId,
      finalResponse: body.finalResponse,
      threadId: body.threadId
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

function validWorkerId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 200);
}

function validProjectList(value: unknown): value is Array<{ path: string; lastSeenAt?: string }> {
  return Array.isArray(value)
    && value.length <= 1_000
    && value.every((item) => {
      if (!item || typeof item !== "object") return false;
      const project = item as { path?: unknown; lastSeenAt?: unknown };
      return typeof project.path === "string"
        && project.path.length > 0
        && project.path.length <= 2_000
        && optionalString(project.lastSeenAt);
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
} {
  if (!value || typeof value !== "object") return false;
  const capabilities = value as Record<string, unknown>;
  return typeof capabilities.geminiAvailable === "boolean"
    && optionalBoundedString(capabilities.geminiVersion, 200)
    && optionalBoundedString(capabilities.geminiModel, 200)
    && optionalBoundedString(capabilities.error, 1_000);
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function optionalBoundedString(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}
