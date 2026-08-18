import { describe, expect, it, vi } from "vitest";
import {
  SharedRateLimitExceededError,
  consumeSharedRateLimit,
  dashboardRateLimitPolicy,
  limitTelegramWebhookRequest,
  serverIngressRateLimitPolicy,
  telegramActorId,
} from "./sharedRateLimit";

describe("shared HTTP rate limiter", () => {
  it("uses atomic shared buckets and stores only a principal fingerprint", async () => {
    const database = rateLimitDatabase(1);

    await consumeSharedRateLimit({
      principalKey: "dashboard:123456789",
      routeClass: "dashboard:write",
      limit: 90,
    }, database as never, new Date("2026-08-18T05:00:10.000Z"));

    expect(database.sharedRateLimitBucket.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        bucketKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        principalFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        routeClass: "dashboard:write",
        requestCount: 1,
      }),
      update: { requestCount: { increment: 1 }, expiresAt: expect.any(Date) },
      select: { requestCount: true },
    }));
    expect(JSON.stringify(database.sharedRateLimitBucket.upsert.mock.calls)).not.toContain("123456789");
  });

  it("returns a bounded retry interval after an atomic bucket exceeds its budget", async () => {
    const database = rateLimitDatabase(91);

    await expect(consumeSharedRateLimit({
      principalKey: "dashboard:123456789",
      routeClass: "dashboard:write",
      limit: 90,
    }, database as never, new Date("2026-08-18T05:00:10.000Z"))).rejects.toMatchObject({
      name: "SharedRateLimitExceededError",
      retryAfterSeconds: 50,
    });
  });

  it("assigns tighter shared budgets to expensive and streaming dashboard routes", () => {
    expect(dashboardRateLimitPolicy("GET", "snapshot")).toEqual({ routeClass: "dashboard:read", limit: 240 });
    expect(dashboardRateLimitPolicy("PATCH", "update_task")).toEqual({ routeClass: "dashboard:write", limit: 90 });
    expect(dashboardRateLimitPolicy("POST", "study_request_analysis")).toEqual({ routeClass: "dashboard:expensive", limit: 20 });
    expect(dashboardRateLimitPolicy("GET", "live_sync")).toEqual({ routeClass: "dashboard:stream", limit: 20 });
  });

  it("derives the authenticated Telegram actor without trusting arbitrary top-level ids", async () => {
    const update = { update_id: 55, callback_query: { from: { id: 987654321 } } };
    expect(telegramActorId(update)).toBe("987654321");
    expect(telegramActorId({ update_id: 987654321 })).toBeUndefined();

    const database = rateLimitDatabase(1);
    await limitTelegramWebhookRequest(update, "threadwise", database as never);
    expect(JSON.stringify(database.sharedRateLimitBucket.upsert.mock.calls)).not.toContain("987654321");
  });

  it("classifies remaining server ingress without storing raw paths", () => {
    expect(serverIngressRateLimitPolicy("/admin/ai/status")).toEqual({ routeClass: "server:admin", limit: 60 });
    expect(serverIngressRateLimitPolicy("/codex/worker/sync")).toEqual({ routeClass: "server:worker", limit: 300 });
    expect(serverIngressRateLimitPolicy("/calendar/oauth/callback")).toEqual({ routeClass: "server:oauth", limit: 60 });
  });

  it("exposes a dedicated error type for route adapters", () => {
    expect(new SharedRateLimitExceededError(12)).toMatchObject({ retryAfterSeconds: 12 });
  });
});

function rateLimitDatabase(requestCount: number) {
  return {
    sharedRateLimitBucket: {
      upsert: vi.fn().mockResolvedValue({ requestCount }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}
