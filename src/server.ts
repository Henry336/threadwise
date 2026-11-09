/**
 * The Fastify HTTP server. It hosts the Telegram webhooks, the dashboard API (src/dashboard),
 * /health for release checks, token-protected admin endpoints, and the Google Calendar OAuth callback.
 * main.ts calls startServer only in webhook mode.
 */

import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { webhookCallback, type Bot } from "grammy";
import type { AiProvider } from "./ai/types";
import { registerDashboardRoute } from "./dashboard/route";
import { logger } from "./logger";
import { handleCalendarOAuthCallback } from "./services/googleCalendar";
import { microsoftExcelConfigured } from "./services/excel";
import { getReminderDiagnostics, runReminderPass } from "./services/reminders";
import { appVersion } from "./services/version";
import { env, privateCodexConfig } from "./config/env";
import { escapeHtml, headerToken, isAdminAuthorized } from "./security/http";
import {
  SharedRateLimitExceededError,
  consumeSharedRateLimit,
  limitTelegramWebhookRequest,
  serverIngressRateLimitPolicy,
} from "./security/sharedRateLimit";
import { codexWorkerRoutes, excelOAuthRoutes } from "./sideProjectRoutes";
/**
 * Registers every route and starts listening. Routes without their own limit (admin, OAuth,
 * side projects) share a per-IP rate limit. The dashboard API and the
 * webhooks are skipped because they apply their own limits, and /health stays open for deploy checks. Admin endpoints answer 404 to a
 * wrong token so they do not reveal that they exist.
 */
export async function startServer(
  bot: Bot,
  ai: AiProvider,
  options: {
    port: number;
    webhookPath: string;
    webhookSecret: string;
    adminStatusToken?: string;
    dashboardPublicKey?: string;
    telegramBotToken?: string;
    beaconBot?: Bot;
    beaconWebhookPath?: string;
    beaconWebhookSecret?: string;
  }
) {
  const server = Fastify({ logger: false });
  server.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (
      pathname === "/health"
      || pathname.startsWith("/api/v1/dashboard")
      || pathname === options.webhookPath
      || pathname === options.beaconWebhookPath
    ) return;
    const policy = serverIngressRateLimitPolicy(pathname);
    try {
      await consumeSharedRateLimit({
        principalKey: `ip:${request.ip}`,
        routeClass: policy.routeClass,
        limit: policy.limit,
      });
    } catch (error) {
      if (error instanceof SharedRateLimitExceededError) {
        return reply
          .code(429)
          .header("Retry-After", String(error.retryAfterSeconds))
          .send({ error: "rate_limited" });
      }
      throw error;
    }
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
    ai,
    todayFoundationOwnerTelegramId: env.TODAY_FOUNDATION_OWNER_TELEGRAM_ID,
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

  // Side projects sharing this process register only when configured (see sideProjectRoutes.ts).
  const codexConfig = privateCodexConfig();
  if (codexConfig) {
    void server.register(codexWorkerRoutes, { bot, config: codexConfig, telegramBotToken: options.telegramBotToken });
  }
  if (microsoftExcelConfigured()) void server.register(excelOAuthRoutes, { bot });

  registerAuthenticatedTelegramWebhook(server, {
    path: options.webhookPath,
    secret: options.webhookSecret,
    channel: "threadwise",
    handler: webhookCallback(bot, "fastify")
  });
  if (options.beaconBot && options.beaconWebhookPath) {
    if (options.beaconWebhookPath === options.webhookPath) {
      throw new Error("Beacon and Threadwise must use different webhook paths.");
    }
    registerAuthenticatedTelegramWebhook(server, {
      path: options.beaconWebhookPath,
      secret: options.beaconWebhookSecret,
      channel: "beacon",
      handler: webhookCallback(options.beaconBot, "fastify")
    });
  }

  server.get("/calendar/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const result = await handleCalendarOAuthCallback(bot, query);
    if (result.redirectUrl) return reply.redirect(result.redirectUrl);
    return reply.type("text/html").send(`<html><body><p>${escapeHtml(result.message)}</p></body></html>`);
  });

  await server.listen({ port: options.port, host: "0.0.0.0" });
  logger.info("HTTP server started.", {
    port: options.port
  });

  return server;
}

/**
 * Adds a webhook route that only accepts requests carrying Telegram's secret header
 * (set through setWebhook's `secret_token`). Wrong or missing secrets get an opaque 404, then a
 * per-sender rate limit runs before grammY handles the update. This closed the unauthenticated
 * webhook found in the August 2026 security audit.
 */
export function registerAuthenticatedTelegramWebhook(
  server: FastifyInstance,
  options: {
    path: string;
    secret: string | undefined;
    channel?: "threadwise" | "beacon";
    rateLimiter?: typeof limitTelegramWebhookRequest;
    handler: (request: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>;
  }
): void {
  server.post(options.path, async (request, reply) => {
    const suppliedSecret = headerToken(request.headers["x-telegram-bot-api-secret-token"]);
    if (!secureTokenEqual(suppliedSecret, options.secret)) {
      return reply.code(404).send({ error: "not_found" });
    }
    try {
      await (options.rateLimiter ?? limitTelegramWebhookRequest)(
        request.body,
        options.channel ?? "threadwise",
      );
    } catch (error) {
      if (error instanceof SharedRateLimitExceededError) {
        return reply
          .code(429)
          .header("Retry-After", String(error.retryAfterSeconds))
          .send({ error: "rate_limited" });
      }
      throw error;
    }
    return options.handler(request, reply);
  });
}

/**
 * Constant-time secret comparison. Both values are hashed first so they have equal length,
 * which timingSafeEqual requires, and the comparison time does not reveal the secret's length.
 */
function secureTokenEqual(actualToken: string | undefined, expectedToken: string | undefined): boolean {
  if (!actualToken || !expectedToken) return false;
  const actual = createHash("sha256").update(actualToken).digest();
  const expected = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(actual, expected);
}
