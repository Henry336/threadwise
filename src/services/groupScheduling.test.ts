import { describe, expect, it } from "vitest";
import {
  GroupSchedulingError,
  generateAvailabilitySlots,
  isFindTimeIntent,
  parseFindTimeRequest,
  rankAvailabilitySlots,
  validateAvailabilityPollInput,
} from "./groupScheduling";

describe("group availability scheduling", () => {
  it("generates touch-grid cells in the organizer timezone", () => {
    const slots = generateAvailabilitySlots({
      startDate: "2026-07-24",
      endDate: "2026-07-25",
      timezone: "Asia/Singapore",
      durationMinutes: 60,
      dayStartMinutes: 9 * 60,
      dayEndMinutes: 11 * 60,
      slotMinutes: 30,
    });
    expect(slots).toHaveLength(8);
    expect(slots[0]?.toISOString()).toBe("2026-07-24T01:00:00.000Z");
    expect(slots.at(-1)?.toISOString()).toBe("2026-07-25T02:30:00.000Z");
  });

  it("requires every cell covered by the meeting duration and never crosses a day boundary", () => {
    const slots = [
      "2026-07-24T01:00:00.000Z",
      "2026-07-24T01:30:00.000Z",
      "2026-07-24T02:00:00.000Z",
      "2026-07-25T01:00:00.000Z",
    ].map((value) => new Date(value));
    const ranked = rankAvailabilitySlots(slots, [
      { availableStarts: slots.slice(0, 3) },
      { availableStarts: slots.slice(0, 2) },
      { availableStarts: [slots[0]!, slots[2]!] },
    ], 60, 30, "Asia/Singapore");
    expect(ranked.map((slot) => [slot.startAt, slot.availableCount])).toEqual([
      ["2026-07-24T01:00:00.000Z", 2],
      ["2026-07-24T01:30:00.000Z", 1],
    ]);

    const midnightSlots = [
      "2026-07-24T15:30:00.000Z",
      "2026-07-24T16:00:00.000Z",
      "2026-07-24T16:30:00.000Z",
    ].map((value) => new Date(value));
    expect(rankAvailabilitySlots(midnightSlots, [{ availableStarts: midnightSlots }], 90, 30, "Asia/Singapore")).toEqual([]);
  });

  it("parses focused natural-language poll requests without hijacking ordinary scheduling", () => {
    const input = parseFindTimeRequest(
      "Find a time for project rehearsal next week for 90 minutes",
      "Asia/Singapore",
      new Date("2026-07-23T04:00:00.000Z"),
    );
    expect(input).toMatchObject({ title: "project rehearsal", startDate: "2026-07-27", endDate: "2026-08-02", durationMinutes: 90 });
    expect(isFindTimeIntent("Threadwise, find a time for everyone next week")).toBe(true);
    expect(isFindTimeIntent("Schedule my interview tomorrow at 4pm")).toBe(false);
  });

  it("bounds date ranges, duration, and time zones", () => {
    expect(() => validateAvailabilityPollInput({ title: "Long poll", startDate: "2026-07-01", endDate: "2026-07-31", timezone: "Asia/Singapore", durationMinutes: 60 })).toThrow(GroupSchedulingError);
    expect(() => validateAvailabilityPollInput({ title: "Bad zone", startDate: "2026-07-24", endDate: "2026-07-24", timezone: "Moon/Sea", durationMinutes: 60 })).toThrow("valid time zone");
  });
});
