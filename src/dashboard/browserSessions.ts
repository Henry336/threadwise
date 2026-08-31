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
