import { GroupMemberStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { updateDashboardTaskCollaboration } from "./collaboration";
import { DashboardGroupAccessError, type DashboardWorkspaceScope } from "./workspaces";

describe("dashboard collaboration permissions", () => {
  it("does not let a regular member assign work to another group member", async () => {
    const scope: DashboardWorkspaceScope = {
      principalTelegramId: "1001",
      ownerTelegramId: "chat:-100456789",
      telegramChatId: "-100456789",
      workspace: { id: "workspace-1", kind: "GROUP", name: "Launch team", role: "MEMBER" }
    };
    const transaction = vi.fn();
    const database = {
      groupWorkspace: {
        findUnique: vi.fn(async () => ({
          id: "workspace-1",
          ownerUser: { id: "group-owner-1" },
          members: [
            { telegramId: "1001", username: "henry", firstName: "Henry", lastName: null, status: GroupMemberStatus.ACTIVE },
            { telegramId: "2002", username: "alex", firstName: "Alex", lastName: null, status: GroupMemberStatus.ACTIVE }
          ]
        }))
      },
      task: {
        findFirst: vi.fn(async () => ({
          id: "task-1",
          publicId: "TASK-1",
          title: "Prepare launch notes",
          assignees: []
        }))
      },
      $transaction: transaction
    } as unknown as PrismaClient;

    await expect(updateDashboardTaskCollaboration(
      scope,
      "TASK-1",
      { action: "assign", targetTelegramId: "2002" },
      undefined,
      database
    )).rejects.toBeInstanceOf(DashboardGroupAccessError);
    expect(transaction).not.toHaveBeenCalled();
  });
});
