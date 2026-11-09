import { describe, expect, it } from "vitest";
import {
  SharedRateLimitExceededError,
  consumeSharedRateLimit,
  dashboardRateLimitPolicy,
  limitTelegramWebhookRequest,
  serverIngressRateLimitPolicy,
  telegramActorId,
} from "./sharedRateLimit";

describe("shared HTTP rate limiter", () => {
  it("counts requests per principal and route class inside one fixed window", async () => {
    const now = new Date("2026-08-18T05:00:10.000Z");
    const input = { principalKey: "dashboard:111", routeClass: "dashboard:write", limit: 2 };
    await consumeSharedRateLimit(input, now);
    await consumeSharedRateLimit(input, now);
    // Another principal and another route class have their own budgets.
    await consumeSharedRateLimit({ ...input, principalKey: "dashboard:222" }, now);
    await consumeSharedRateLimit({ ...input, routeClass: "dashboard:read" }, now);
    await expect(consumeSharedRateLimit(input, now)).rejects.toMatchObject({
      name: "SharedRateLimitExceededError",
      retryAfterSeconds: 50,
    });
    // The next window starts a fresh count.
    await expect(consumeSharedRateLimit(input, new Date("2026-08-18T05:01:00.000Z"))).resolves.toBeUndefined();
  });

  it("rejects invalid budgets before counting", async () => {
    await expect(consumeSharedRateLimit({ principalKey: "x", routeClass: "y", limit: 0 })).rejects.toThrow(/between 1 and 100000/);
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

    const now = new Date("2026-08-18T06:00:00.000Z");
    for (let count = 0; count < 180; count += 1) await limitTelegramWebhookRequest(update, "threadwise", now);
    await expect(limitTelegramWebhookRequest(update, "threadwise", now)).rejects.toBeInstanceOf(SharedRateLimitExceededError);
    await expect(limitTelegramWebhookRequest(update, "beacon", now)).resolves.toBeUndefined();
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

