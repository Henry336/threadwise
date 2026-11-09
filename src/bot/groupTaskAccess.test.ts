import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ assertGroupTaskAction: vi.fn(), getGroupTaskAccess: vi.fn() }));
const workspaces = vi.hoisted(() => ({ isGroupManager: vi.fn() }));

vi.mock("../services/groupTaskPolicy", async () => {
  const actual = await vi.importActual<typeof import("../services/groupTaskPolicy")>("../services/groupTaskPolicy");
  return { ...actual, ...policy };
});
vi.mock("../services/groupWorkspaces", () => workspaces);
vi.mock("../services/groupCollaboration", () => ({ collaborationActorFromContext: () => ({ telegramId: "7" }) }));

import { GroupTaskPermissionError } from "../services/groupTaskPolicy";
import { assertGroupTaskActionForContext, groupTaskKeyboardAccess } from "./groupTaskAccess";

const ctx = {} as Context;

describe("lazy group manager checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips the Telegram admin lookup when the creator or assignee rules already allow the action", async () => {
    policy.assertGroupTaskAction.mockResolvedValueOnce({ canComplete: true });
    await assertGroupTaskActionForContext(ctx, "owner", "TASK-1", "complete");
    expect(workspaces.isGroupManager).not.toHaveBeenCalled();
    expect(policy.assertGroupTaskAction).toHaveBeenCalledWith("owner", "TASK-1", { telegramId: "7" }, false, "complete");
  });

  it("asks for admin status only after a refusal, and keeps the refusal when the lookup says no", async () => {
    const refusal = new GroupTaskPermissionError("no");
    policy.assertGroupTaskAction.mockRejectedValueOnce(refusal);
    workspaces.isGroupManager.mockResolvedValueOnce(false);
    await expect(assertGroupTaskActionForContext(ctx, "owner", "TASK-1", "manage")).rejects.toBe(refusal);
    expect(policy.assertGroupTaskAction).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates as a manager when the actor is a current admin", async () => {
    policy.assertGroupTaskAction.mockRejectedValueOnce(new GroupTaskPermissionError("no")).mockResolvedValueOnce({ canManage: true });
    workspaces.isGroupManager.mockResolvedValueOnce(true);
    await expect(assertGroupTaskActionForContext(ctx, "owner", "TASK-1", "manage")).resolves.toEqual({ canManage: true });
    expect(policy.assertGroupTaskAction).toHaveBeenLastCalledWith("owner", "TASK-1", { telegramId: "7" }, true, "manage");
  });

  it("only checks admin status for the keyboard when the actor would otherwise see the 'other' view", async () => {
    policy.getGroupTaskAccess.mockResolvedValueOnce({ audience: "assignee" });
    await groupTaskKeyboardAccess(ctx, "owner", "TASK-1");
    expect(workspaces.isGroupManager).not.toHaveBeenCalled();

    policy.getGroupTaskAccess.mockResolvedValueOnce({ audience: "other" }).mockResolvedValueOnce({ audience: "manager" });
    workspaces.isGroupManager.mockResolvedValueOnce(true);
    await expect(groupTaskKeyboardAccess(ctx, "owner", "TASK-1")).resolves.toEqual({ audience: "manager" });
  });
});
