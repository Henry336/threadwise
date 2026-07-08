import { describe, expect, it } from "vitest";
import { RecurrenceRule } from "@prisma/client";
import { formatDateTimeForUser, isWithinQuietHours, nextRecurringDueAt, parseDueDate, parseDurationMinutes, parseRecurrencePattern, splitReminderText, stripRecurrenceText } from "./dates";

describe("date utilities", () => {
  it("parses relative durations", () => {
    expect(parseDurationMinutes("1h", 30)).toBe(60);
    expect(parseDurationMinutes("2 days", 30)).toBe(2880);
    expect(parseDurationMinutes("45m", 30)).toBe(45);
  });

  it("parses natural minute abbreviations used in reminders", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    const due = parseDueDate("remind me to check the launderette in 60 mins", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-05T05:00:00.000Z");
  });

  it("parses after-based relative reminders", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    const due = parseDueDate("remind me to check the washer after 5 mins", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-05T04:05:00.000Z");
  });

  it.each([
    "remind me about the meeting in 2 hours",
    "remind me about the meeting in 2 hrs",
    "remind me about the meeting in 2 hr",
    "remind me about the meeting in 2 hour"
  ])("parses hour variants: %s", (text) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe("2026-07-05T06:00:00.000Z");
  });

  it.each([
    "remind me to leave my house in 20 mins",
    "remind me to leave my house in 20 min",
    "remind me to leave my house in 20 minute",
    "remind me to leave my house in 20 minutes"
  ])("parses minute variants: %s", (text) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe("2026-07-05T04:20:00.000Z");
  });

  it.each([
    "please remind me to prepare a gift at 3:20 pm",
    "set a reminder for school at 9 am"
  ])("parses clock-based reminder text: %s", (text) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)).toBeInstanceOf(Date);
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

  it("parses same-day early-morning reminders in the user timezone", () => {
    const now = new Date("2026-07-05T17:15:00.000Z");
    const due = parseDueDate("remind me to go to the bathroom today at 1:19 am", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-05T17:19:00.000Z");
  });

  it("formats stored UTC dates in the user's timezone", () => {
    const due = new Date("2026-07-05T17:19:00.000Z");
    expect(formatDateTimeForUser(due, "Asia/Singapore")).toContain("1:19");
  });

  it("parses weekday reminders", () => {
    const now = new Date("2026-07-06T01:00:00.000Z");
    const due = parseDueDate("next monday at 10am", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-13T02:00:00.000Z");
  });

  it.each([
    ["remind me to have dinner at 7pm every day", RecurrenceRule.DAILY, 1],
    ["set a reminder to take a walk at 5 pm daily", RecurrenceRule.DAILY, 1],
    ["remind me to clean the fridge at 9am every week", RecurrenceRule.WEEKLY, 7]
  ])("parses recurrence patterns: %s", (text, rule, intervalDays) => {
    expect(parseRecurrencePattern(text)).toEqual({ rule, intervalDays });
  });

  it("strips recurrence words before task title extraction", () => {
    expect(stripRecurrenceText("take my dog out for a walk every day at 5 pm")).toBe("take my dog out for a walk at 5 pm");
  });

  it("advances recurring due dates to the next future occurrence", () => {
    expect(
      nextRecurringDueAt(
        new Date("2026-07-05T11:00:00.000Z"),
        1,
        "Asia/Singapore",
        new Date("2026-07-05T11:01:00.000Z")
      ).toISOString()
    ).toBe("2026-07-06T11:00:00.000Z");
  });

  it("splits explicit reminder commands", () => {
    expect(splitReminderText("tomorrow at 9am | submit the form")).toEqual({
      whenText: "tomorrow at 9am",
      taskText: "submit the form"
    });
  });

  it("splits remind-me natural language with inline timing", () => {
    expect(splitReminderText("me to go out in 15 mins")).toEqual({
      whenText: "go out in 15 mins",
      taskText: "go out in 15 mins"
    });
  });

  it("splits group reminder targets with inline timing", () => {
    expect(splitReminderText("us to submit our assignment at 10:16 am")).toEqual({
      whenText: "submit our assignment at 10:16 am",
      taskText: "submit our assignment at 10:16 am"
    });

    expect(splitReminderText("@henry_derek to submit his assignment at 10:19 am")).toEqual({
      whenText: "submit his assignment at 10:19 am",
      taskText: "@henry_derek submit his assignment at 10:19 am"
    });
  });

  it("splits remind-me about and set-reminder target language", () => {
    expect(splitReminderText("me about the meeting after 5 mins")).toEqual({
      whenText: "the meeting after 5 mins",
      taskText: "the meeting after 5 mins"
    });
    expect(splitReminderText("for school at 9 am")).toEqual({
      whenText: "school at 9 am",
      taskText: "school at 9 am"
    });
  });

  it("accepts compact reminder text with the task before the time", () => {
    expect(splitReminderText("do this at 4 pm")).toEqual({
      whenText: "do this at 4 pm",
      taskText: "do this at 4 pm"
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
