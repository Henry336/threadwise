import { GroupMemberRole, GroupMemberStatus } from "@prisma/client";
import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  groupWorkspace: { findUnique: vi.fn() },
  groupMembership: { upsert: vi.fn() },
}));
vi.mock("../db/prisma", () => ({ prisma }));

import { refreshGroupMemberRole } from "./groupWorkspaces";

const ctx = {
  chat: { id: -100123, type: "supergroup" },
  from: { id: 42, first_name: "Ada" },
  api: { getChatMember: vi.fn(async () => ({ status: "administrator" })) },
} as unknown as Context;

describe("refreshGroupMemberRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips the write when Telegram reports the stored role", async () => {
    prisma.groupWorkspace.findUnique.mockResolvedValue({
      id: "ws-1",
      members: [{ role: GroupMemberRole.ADMIN, status: GroupMemberStatus.ACTIVE }],
    });
    await expect(refreshGroupMemberRole(ctx)).resolves.toBe(GroupMemberRole.ADMIN);
    expect(prisma.groupMembership.upsert).not.toHaveBeenCalled();
  });

  it("writes a changed role or a new member", async () => {
    prisma.groupWorkspace.findUnique.mockResolvedValue({
      id: "ws-1",
      members: [{ role: GroupMemberRole.MEMBER, status: GroupMemberStatus.ACTIVE }],
    });
    await refreshGroupMemberRole(ctx);
    expect(prisma.groupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ role: GroupMemberRole.ADMIN, status: GroupMemberStatus.ACTIVE }),
    }));

    prisma.groupWorkspace.findUnique.mockResolvedValue({ id: "ws-1", members: [] });
    await refreshGroupMemberRole(ctx);
    expect(prisma.groupMembership.upsert).toHaveBeenCalledTimes(2);
  });
});
