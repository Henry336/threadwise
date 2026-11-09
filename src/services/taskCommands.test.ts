import { beforeEach, describe, expect, it, vi } from "vitest";

const tasks = vi.hoisted(() => ({
  completeTask: vi.fn(),
  snoozeTask: vi.fn(),
  cancelTask: vi.fn(),
  assignTask: vi.fn(),
  unassignTask: vi.fn(),
  formatAssignee: vi.fn(() => "@alex"),
}));
const policy = vi.hoisted(() => ({ assertGroupTaskAction: vi.fn() }));
const collaboration = vi.hoisted(() => ({ recordGroupTaskActivity: vi.fn() }));

vi.mock("./tasks", () => tasks);
vi.mock("./groupCollaboration", () => collaboration);
vi.mock("./groupTaskPolicy", async () => {
  const actual = await vi.importActual<typeof import("./groupTaskPolicy")>("./groupTaskPolicy");
  return { ...actual, ...policy };
});

import { GroupTaskPermissionError } from "./groupTaskPolicy";
import { executeTaskCommand, type TaskCommandActor } from "./taskCommands";

const member = { telegramId: "7", displayName: "Alex" };
const owner: TaskCommandActor = { inGroup: false };
const groupMember = (isManager = false): TaskCommandActor => ({ inGroup: true, member, isManager: vi.fn(async () => isManager) });
const task = { id: "t1", publicId: "TASK-3", title: "Buy milk", status: "OPEN" };

describe("executeTaskCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("complete", () => {
    it("completes a private task with no policy check or activity record", async () => {
      tasks.completeTask.mockResolvedValueOnce({ task: { ...task, status: "DONE" }, alreadyCompleted: false });
      const result = await executeTaskCommand({ action: "complete", ref: "3", userId: "u1", actor: owner, source: "text" });
      expect(result).toMatchObject({ action: "complete", status: "completed" });
      expect(tasks.completeTask).toHaveBeenCalledWith("u1", "3", undefined);
      expect(policy.assertGroupTaskAction).not.toHaveBeenCalled();
      expect(collaboration.recordGroupTaskActivity).not.toHaveBeenCalled();
    });

    it("checks the group policy, passes the shown due time, and records the completion", async () => {
      const shown = new Date("2026-11-09T10:00:00Z");
      tasks.completeTask.mockResolvedValueOnce({ task: { ...task, status: "DONE" }, alreadyCompleted: false });
      await executeTaskCommand({ action: "complete", ref: "t1", userId: "chat-owner", actor: groupMember(), source: "button", expectedDueAt: shown });
      expect(policy.assertGroupTaskAction).toHaveBeenCalledWith("chat-owner", "t1", member, false, "complete");
      expect(tasks.completeTask).toHaveBeenCalledWith("chat-owner", "t1", shown);
      expect(collaboration.recordGroupTaskActivity).toHaveBeenCalledWith("chat-owner", member, "TASK_COMPLETED", expect.objectContaining({ publicId: "TASK-3" }), "Alex completed TASK-3.");
    });

    it("tells an already finished task apart from a stale recurring occurrence, and logs neither", async () => {
      tasks.completeTask.mockResolvedValueOnce({ task: { ...task, status: "DONE" }, alreadyCompleted: true });
      await expect(executeTaskCommand({ action: "complete", ref: "t1", userId: "u", actor: groupMember(), source: "button" }))
        .resolves.toMatchObject({ status: "already-completed" });
      tasks.completeTask.mockResolvedValueOnce({ task, alreadyCompleted: true });
      await expect(executeTaskCommand({ action: "complete", ref: "t1", userId: "u", actor: groupMember(), source: "button" }))
        .resolves.toMatchObject({ status: "stale" });
      expect(collaboration.recordGroupTaskActivity).not.toHaveBeenCalled();
    });

    it("throws a policy refusal before touching the task, asking for admin status only after it", async () => {
      const refusal = new GroupTaskPermissionError("Only the assignee can complete this.");
      policy.assertGroupTaskAction.mockRejectedValueOnce(refusal);
      const actor = groupMember(false);
      await expect(executeTaskCommand({ action: "complete", ref: "TASK-3", userId: "u", actor, source: "command" })).rejects.toBe(refusal);
      expect(actor.inGroup && actor.isManager).toHaveBeenCalledOnce();
      expect(tasks.completeTask).not.toHaveBeenCalled();
    });

    it("re-checks as a manager when the member is a current admin", async () => {
      policy.assertGroupTaskAction.mockRejectedValueOnce(new GroupTaskPermissionError("no")).mockResolvedValueOnce({});
      tasks.completeTask.mockResolvedValueOnce({ task: { ...task, status: "DONE" }, alreadyCompleted: false });
      await executeTaskCommand({ action: "complete", ref: "TASK-3", userId: "u", actor: groupMember(true), source: "command" });
      expect(policy.assertGroupTaskAction).toHaveBeenLastCalledWith("u", "TASK-3", member, true, "complete");
      expect(tasks.completeTask).toHaveBeenCalled();
    });
  });

  it("snooze checks the snooze rule and records nothing", async () => {
    tasks.snoozeTask.mockResolvedValueOnce(task);
    await expect(executeTaskCommand({ action: "snooze", ref: "TASK-3", duration: "2h", userId: "u", actor: groupMember(), source: "text" }))
      .resolves.toEqual({ action: "snooze", task });
    expect(policy.assertGroupTaskAction).toHaveBeenCalledWith("u", "TASK-3", member, false, "snooze");
    expect(tasks.snoozeTask).toHaveBeenCalledWith("u", "TASK-3", "2h");
    expect(collaboration.recordGroupTaskActivity).not.toHaveBeenCalled();
  });

  it("cancel needs the manage rule", async () => {
    tasks.cancelTask.mockResolvedValueOnce(task);
    await executeTaskCommand({ action: "cancel", ref: "TASK-3", userId: "u", actor: groupMember(), source: "button" });
    expect(policy.assertGroupTaskAction).toHaveBeenCalledWith("u", "TASK-3", member, false, "manage");
    expect(tasks.cancelTask).toHaveBeenCalledWith("u", "TASK-3");
  });

  it("assign passes the mentions through and records who was assigned", async () => {
    const options = { mentions: [] };
    tasks.assignTask.mockResolvedValueOnce(task);
    await executeTaskCommand({ action: "assign", ref: "TASK-3", assignees: "@alex", options, userId: "u", actor: groupMember(), source: "command" });
    expect(tasks.assignTask).toHaveBeenCalledWith("u", "TASK-3", "@alex", options);
    expect(collaboration.recordGroupTaskActivity).toHaveBeenCalledWith("u", member, "TASK_ASSIGNED", task, "Alex assigned TASK-3 to @alex.");
  });

  it("unassign says 'updated' for one person and 'cleared' for everyone", async () => {
    tasks.unassignTask.mockResolvedValue(task);
    await executeTaskCommand({ action: "unassign", ref: "TASK-3", assignee: "@alex", options: {}, userId: "u", actor: groupMember(), source: "text" });
    await executeTaskCommand({ action: "unassign", ref: "TASK-3", userId: "u", actor: groupMember(), source: "command" });
    expect(tasks.unassignTask).toHaveBeenNthCalledWith(1, "u", "TASK-3", "@alex", {});
    expect(tasks.unassignTask).toHaveBeenNthCalledWith(2, "u", "TASK-3", undefined, undefined);
    expect(collaboration.recordGroupTaskActivity.mock.calls.map((call) => call[4])).toEqual([
      "Alex updated the assignees on TASK-3.",
      "Alex cleared the assignees on TASK-3.",
    ]);
  });
});
