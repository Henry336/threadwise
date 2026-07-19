import { GroupMemberRole, GroupMemberStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DashboardGroupAccessError, resolveDashboardWorkspace } from "./workspaces";

describe("dashboard group workspace authorization", () => {
  const workspaceId = "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2";

  it("keeps personal scope on the signed Telegram subject", async () => {
    const scope = await resolveDashboardWorkspace("123456789", "personal", undefined, {} as PrismaClient);
    expect(scope).toMatchObject({ ownerTelegramId: "123456789", workspace: { kind: "PERSONAL", role: "OWNER" } });
  });

  it("resolves a shared owner only after a live Telegram membership check", async () => {
    const findFirst = vi.fn(async () => ({
      id: "membership-1",
      role: GroupMemberRole.MEMBER,
      workspace: {
        id: workspaceId,
        title: "Launch team",
        telegramChatId: "-100456789",
        ownerUser: { telegramId: "chat:-100456789" },
        _count: { members: 4 }
      }
    }));
    const update = vi.fn(async () => ({}));
    const database = { groupMembership: { findFirst, update } } as unknown as PrismaClient;
    const verify = vi.fn(async () => GroupMemberRole.ADMIN);

    const scope = await resolveDashboardWorkspace("123456789", workspaceId, "bot-token", database, verify);

    expect(scope).toEqual({
      principalTelegramId: "123456789",
      ownerTelegramId: "chat:-100456789",
      workspace: { id: workspaceId, kind: "GROUP", name: "Launch team", role: "ADMIN", memberCount: 4 }
    });
    expect(verify).toHaveBeenCalledWith("bot-token", "-100456789", "123456789");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: GroupMemberStatus.ACTIVE, role: GroupMemberRole.ADMIN }) }));
  });

  it("fails closed when the signed user has no active membership", async () => {
    const database = { groupMembership: { findFirst: vi.fn(async () => null) } } as unknown as PrismaClient;
    await expect(resolveDashboardWorkspace("123456789", workspaceId, "bot-token", database)).rejects.toBeInstanceOf(DashboardGroupAccessError);
  });
});
