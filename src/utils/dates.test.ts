import { describe, expect, it } from "vitest";
import { isWithinQuietHours, parseDueDate, parseDurationMinutes } from "./dates";

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

