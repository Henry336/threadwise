import type { FastifyInstance } from "fastify";
import { logger } from "../logger";
import {
  DashboardAuthenticationError,
  DashboardConfigurationError,
  verifyDashboardAuthorization
} from "./auth";
import { DashboardUserNotFoundError, getDashboardSnapshot, type DashboardSnapshot } from "./snapshot";

type DashboardRouteOptions = {
  publicKey?: string;
  loadSnapshot?: (telegramId: string) => Promise<DashboardSnapshot>;
};

export function registerDashboardRoute(server: FastifyInstance, options: DashboardRouteOptions = {}): void {
  const loadSnapshot = options.loadSnapshot ?? getDashboardSnapshot;

  server.get("/api/v1/dashboard", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store, max-age=0");
    reply.header("Pragma", "no-cache");
    reply.header("Vary", "Authorization");

    try {
      const principal = await verifyDashboardAuthorization(request.headers.authorization, options.publicKey);
      return await loadSnapshot(principal.telegramId);
    } catch (error) {
      if (error instanceof DashboardAuthenticationError) {
        return reply
          .code(401)
          .header("WWW-Authenticate", 'Bearer realm="threadwise-dashboard", error="invalid_token"')
          .send({ error: "unauthorized" });
      }

      if (error instanceof DashboardConfigurationError) {
        logger.error("Dashboard API is not configured correctly.", { errorType: error.name });
        return reply.code(503).send({ error: "dashboard_api_unavailable" });
      }

      if (error instanceof DashboardUserNotFoundError) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      logger.error("Dashboard snapshot request failed.", {
        errorType: error instanceof Error ? error.name : "UnknownError"
      });
      return reply.code(500).send({ error: "dashboard_snapshot_failed" });
    }
  });
}
