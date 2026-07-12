import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { AiProvider } from "./ai/types";
import { logger } from "./logger";
import { handleGmailOAuthCallback } from "./services/gmail";
import { handleCalendarOAuthCallback } from "./services/googleCalendar";
import { getReminderDiagnostics, runReminderPass } from "./services/reminders";

export async function startServer(bot: Bot, ai: AiProvider, options: { port: number; webhookPath: string; adminStatusToken?: string }) {
  const server = Fastify({ logger: false });

  server.get("/health", async () => ({
    ok: true,
    service: "threadwise",
    timestamp: new Date().toISOString()
  }));

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

  server.post(options.webhookPath, webhookCallback(bot, "fastify"));

  server.get("/gmail/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const message = await handleGmailOAuthCallback(bot, query);
    return reply.type("text/html").send(`<html><body><p>${escapeHtml(message)}</p></body></html>`);
  });

  server.get("/calendar/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const message = await handleCalendarOAuthCallback(bot, query);
    return reply.type("text/html").send(`<html><body><p>${escapeHtml(message)}</p></body></html>`);
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
  return token === expectedToken;
}
