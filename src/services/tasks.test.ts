import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findFirstOrThrow: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    task: { findFirstOrThrow: mocks.findFirstOrThrow },
    $transaction: mocks.transaction
  }
}));

describe("task completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not mutate or record another completion for an already-completed task", async () => {
    const completedTask = {
      id: "task-uuid-1",
      userId: "user-1",
      publicId: "TASK-1",
      title: "Submit report",
      description: null,
      sourceText: "Submit report",
      status: TaskStatus.DONE,
      dueAt: null,
      timezone: "Asia/Singapore",
      recurrenceRule: null,
      recurrenceIntervalDays: null,
      reminderIntervalMinutes: 180,
      nextReminderAt: null,
      snoozedUntil: null,
      completedAt: new Date("2026-07-12T10:00:00.000Z"),
      reminderCount: 0,
      pinnedAt: null,
      archivedAt: null,
      createdAt: new Date("2026-07-12T09:00:00.000Z"),
      updatedAt: new Date("2026-07-12T10:00:00.000Z")
    };
    mocks.findFirstOrThrow.mockResolvedValue(completedTask);
    const { completeTask } = await import("./tasks");

    const result = await completeTask("user-1", "task-uuid-1");

    expect(result).toEqual({ task: completedTask, alreadyCompleted: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
