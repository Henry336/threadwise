import { describe, expect, it } from "vitest";
import { dueNudgeStartAt, nextReminderAfterSettingChange, nextReminderAtAfterDelivery, shouldUseDueNudgePolicy } from "./reminders";

describe("reminder policy", () => {
  it("starts scheduled due nudges before the due time", () => {
    expect(
      dueNudgeStartAt(new Date("2026-07-05T17:29:00.000Z"), 5).toISOString()
    ).toBe("2026-07-05T17:24:00.000Z");
  });

  it("uses due nudge policy once the nudge window starts", () => {
    expect(
      shouldUseDueNudgePolicy({
        dueAt: new Date("2026-07-05T17:29:00.000Z"),
        dueNudgeMinutes: 5,
        now: new Date("2026-07-05T17:24:00.000Z")
      })
    ).toBe(true);
  });

  it("does not use due nudge policy for interval-only tasks", () => {
    expect(
      shouldUseDueNudgePolicy({
        dueAt: null,
        dueNudgeMinutes: 5,
        now: new Date("2026-07-05T17:24:00.000Z")
      })
    ).toBe(false);
  });

  it("keeps a future scheduled reminder at the due-nudge start when interval changes", () => {
    const now = new Date("2026-07-05T00:00:00.000Z");
    const dueAt = new Date("2026-07-05T02:00:00.000Z");

    expect(
      nextReminderAfterSettingChange(
        {
          dueAt,
          nextReminderAt: dueAt,
          lastRemindedAt: null,
          reminderCount: 0
        },
        now,
        15,
        5
      ).toISOString()
    ).toBe("2026-07-05T01:55:00.000Z");
  });

  it("keeps dated tasks nudging on the due-nudge cadence after delivery", () => {
    expect(
      nextReminderAtAfterDelivery({
        now: new Date("2026-07-05T17:24:00.000Z"),
        dueAt: new Date("2026-07-05T17:29:00.000Z"),
        dueNudgeMinutes: 5,
        intervalMinutes: 180
      }).toISOString()
    ).toBe("2026-07-05T17:29:00.000Z");
  });

  it("pulls overdue dated reminders onto the due-nudge cadence", () => {
    const now = new Date("2026-07-05T00:00:00.000Z");

    expect(
      nextReminderAfterSettingChange(
        {
          dueAt: new Date("2026-07-04T23:00:00.000Z"),
          nextReminderAt: new Date("2026-07-05T03:00:00.000Z"),
          lastRemindedAt: new Date("2026-07-04T23:00:10.000Z"),
          reminderCount: 1
        },
        now,
        15,
        5
      ).toISOString()
    ).toBe("2026-07-05T00:05:00.000Z");
  });
});
