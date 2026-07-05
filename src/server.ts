import Fastify from "fastify";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import { logger } from "./logger";

export async function startServer(bot: Bot, options: { port: number; webhookPath: string }) {
  const server = Fastify({ logger: false });

  server.get("/health", async () => ({
    ok: true,
    service: "threadwise",
    timestamp: new Date().toISOString()
  }));

  server.post(options.webhookPath, webhookCallback(bot, "fastify"));

  await server.listen({ port: options.port, host: "0.0.0.0" });
  logger.info("HTTP server started.", { port: options.port, webhookPath: options.webhookPath });

  return server;
}

