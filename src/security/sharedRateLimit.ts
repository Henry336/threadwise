import { createHash } from "node:crypto";
import { prisma } from "../db/prisma";
import type { DashboardPrincipal } from "../dashboard/auth";

const RATE_WINDOW_SECONDS = 60;
const MAX_ROUTE_CLASS_LENGTH = 96;

type RateLimitDatabase = Pick<typeof prisma, "sharedRateLimitBucket">;

export type SharedRateLimitInput = {
  principalKey: string;
  routeClass: string;
  limit: number;
  windowSeconds?: number;
};

export class SharedRateLimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests.");
    this.name = "SharedRateLimitExceededError";
  }
}

export async function consumeSharedRateLimit(
  input: SharedRateLimitInput,
  database: RateLimitDatabase = prisma,
  now = new Date(),
): Promise<void> {
  const windowSeconds = input.windowSeconds ?? RATE_WINDOW_SECONDS;
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100_000) {
    throw new Error("Rate limit must be an integer between 1 and 100000.");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 3_600) {
    throw new Error("Rate-limit window must be between 1 and 3600 seconds.");
  }

  const windowMs = windowSeconds * 1_000;
  const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + windowMs * 2);
  const routeClass = input.routeClass.slice(0, MAX_ROUTE_CLASS_LENGTH);
  const principalFingerprint = digest(input.principalKey);
  const bucketKey = digest(`${principalFingerprint}\0${routeClass}\0${windowStartedAt.toISOString()}`);
  const bucket = await database.sharedRateLimitBucket.upsert({
    where: { bucketKey },
    create: {
      bucketKey,
      principalFingerprint,
      routeClass,
      windowStartedAt,
      requestCount: 1,
      expiresAt,
    },
    update: {
      requestCount: { increment: 1 },
      expiresAt,
    },
    select: { requestCount: true },
  });

  if ((Number.parseInt(bucketKey.slice(0, 2), 16) & 31) === 0) {
    await database.sharedRateLimitBucket
      .deleteMany({ where: { expiresAt: { lte: now } } })
      .catch(() => undefined);
  }
  if (bucket.requestCount > input.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (windowStartedAt.getTime() + windowMs - now.getTime()) / 1_000,
    ));
    throw new SharedRateLimitExceededError(retryAfterSeconds);
  }
}

export async function limitDashboardRequest(
  principal: DashboardPrincipal,
  method: string,
  operation: string,
  database: RateLimitDatabase = prisma,
  now = new Date(),
): Promise<void> {
  const policy = dashboardRateLimitPolicy(method, operation);
  await consumeSharedRateLimit({
    principalKey: `dashboard:${principal.telegramId}`,
    routeClass: policy.routeClass,
    limit: policy.limit,
  }, database, now);
}

export function dashboardRateLimitPolicy(method: string, operation: string): {
  routeClass: string;
  limit: number;
} {
  if (operation === "live_sync") return { routeClass: "dashboard:stream", limit: 20 };
  if (/analysis|analyze|sync|import|export|image_content|search/u.test(operation)) {
    return { routeClass: "dashboard:expensive", limit: 20 };
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    return { routeClass: "dashboard:write", limit: 90 };
  }
  return { routeClass: "dashboard:read", limit: 240 };
}

export async function limitTelegramWebhookRequest(
  update: unknown,
  channel: "threadwise" | "beacon",
  database: RateLimitDatabase = prisma,
  now = new Date(),
): Promise<void> {
  const actor = telegramActorId(update);
  await consumeSharedRateLimit({
    principalKey: actor ? `telegram:${actor}` : `telegram:unknown:${channel}`,
    routeClass: `telegram-webhook:${channel}`,
    limit: actor ? 180 : 60,
  }, database, now);
}

export function telegramActorId(update: unknown): string | undefined {
  if (!isRecord(update)) return undefined;
  const candidates = [
    nested(update, "message", "from", "id"),
    nested(update, "edited_message", "from", "id"),
    nested(update, "callback_query", "from", "id"),
    nested(update, "inline_query", "from", "id"),
    nested(update, "chosen_inline_result", "from", "id"),
    nested(update, "my_chat_member", "from", "id"),
    nested(update, "chat_member", "from", "id"),
    nested(update, "chat_join_request", "from", "id"),
    nested(update, "poll_answer", "user", "id"),
  ];
  const actor = candidates.find((value) => typeof value === "number" && Number.isSafeInteger(value));
  return typeof actor === "number" ? String(actor) : undefined;
}

export function serverIngressRateLimitPolicy(pathname: string): { routeClass: string; limit: number } {
  if (pathname.startsWith("/admin/")) return { routeClass: "server:admin", limit: 60 };
  if (pathname.startsWith("/codex/") || pathname.startsWith("/gemini/") || pathname.startsWith("/files/")) {
    return { routeClass: "server:worker", limit: 300 };
  }
  if (pathname.endsWith("/oauth/callback")) return { routeClass: "server:oauth", limit: 60 };
  return { routeClass: "server:other", limit: 120 };
}

function nested(value: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
