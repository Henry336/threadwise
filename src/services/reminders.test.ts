import { describe, expect, it } from "vitest";
import { nextReminderAfterSettingChange, shouldBypassReminderLimits } from "./reminders";

describe("reminder policy", () => {
  it("bypasses quiet hours and reminder caps for the first scheduled due reminder", () => {
    expect(
      shouldBypassReminderLimits({
        dueAt: new Date("2026-07-05T17:29:00.000Z"),
        lastRemindedAt: null,
        reminderCount: 0
      })
    ).toBe(true);
  });

  it("does not bypass quiet hours for repeated nudges", () => {
    expect(
      shouldBypassReminderLimits({
        dueAt: new Date("2026-07-05T17:29:00.000Z"),
        lastRemindedAt: new Date("2026-07-05T17:29:10.000Z"),
        reminderCount: 1
      })
    ).toBe(false);
  });

  it("does not bypass quiet hours for interval-only tasks", () => {
    expect(
      shouldBypassReminderLimits({
        dueAt: null,
        lastRemindedAt: null,
        reminderCount: 0
      })
    ).toBe(false);
  });

  it("keeps a future first scheduled reminder at its explicit due time when interval changes", () => {
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
        15
      ).toISOString()
    ).toBe(dueAt.toISOString());
  });

  it("pulls repeated reminders onto the new shorter interval", () => {
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
        15
      ).toISOString()
    ).toBe("2026-07-05T00:15:00.000Z");
  });
});
