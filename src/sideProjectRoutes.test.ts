import Fastify from "fastify";
import type { Bot } from "grammy";
import { describe, expect, it } from "vitest";
import { codexWorkerRoutes } from "./sideProjectRoutes";

const config = { ownerTelegramId: "1", telegramChatId: "-100", workerToken: "worker-secret", jobLeaseSeconds: 60 };

describe("codex worker routes plugin", () => {
  it("keeps the worker token check and its 404 for unauthenticated callers", async () => {
    const server = Fastify();
    await server.register(codexWorkerRoutes, { bot: {} as Bot, config });

    const anonymous = await server.inject({ method: "POST", url: "/codex/worker/claim", payload: {} });
    expect(anonymous.statusCode).toBe(404);
    expect(anonymous.json()).toEqual({ error: "not_found" });

    const authorized = await server.inject({
      method: "POST",
      url: "/codex/worker/claim",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "" },
    });
    expect(authorized.statusCode).toBe(400);
    expect(authorized.json()).toEqual({ error: "invalid_worker_id" });
    expect(server.hasRoute({ method: "POST", url: "/files/worker/jobs/:id/content" })).toBe(true);
    expect(server.hasRoute({ method: "POST", url: "/codex/worker/idea-jobs/claim" })).toBe(true);
    await server.close();
  });
});
