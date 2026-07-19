import { GroupActivityType, TaskAssigneeStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  handoffTaskAssignment,
  setTaskAssignmentStatus,
  TaskAssignmentError,
  type CollaborationActor,
} from "./groupCollaboration";

const actor: CollaborationActor = {
  telegramId: "1001",
  username: "henry",
  displayName: "Henry",
};

function sharedTask(assignees: Array<Record<string, unknown>>) {
  return {
    id: "task-1",
    userId: "group-owner-1",
    publicId: "TASK-1",
    title: "Prepare the launch notes",
    assignees,
  };
}

describe("group collaboration", () => {
  it("records an assignee blocker and touches the shared task", async () => {
    const assignment = {
      id: "assignee-1",
      taskId: "task-1",
      telegramId: actor.telegramId,
      username: actor.username,
      displayName: actor.displayName,
      normalizedKey: `id:${actor.telegramId}`,
      status: TaskAssigneeStatus.PENDING,
      statusReason: null,
      respondedAt: null,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      updatedAt: new Date("2026-07-19T00:00:00.000Z"),
    };
    const task = sharedTask([assignment]);
    const taskAssigneeUpdate = vi.fn(async () => ({}));
    const taskUpdate = vi.fn(async () => ({}));
    const activityCreate = vi.fn(async () => ({}));
    const updated = sharedTask([{ ...assignment, status: TaskAssigneeStatus.BLOCKED, statusReason: "Waiting for access" }]);
    const tx = {
      taskAssignee: { update: taskAssigneeUpdate },
      task: { update: taskUpdate, findUniqueOrThrow: vi.fn(async () => updated) },
      groupWorkspace: { findUnique: vi.fn(async () => ({ id: "workspace-1" })) },
      groupActivity: { create: activityCreate },
    };
    const database = {
      task: { findFirst: vi.fn(async () => task) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    } as unknown as PrismaClient;

    const result = await setTaskAssignmentStatus(
      "group-owner-1",
      "TASK-1",
      actor,
      TaskAssigneeStatus.BLOCKED,
      "  Waiting   for access  ",
      database,
    );

    expect(result).toBe(updated);
    expect(taskAssigneeUpdate).toHaveBeenCalledWith({
      where: { id: assignment.id },
      data: expect.objectContaining({
        status: TaskAssigneeStatus.BLOCKED,
        statusReason: "Waiting for access",
        respondedAt: expect.any(Date),
      }),
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: task.id },
      data: { updatedAt: expect.any(Date) },
    });
    expect(activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        actorTelegramId: actor.telegramId,
        type: GroupActivityType.TASK_BLOCKED,
        taskPublicId: task.publicId,
      }),
    });
  });

  it("hands the current member's assignment to a new person as awaiting acknowledgement", async () => {
    const assignment = {
      id: "assignee-1",
      taskId: "task-1",
      telegramId: actor.telegramId,
      username: actor.username,
      displayName: actor.displayName,
      normalizedKey: `id:${actor.telegramId}`,
      status: TaskAssigneeStatus.ACCEPTED,
      statusReason: null,
      respondedAt: new Date("2026-07-19T01:00:00.000Z"),
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      updatedAt: new Date("2026-07-19T01:00:00.000Z"),
    };
    const task = sharedTask([assignment]);
    const nextAssignment = {
      ...assignment,
      id: "assignee-2",
      telegramId: null,
      username: "alex",
      displayName: "@alex",
      normalizedKey: "username:alex",
      status: TaskAssigneeStatus.PENDING,
      respondedAt: null,
    };
    const assigneeDelete = vi.fn(async () => ({}));
    const assigneeUpsert = vi.fn(async () => ({}));
    const taskUpdate = vi.fn(async () => ({}));
    const activityCreate = vi.fn(async () => ({}));
    const updated = sharedTask([nextAssignment]);
    const tx = {
      taskAssignee: {
        delete: assigneeDelete,
        upsert: assigneeUpsert,
        findMany: vi.fn(async () => [nextAssignment]),
      },
      task: { update: taskUpdate, findUniqueOrThrow: vi.fn(async () => updated) },
      groupWorkspace: { findUnique: vi.fn(async () => ({ id: "workspace-1" })) },
      groupActivity: { create: activityCreate },
    };
    const database = {
      task: { findFirst: vi.fn(async () => task) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    } as unknown as PrismaClient;

    const result = await handoffTaskAssignment(
      "group-owner-1",
      "TASK-1",
      actor,
      "@alex",
      {},
      "Henry is away",
      false,
      database,
    );

    expect(result).toBe(updated);
    expect(assigneeDelete).toHaveBeenCalledWith({ where: { id: assignment.id } });
    expect(assigneeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId_normalizedKey: { taskId: task.id, normalizedKey: "username:alex" } },
      update: expect.objectContaining({ username: "alex", status: TaskAssigneeStatus.PENDING }),
      create: expect.objectContaining({ username: "alex" }),
    }));
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: task.id },
      data: expect.objectContaining({ assignedUsername: "alex", updatedAt: expect.any(Date) }),
    });
    expect(activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: GroupActivityType.TASK_HANDED_OFF }),
    });
  });

  it("does not let an unrelated member respond to someone else's assignment", async () => {
    const task = sharedTask([{
      id: "assignee-1",
      telegramId: "2002",
      username: "alex",
      displayName: "Alex",
      status: TaskAssigneeStatus.PENDING,
    }]);
    const transaction = vi.fn();
    const database = {
      task: { findFirst: vi.fn(async () => task) },
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(setTaskAssignmentStatus(
      "group-owner-1",
      "TASK-1",
      actor,
      TaskAssigneeStatus.ACCEPTED,
      undefined,
      database,
    )).rejects.toBeInstanceOf(TaskAssignmentError);
    expect(transaction).not.toHaveBeenCalled();
  });
});
