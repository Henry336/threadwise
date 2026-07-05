import { describe, expect, it } from "vitest";
import { shouldBypassReminderLimits } from "./reminders";

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
});
