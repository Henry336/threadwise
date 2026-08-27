import { describe, expect, it } from "vitest";
import { calendarDateKey, parseTaskTimingIntent, splitTaskDraftText } from "./taskPlanning";

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
});

describe("task draft splitting", () => {
  it("splits comma, semicolon, and newline lists while respecting quoted commas", () => {
    expect(splitTaskDraftText('Buy veg, "Call Alice, Bob and Chen"; Prepare tutorial\n- Email group')).toEqual([
      "Buy veg",
      '"Call Alice, Bob and Chen"',
      "Prepare tutorial",
      "Email group",
    ]);
  });
});
