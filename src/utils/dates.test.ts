import { describe, expect, it } from "vitest";
import { isWithinQuietHours, parseDueDate, parseDurationMinutes, splitReminderText } from "./dates";

describe("date utilities", () => {
  it("parses relative durations", () => {
    expect(parseDurationMinutes("1h", 30)).toBe(60);
    expect(parseDurationMinutes("2 days", 30)).toBe(2880);
    expect(parseDurationMinutes("45m", 30)).toBe(45);
  });

  it("parses tomorrow with a time", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    const due = parseDueDate("submit report tomorrow at 9am", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-06T01:00:00.000Z");
  });

  it("parses clock-only reminders as the next future occurrence", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    const due = parseDueDate("at 6pm", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-05T10:00:00.000Z");
  });

  it("parses weekday reminders", () => {
    const now = new Date("2026-07-06T01:00:00.000Z");
    const due = parseDueDate("next monday at 10am", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-13T02:00:00.000Z");
  });

  it("splits explicit reminder commands", () => {
    expect(splitReminderText("tomorrow at 9am | submit the form")).toEqual({
      whenText: "tomorrow at 9am",
      taskText: "submit the form"
    });
  });

  it("handles quiet hours across midnight", () => {
    expect(
      isWithinQuietHours(new Date("2026-07-05T15:00:00.000Z"), {
        timezone: "Asia/Singapore",
        start: "22:00",
        end: "08:00"
      })
    ).toBe(true);
  });
});
