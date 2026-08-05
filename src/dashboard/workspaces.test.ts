import { GroupMemberRole, GroupMemberStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertWorkspaceManager, DashboardGroupAccessError, listDashboardWorkspaces, resolveDashboardWorkspace } from "./workspaces";

describe("dashboard group workspace authorization", () => {
  const workspaceId = "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2";

  it("keeps personal scope on the signed Telegram subject", async () => {
    const scope = await resolveDashboardWorkspace("123456789", "personal", undefined, {} as PrismaClient);
    expect(scope).toMatchObject({ ownerTelegramId: "123456789", workspace: { kind: "PERSONAL", role: "OWNER" } });
  });

  it("resolves a shared owner only after a live Telegram membership check", async () => {
    const findUnique = vi.fn(async () => ({
      id: workspaceId,
      title: "Launch team",
      telegramChatId: "-100456789",
      isActive: true,
      ownerUser: { telegramId: "chat:-100456789" },
      _count: { members: 4 }
    }));
    const upsert = vi.fn(async () => ({}));
    const database = { groupWorkspace: { findUnique }, groupMembership: { upsert } } as unknown as PrismaClient;
    const verify = vi.fn(async () => GroupMemberRole.ADMIN);

    const scope = await resolveDashboardWorkspace("123456789", workspaceId, "bot-token", database, verify);

    expect(scope).toEqual({
      principalTelegramId: "123456789",
      ownerTelegramId: "chat:-100456789",
      telegramChatId: "-100456789",
      workspace: { id: workspaceId, kind: "GROUP", name: "Launch team", role: "ADMIN", memberCount: 4 }
    });
    expect(verify).toHaveBeenCalledWith("bot-token", "-100456789", "123456789");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_telegramId: { workspaceId, telegramId: "123456789" } },
      create: expect.objectContaining({ status: GroupMemberStatus.ACTIVE, role: GroupMemberRole.ADMIN })
    }));
  });

  it("labels only the configured owner's exact bound group as Study Mode", async () => {
    const telegramId = "900000001";
    const database = {
      user: { findUnique: vi.fn(async () => ({ firstName: "Henry", username: "henry" })) },
      groupMembership: { findMany: vi.fn(async () => ([
        {
          role: GroupMemberRole.OWNER,
          workspace: { id: workspaceId, title: "Study", telegramChatId: "-100900000001", _count: { members: 1 } },
        },
        {
          role: GroupMemberRole.OWNER,
          workspace: { id: "7cd8f630-05f4-48c0-b7fb-ffacbc4ff1a3", title: "Other", telegramChatId: "-100999", _count: { members: 3 } },
        },
      ])) },
      studyWorkspace: { findFirst: vi.fn(async () => ({ boundChatId: "-100900000001" })) },
    } as unknown as PrismaClient;

    const workspaces = await listDashboardWorkspaces(telegramId, database, {
      ownerTelegramId: telegramId,
      allowedChatId: "-100900000001",
    });

    expect(workspaces.find((workspace) => workspace.name === "Study")?.mode).toBe("STUDY");
    expect(workspaces.find((workspace) => workspace.name === "Other")?.mode).toBeUndefined();
    expect(workspaces.find((workspace) => workspace.kind === "PERSONAL")?.mode).toBeUndefined();
  });

  it("never probes for a Study workspace for another Telegram user", async () => {
    const studyLookup = vi.fn();
    const database = {
      user: { findUnique: vi.fn(async () => ({ firstName: "Guest", username: null })) },
      groupMembership: { findMany: vi.fn(async () => []) },
      studyWorkspace: { findFirst: studyLookup },
    } as unknown as PrismaClient;

    await listDashboardWorkspaces("123456789", database, {
      ownerTelegramId: "900000001",
      allowedChatId: "-100900000001",
    });

    expect(studyLookup).not.toHaveBeenCalled();
  });

  it("fails closed when the opaque workspace does not exist", async () => {
    const database = { groupWorkspace: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient;
    await expect(resolveDashboardWorkspace("123456789", workspaceId, "bot-token", database)).rejects.toBeInstanceOf(DashboardGroupAccessError);
  });

  it("freshly verifies Telegram authority before a privileged group mutation", async () => {
    const scope = {
      principalTelegramId: "123456789",
      ownerTelegramId: "chat:-100456789",
      telegramChatId: "-100456789",
      workspace: { id: workspaceId, kind: "GROUP" as const, name: "Launch team", role: "ADMIN" as const }
    };
    const demoted = vi.fn(async () => GroupMemberRole.MEMBER);

    await expect(assertWorkspaceManager(scope, "bot-token", demoted)).rejects.toThrow(
      "Only a Telegram group owner or administrator"
    );
    expect(demoted).toHaveBeenCalledWith("bot-token", "-100456789", "123456789", true);

    const owner = vi.fn(async () => GroupMemberRole.OWNER);
    await expect(assertWorkspaceManager(scope, "bot-token", owner)).resolves.toBeUndefined();
  });
});
