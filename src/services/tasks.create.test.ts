import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settings } from "../test/builders";

const mocks = vi.hoisted(() => ({
  taskCreate: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "task-row", ...data })),
  undoCreate: vi.fn(async () => ({}))
}));

vi.mock("../db/prisma", () => {
  const tx = {
    task: { findMany: vi.fn(async () => [{ publicId: "TASK-4" }]), create: mocks.taskCreate },
    auditLog: { create: mocks.undoCreate }
  };
  return {
    prisma: {
      user: { findUniqueOrThrow: vi.fn(async () => ({ id: "user-1", settings: settings({ userId: "user-1", timezone: "Asia/Singapore" }) })) },
      $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx))
    }
  };
});
vi.mock("./googleCalendar", () => ({ syncTaskCalendarBestEffort: vi.fn(async () => "skipped"), removeTaskFromGoogleCalendar: vi.fn() }));

describe("createScheduledReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T02:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("writes exactly the row createTask writes for the same due time", async () => {
    const { createScheduledReminder, createTask } = await import("./tasks");
    const scheduledAt = new Date("2026-11-10T01:00:00.000Z");
    const text = "water the plants every week with @sam";
    const options = { mentions: [{ offset: 31, length: 4, username: "sam" }] };

    await createScheduledReminder("user-1", text, scheduledAt, {} as never, options);
    await createTask("user-1", text, { ...options, dueAt: scheduledAt });

    const [reminderRow, taskRow] = mocks.taskCreate.mock.calls.map((call) => call[0].data);
    // Assignee rows stamp respondedAt with the clock; fake timers keep both equal.
    // The old copy left status, completedAt and teamOwnerLabel to their schema
    // defaults (OPEN, null, null), so the stored rows match once those are filled in.
    expect({ status: "OPEN", completedAt: null, teamOwnerLabel: null, ...reminderRow }).toEqual(taskRow);
    expect(reminderRow).toMatchObject({
      publicId: "TASK-5",
      dueAt: scheduledAt,
      timezone: "Asia/Singapore",
      recurrenceRule: "WEEKLY",
      audience: "ASSIGNEES",
      assignedUsername: "sam"
    });
    expect(reminderRow?.calendarUrl).toEqual(expect.stringContaining("calendar.google.com"));
    expect(reminderRow?.nextReminderAt).toBeInstanceOf(Date);
  });
});
