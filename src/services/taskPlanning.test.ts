import { describe, expect, it } from "vitest";
import { calendarDateKey, parseTaskTimingIntent, splitTaskDraftText, todayCalendarDate } from "./taskPlanning";

const NOW = new Date("2026-08-31T01:00:00.000Z");
const ZONE = "Asia/Singapore";

describe("task planning intent", () => {
  it("defaults an ordinary task to today without inventing a deadline or reminder", () => {
    const parsed = parseTaskTimingIntent("Prepare CS2102 Tutorial 1", ZONE, NOW);
    expect(calendarDateKey(parsed.plannedFor!)).toBe("2026-08-31");
    expect(parsed.dueAt).toBeUndefined();
    expect(parsed.reminderAt).toBeUndefined();
    expect(parsed.warnings).toEqual([]);
  });

  it("treats tomorrow as a planned day and by Wednesday as a deadline", () => {
    const planned = parseTaskTimingIntent("Return library book tomorrow", ZONE, NOW);
    expect(calendarDateKey(planned.plannedFor!)).toBe("2026-09-01");
    expect(planned.dueAt).toBeUndefined();

    const dated = parseTaskTimingIntent("Submit CFG reflection by Wednesday at 6 PM", ZONE, NOW);
    expect(calendarDateKey(dated.plannedFor!)).toBe("2026-08-31");
    expect(dated.dueAt?.toISOString()).toBe("2026-09-02T10:00:00.000Z");
  });

  it("keeps explicitly unscheduled work out of Today", () => {
    const parsed = parseTaskTimingIntent("Replace worn-out charger, no day yet", ZONE, NOW);
    expect(parsed.explicitlyUnscheduled).toBe(true);
    expect(parsed.plannedFor).toBeUndefined();
  });

  it("asks for one focused clarification for a bare trailing weekday", () => {
    const parsed = parseTaskTimingIntent("Finish database lab Friday", ZONE, NOW);
    expect(parsed.warnings).toContain("AMBIGUOUS_BARE_DATE");
    expect(parsed.plannedFor).toBeUndefined();
    expect(parsed.dueAt).toBeUndefined();
  });

  it("keeps a reminder separate from task planning and deadlines", () => {
    const parsed = parseTaskTimingIntent("Remind me tomorrow at 5 PM to return the library book", ZONE, NOW);
    expect(parsed.reminderAt?.toISOString()).toBe("2026-09-01T09:00:00.000Z");
    expect(parsed.plannedFor).toBeUndefined();
    expect(parsed.dueAt).toBeUndefined();
    expect(parsed.warnings).toContain("REMINDER_REQUIRES_CONFIRMATION");
  });

  it("uses the active timezone when the same instant crosses a local midnight", () => {
    const instant = new Date("2026-08-31T16:30:00.000Z");
    expect(calendarDateKey(todayCalendarDate("Asia/Singapore", instant))).toBe("2026-09-01");
    expect(calendarDateKey(todayCalendarDate("America/New_York", instant))).toBe("2026-08-31");
    expect(calendarDateKey(parseTaskTimingIntent("Prepare tutorial", "Asia/Singapore", instant).plannedFor!)).toBe("2026-09-01");
    expect(calendarDateKey(parseTaskTimingIntent("Prepare tutorial", "America/New_York", instant).plannedFor!)).toBe("2026-08-31");
  });

  it("keeps calendar dates stable through DST gaps and repeated hours", () => {
    expect(calendarDateKey(todayCalendarDate("America/New_York", new Date("2026-03-08T06:59:00.000Z")))).toBe("2026-03-08");
    expect(calendarDateKey(todayCalendarDate("America/New_York", new Date("2026-03-08T07:01:00.000Z")))).toBe("2026-03-08");
    expect(calendarDateKey(todayCalendarDate("America/New_York", new Date("2026-11-01T05:30:00.000Z")))).toBe("2026-11-01");
    expect(calendarDateKey(todayCalendarDate("America/New_York", new Date("2026-11-01T06:30:00.000Z")))).toBe("2026-11-01");
  });
});

describe("task draft splitting", () => {
  it("uses hard line/semicolon boundaries and only splits commas before another clear action", () => {
    expect(splitTaskDraftText('Buy veg, "Call Alice, Bob and Chen"; Prepare tutorial\n- Email group')).toEqual([
      "Buy veg",
      '"Call Alice, Bob and Chen"',
      "Prepare tutorial",
      "Email group",
    ]);
    expect(splitTaskDraftText("Start CS2103T increments, Prepare CS2102 tutorial, Buy groceries")).toEqual([
      "Start CS2103T increments",
      "Prepare CS2102 tutorial",
      "Buy groceries",
    ]);
  });

  it("keeps ambiguous comma-separated objects inside one task", () => {
    expect(splitTaskDraftText("Do taxes, laundry, homework")).toEqual(["Do taxes, laundry, homework"]);
    expect(splitTaskDraftText("Meet mom, dad")).toEqual(["Meet mom, dad"]);
    expect(splitTaskDraftText("Email Alice, Bob and Chen, prepare tutorial")).toEqual([
      "Email Alice, Bob and Chen",
      "prepare tutorial",
    ]);
  });

  it("supports plain, bulleted, checkbox, and numbered newline lists", () => {
    expect(splitTaskDraftText("Do taxes\nLaundry\nHomework")).toEqual(["Do taxes", "Laundry", "Homework"]);
    expect(splitTaskDraftText("- Do taxes\n[ ] Laundry\n3. Homework")).toEqual(["Do taxes", "Laundry", "Homework"]);
  });
});
