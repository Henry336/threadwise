/**
 * Fixed-window request limits for the HTTP server, the Telegram webhooks and the dashboard API.
 * src/server.ts applies the ingress and webhook limits and src/dashboard/route.ts applies the
 * dashboard limit per signed-in user. Added for finding F-03 (no route rate limits) in
 * docs/archive/SECURITY_PHASE6_ASSURANCE.md.
 */
import type { DashboardPrincipal } from "../dashboard/auth";

const RATE_WINDOW_SECONDS = 60;
const MAX_ROUTE_CLASS_LENGTH = 96;

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

// shortcut: in-memory counters only work with one instance; move back to Postgres if Render scales out
// (the SharedRateLimitBucket table and model are kept for that).
const buckets = new Map<string, { count: number; expiresAt: number }>();
let nextPruneAt = 0;

/**
 * Counts one request against a fixed-window budget for one principal and route class, and
 * throws SharedRateLimitExceededError (with a Retry-After) once the window's limit is passed.
 * The counters used to be a Postgres upsert on every Telegram update, dashboard call and worker
 * poll; Threadwise runs as one process, so a Map gives the same limits with no database write.
 * Expired windows are pruned at most once a minute, inline, so memory stays bounded.
 */
export async function consumeSharedRateLimit(
  input: SharedRateLimitInput,
  now = new Date(),
): Promise<void> {
  const windowSeconds = input.windowSeconds ?? RATE_WINDOW_SECONDS;
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100_000) {
    throw new Error("Rate limit must be an integer between 1 and 100000.");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 3_600) {
    throw new Error("Rate-limit window must be between 1 and 3600 seconds.");
  }

  const nowMs = now.getTime();
  if (nowMs >= nextPruneAt) {
    for (const [key, bucket] of buckets) if (bucket.expiresAt <= nowMs) buckets.delete(key);
    nextPruneAt = nowMs + 60_000;
  }
  const windowMs = windowSeconds * 1_000;
  const windowStartedAt = Math.floor(nowMs / windowMs) * windowMs;
  const routeClass = input.routeClass.slice(0, MAX_ROUTE_CLASS_LENGTH);
  const bucketKey = `${input.principalKey}\0${routeClass}\0${windowStartedAt}`;
  const bucket = buckets.get(bucketKey) ?? { count: 0, expiresAt: windowStartedAt + windowMs };
  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  if (bucket.count > input.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartedAt + windowMs - nowMs) / 1_000));
    throw new SharedRateLimitExceededError(retryAfterSeconds);
  }
}

/** Applies the dashboard budget for this route class to the signed-in Telegram user. */
export async function limitDashboardRequest(
  principal: DashboardPrincipal,
  method: string,
  operation: string,
  now = new Date(),
): Promise<void> {
  const policy = dashboardRateLimitPolicy(method, operation);
  await consumeSharedRateLimit({
    principalKey: `dashboard:${principal.telegramId}`,
    routeClass: policy.routeClass,
    limit: policy.limit,
  }, now);
}

/**
 * Picks the dashboard budget per minute from the operation name and method: the live stream and
 * expensive work (analysis, sync, import, export, image content, search) get 20, writes get 90,
 * and reads get 240.
 */
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

/** Applies the per-sender webhook budget, so one chatty Telegram user cannot flood the bot. */
export async function limitTelegramWebhookRequest(
  update: unknown,
  channel: "threadwise" | "beacon",
  now = new Date(),
): Promise<void> {
  const actor = telegramActorId(update);
  await consumeSharedRateLimit({
    principalKey: actor ? `telegram:${actor}` : `telegram:unknown:${channel}`,
    routeClass: `telegram-webhook:${channel}`,
    limit: actor ? 180 : 60,
  }, now);
}

/**
 * Finds the sending user's Telegram id in a raw update, across the update kinds the bots
 * receive. Returns undefined when no sender is present, so the caller falls back to a stricter
 * shared bucket.
 */
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

/** Picks the per-minute budget for non-webhook server routes by path prefix (admin, laptop workers, OAuth callbacks, other). */
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
