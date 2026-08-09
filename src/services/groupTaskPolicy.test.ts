import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertGroupTaskAction, claimGroupTask, getGroupTaskAccess, GroupTaskPermissionError } from "./groupTaskPolicy";

function databaseFor(options: { creator?: string; assignees?: string[] } = {}): PrismaClient {
  const assignees = (options.assignees ?? []).map((telegramId, index) => ({
    id: `assignee-${index}`,
    telegramId,
    username: null,
    displayName: telegramId,
  }));
  return {
    groupWorkspace: {
      findUnique: vi.fn(async () => ({ id: "workspace-1", ownerUser: { telegramId: "owner" } })),
    },
    task: {
      findFirst: vi.fn(async () => ({ id: "task-1", publicId: "TASK-1", title: "Ship", assignees })),
    },
    groupActivity: {
      findFirst: vi.fn(async () => options.creator ? { actorTelegramId: options.creator } : null),
    },
  } as unknown as PrismaClient;
}

describe("group task authorization", () => {
  it("lets an assignee complete and snooze but not reassign", async () => {
    const database = databaseFor({ creator: "creator", assignees: ["assignee"] });
    const actor = { telegramId: "assignee", displayName: "Assignee" };
    await expect(assertGroupTaskAction("group-owner", "TASK-1", actor, false, "complete", database)).resolves.toBeTruthy();
    await expect(assertGroupTaskAction("group-owner", "TASK-1", actor, false, "snooze", database)).resolves.toBeTruthy();
    await expect(assertGroupTaskAction("group-owner", "TASK-1", actor, false, "manage", database)).rejects.toBeInstanceOf(GroupTaskPermissionError);
  });

  it("lets the creator or a verified manager reassign, but not an unrelated member", async () => {
    const database = databaseFor({ creator: "creator", assignees: ["assignee"] });
    await expect(assertGroupTaskAction("group-owner", "TASK-1", { telegramId: "creator", displayName: "Creator" }, false, "manage", database)).resolves.toBeTruthy();
    await expect(assertGroupTaskAction("group-owner", "TASK-1", { telegramId: "admin", displayName: "Admin" }, true, "manage", database)).resolves.toBeTruthy();
    await expect(assertGroupTaskAction("group-owner", "TASK-1", { telegramId: "other", displayName: "Other" }, false, "complete", database)).rejects.toBeInstanceOf(GroupTaskPermissionError);
  });

  it("offers claim only while a task remains unassigned", async () => {
    const open = await getGroupTaskAccess("group-owner", "TASK-1", { telegramId: "member", displayName: "Member" }, false, databaseFor());
    const assigned = await getGroupTaskAccess("group-owner", "TASK-1", { telegramId: "member", displayName: "Member" }, false, databaseFor({ assignees: ["someone"] }));
    expect(open.audience).toBe("unassigned");
    expect(open.canClaim).toBe(true);
    expect(assigned.canClaim).toBe(false);
  });

  it("rejects a claim when another member wins the atomic assignment update", async () => {
    const create = vi.fn();
    const transactionTask = {
      findUniqueOrThrow: vi.fn(async () => ({ id: "task-1", publicId: "TASK-1", title: "Ship", assignees: [] })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    const database = {
      groupWorkspace: {
        findUnique: vi.fn(async () => ({ id: "workspace-1", ownerUser: { telegramId: "owner" } })),
      },
      task: {
        findFirst: vi.fn(async () => ({ id: "task-1", publicId: "TASK-1", title: "Ship", assignees: [] })),
      },
      groupActivity: {
        findFirst: vi.fn(async () => ({ actorTelegramId: "creator" })),
      },
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({
        task: transactionTask,
        taskAssignee: { create },
        groupActivity: { create: vi.fn() },
      })),
    } as unknown as PrismaClient;

    await expect(claimGroupTask("group-owner", "TASK-1", {
      telegramId: "member",
      displayName: "Member",
    }, database)).rejects.toThrow("was just claimed by someone else");
    expect(create).not.toHaveBeenCalled();
  });
});
