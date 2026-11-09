/**
 * Server-side registry of dashboard browser logins (DashboardBrowserSession rows).
 * The browser cookie holds only an opaque session id; Vercel asks the backend to check it on
 * every request, so a session can be revoked here (logout) even while the cookie is still valid.
 * Called from the browser-session routes in route.ts. Ownership always comes from the signed token.
 */
import { prisma } from "../db/prisma";

export const DASHBOARD_BROWSER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type BrowserSessionDatabase = Pick<typeof prisma, "user" | "dashboardBrowserSession">;

export class DashboardBrowserSessionError extends Error {
  constructor(readonly code: "user_not_found" | "inactive") {
    super(code === "inactive" ? "The dashboard session is no longer active." : "The dashboard user was not found.");
    this.name = "DashboardBrowserSessionError";
  }
}

export type DashboardBrowserSession = {
  id: string;
  expiresAt: Date;
};

/**
 * Creates a session row for the Telegram user after a dashboard login. The TTL is bounded
 * (5 minutes to 7 days). Also triggers a best-effort purge of long-dead rows without waiting for it.
 */
export async function createDashboardBrowserSession(
  telegramId: string,
  ttlSeconds: number,
  database: BrowserSessionDatabase = prisma,
  now = new Date(),
): Promise<DashboardBrowserSession> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > DASHBOARD_BROWSER_SESSION_TTL_SECONDS) {
    throw new Error("Dashboard browser session TTL is outside the supported range.");
  }
  const owner = await database.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!owner) throw new DashboardBrowserSessionError("user_not_found");

  const session = await database.dashboardBrowserSession.create({
    data: {
      ownerUserId: owner.id,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000),
    },
    select: { id: true, expiresAt: true },
  });
  void purgeExpiredDashboardBrowserSessions(database, now);
  return session;
}

/**
 * Confirms a session id belongs to this Telegram user and is neither revoked nor expired.
 * Malformed, missing, cross-owner and dead sessions all fail the same way ("inactive"),
 * so a guessed id reveals nothing.
 */
export async function requireActiveDashboardBrowserSession(
  telegramId: string,
  sessionId: string,
  database: BrowserSessionDatabase = prisma,
  now = new Date(),
): Promise<DashboardBrowserSession> {
  if (!SESSION_ID.test(sessionId)) throw new DashboardBrowserSessionError("inactive");
  const session = await database.dashboardBrowserSession.findFirst({
    where: {
      id: sessionId,
      owner: { telegramId },
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, expiresAt: true },
  });
  if (!session) throw new DashboardBrowserSessionError("inactive");
  return session;
}

/** Marks the exact session revoked (logout). Only the owner's own active session can be changed; unknown ids are a no-op. */
export async function revokeDashboardBrowserSession(
  telegramId: string,
  sessionId: string,
  database: BrowserSessionDatabase = prisma,
  now = new Date(),
): Promise<void> {
  if (!SESSION_ID.test(sessionId)) return;
  await database.dashboardBrowserSession.updateMany({
    where: { id: sessionId, owner: { telegramId }, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Deletes rows that expired or were revoked more than 30 days ago. To keep it cheap it only
 * runs when the current minute is a multiple of 32 (minutes 0 and 32), and errors are ignored.
 */
async function purgeExpiredDashboardBrowserSessions(database: BrowserSessionDatabase, now: Date): Promise<void> {
  if ((now.getUTCMinutes() & 31) !== 0) return;
  const retentionBoundary = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
  await database.dashboardBrowserSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: retentionBoundary } },
        { revokedAt: { lte: retentionBoundary } },
      ],
    },
  }).catch(() => undefined);
}
