import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurrenceRule, TaskStatus } from "@prisma/client";

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
      undatedNudgeCount: 0,
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

describe("recurring task completion", () => {
  // "Water plants", daily at 19:00 Singapore time (11:00 UTC). It is now 18:00 on 10 Nov.
  const TODAY_DUE = new Date("2026-11-10T11:00:00.000Z");
  const TOMORROW_DUE = new Date("2026-11-11T11:00:00.000Z");

  function recurringTask(dueAt: Date) {
    return {
      id: "task-uuid-2",
      userId: "user-1",
      publicId: "TASK-2",
      title: "Water plants",
      description: null,
      sourceText: "Water plants daily 7pm",
      status: TaskStatus.OPEN,
      dueAt,
      timezone: "Asia/Singapore",
      recurrenceRule: RecurrenceRule.DAILY,
      recurrenceDayOfMonth: null,
      completedAt: null,
      nextReminderAt: dueAt,
      snoozedUntil: null,
    };
  }

  /** A fake transaction: `updateMany` reports `changedRows` rows changed. */
  function fakeTransaction(changedRows: number, rowAfterUpdate: object) {
    const tx = {
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: changedRows }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(rowAfterUpdate),
      },
      auditLog: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => unknown) => run(tx));
    return tx;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves to the next occurrence exactly once when the button matches", async () => {
    mocks.findFirstOrThrow.mockResolvedValue(recurringTask(TODAY_DUE));
    const tx = fakeTransaction(1, recurringTask(TOMORROW_DUE));
    const { completeTask } = await import("./tasks");

    const result = await completeTask("user-1", "task-uuid-2", TODAY_DUE);

    expect(result.alreadyCompleted).toBe(false);
    const update = tx.task.updateMany.mock.calls[0]?.[0];
    expect(update.where).toEqual({ id: "task-uuid-2", userId: "user-1", dueAt: TODAY_DUE });
    expect(update.data.dueAt).toEqual(TOMORROW_DUE);
    expect(update.data.status).toBe(TaskStatus.OPEN);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("ignores a tap on an old card after the task has already moved on", async () => {
    // Already completed today, so the task is now due tomorrow; the card still says today.
    mocks.findFirstOrThrow.mockResolvedValue(recurringTask(TOMORROW_DUE));
    const { completeTask } = await import("./tasks");

    const result = await completeTask("user-1", "task-uuid-2", TODAY_DUE);

    expect(result.alreadyCompleted).toBe(true);
    expect(result.task.dueAt).toEqual(TOMORROW_DUE);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("advances only once when two taps arrive at the same moment", async () => {
    // Both taps read today's due time; the first tap's update wins, so this one changes 0 rows.
    mocks.findFirstOrThrow.mockResolvedValue(recurringTask(TODAY_DUE));
    const tx = fakeTransaction(0, recurringTask(TOMORROW_DUE));
    const { completeTask } = await import("./tasks");

    const result = await completeTask("user-1", "task-uuid-2", TODAY_DUE);

    expect(result.alreadyCompleted).toBe(true);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("still completes from a text command, which has no due time", async () => {
    mocks.findFirstOrThrow.mockResolvedValue(recurringTask(TODAY_DUE));
    const tx = fakeTransaction(1, recurringTask(TOMORROW_DUE));
    const { completeTask } = await import("./tasks");

    const result = await completeTask("user-1", "TASK-2");

    expect(result.alreadyCompleted).toBe(false);
    expect(tx.task.updateMany).toHaveBeenCalledTimes(1);
  });
});
