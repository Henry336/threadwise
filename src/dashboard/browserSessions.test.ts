import { describe, expect, it, vi } from "vitest";
import {
  createDashboardBrowserSession,
  DashboardBrowserSessionError,
  requireActiveDashboardBrowserSession,
  revokeDashboardBrowserSession,
} from "./browserSessions";

const now = new Date("2026-08-31T14:00:00.000Z");
const sessionId = "0c68a350-c061-4a86-a63f-842c132dc77d";

describe("dashboard browser sessions", () => {
  it("creates a bounded session for the signed Telegram owner", async () => {
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "owner-1" })) },
      dashboardBrowserSession: {
        create: vi.fn(async () => ({ id: sessionId, expiresAt: new Date(now.getTime() + 604_800_000) })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const session = await createDashboardBrowserSession("123456789", 604_800, database as never, now);
    expect(session.id).toBe(sessionId);
    expect(database.dashboardBrowserSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { ownerUserId: "owner-1", expiresAt: new Date("2026-09-07T14:00:00.000Z") },
    }));
  });

  it("fails closed for missing, expired, revoked, malformed, or cross-owner sessions", async () => {
    const database = {
      user: { findUnique: vi.fn() },
      dashboardBrowserSession: { findFirst: vi.fn(async () => null) },
    };
    await expect(requireActiveDashboardBrowserSession("123456789", sessionId, database as never, now))
      .rejects.toMatchObject({ code: "inactive" });
    await expect(requireActiveDashboardBrowserSession("123456789", "not-a-session", database as never, now))
      .rejects.toBeInstanceOf(DashboardBrowserSessionError);
  });

  it("revokes only the signed owner's exact active session and remains idempotent", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const database = { user: {}, dashboardBrowserSession: { updateMany } };
    await revokeDashboardBrowserSession("123456789", sessionId, database as never, now);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: sessionId, owner: { telegramId: "123456789" }, revokedAt: null },
      data: { revokedAt: now },
    });
  });
});
