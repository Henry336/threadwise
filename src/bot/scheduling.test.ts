import { describe, expect, it } from "vitest";
import type { AvailabilityPollView } from "../services/groupScheduling";
import { groupScheduleMiniAppUrl } from "./links";
import { availabilityPollKeyboard, formatAvailabilityPollCard } from "./scheduling";

const poll: AvailabilityPollView = {
  id: "poll-id",
  publicId: "TIME-A1B2C3",
  title: "Project rehearsal",
  status: "OPEN",
  startDate: "2026-07-24",
  endDate: "2026-07-26",
  timezone: "Asia/Singapore",
  durationMinutes: 60,
  dayStartMinutes: 480,
  dayEndMinutes: 1320,
  slotMinutes: 30,
  revision: 4,
  createdByName: "Maya",
  createdAt: "2026-07-23T10:00:00.000Z",
  updatedAt: "2026-07-23T10:05:00.000Z",
  slots: [],
  bestSlots: [{ startAt: "2026-07-24T01:00:00.000Z", endAt: "2026-07-24T02:00:00.000Z", availableCount: 3 }],
  respondentCount: 3,
  memberCount: 4,
  respondents: [],
  pendingMembers: [],
  viewerCalendar: { connected: true, synced: false },
};

describe("Telegram availability poll card", () => {
  it("keeps one compact message and links the shared Mini App", () => {
    const text = formatAvailabilityPollCard(poll);
    expect(text).toContain("Project rehearsal");
    expect(text).toContain("3/4 responded");
    expect(text.length).toBeLessThan(500);
    const buttons = availabilityPollKeyboard(poll, "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2", "threadwise_1_bot").inline_keyboard.flat();
    expect(buttons).toContainEqual(expect.objectContaining({ text: "Add or update availability", url: expect.stringContaining("startapp=") }));
    expect(buttons).toContainEqual(expect.objectContaining({ callback_data: "schedule:final:TIME-A1B2C3:0:4" }));
    expect(buttons).toContainEqual(expect.objectContaining({ callback_data: "schedule:nudge:TIME-A1B2C3" }));
  });

  it("never exposes a member's private Calendar event link in the shared card", () => {
    const finalized: AvailabilityPollView = { ...poll, status: "FINALIZED", finalStartAt: poll.bestSlots[0]!.startAt, finalEndAt: poll.bestSlots[0]!.endAt, viewerCalendar: { connected: true, synced: true, eventUrl: "https://calendar.google.com/private-event" } };
    const keyboard = availabilityPollKeyboard(finalized, "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2", "threadwise_1_bot");
    expect(JSON.stringify(keyboard.inline_keyboard)).not.toContain("private-event");
    expect(keyboard.inline_keyboard.flat()).toContainEqual(expect.objectContaining({ callback_data: "schedule:calendar:TIME-A1B2C3" }));
  });

  it("preserves the selected poll in the direct dashboard fallback", () => {
    const url = new URL(groupScheduleMiniAppUrl(undefined, "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2", "TIME-A1B2C3"));
    expect(url.pathname).toBe("/api/workspace/select");
    expect(url.searchParams.get("workspace")).toBe("6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2");
    expect(url.searchParams.get("next")).toBe("/dashboard?view=schedule&poll=TIME-A1B2C3");
  });
});
