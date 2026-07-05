import Fastify from "fastify";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { AiProvider } from "./ai/types";
import { logger } from "./logger";

export async function startServer(bot: Bot, ai: AiProvider, options: { port: number; webhookPath: string; adminStatusToken?: string }) {
  const server = Fastify({ logger: false });

  server.get("/health", async () => ({
    ok: true,
    service: "threadwise",
    timestamp: new Date().toISOString()
  }));

  server.get("/admin/ai/status", async (request, reply) => {
    if (!options.adminStatusToken) {
      return reply.code(404).send({ error: "not_found" });
    }

    const token = authToken(request.headers.authorization) ?? headerToken(request.headers["x-threadwise-admin-token"]);
    if (token !== options.adminStatusToken) {
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

  server.post(options.webhookPath, webhookCallback(bot, "fastify"));

  await server.listen({ port: options.port, host: "0.0.0.0" });
  logger.info("HTTP server started.", { port: options.port, webhookPath: options.webhookPath });

  return server;
}

function authToken(value?: string): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function headerToken(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
