import { describe, expect, it } from "vitest";
import { RecurrenceRule } from "@prisma/client";
import { carryRecurrenceToTaskText, formatDateTimeForUser, isWithinQuietHours, nextRecurringDueAt, parseDueDate, parseDurationMinutes, parseRecurrencePattern, splitReminderText, stripRecurrenceText } from "./dates";

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
    ["remind me in an hour", "2026-07-05T05:00:00.000Z"],
    ["nudge me after half an hour", "2026-07-05T04:30:00.000Z"],
    ["remind me in two days", "2026-07-07T04:00:00.000Z"]
  ])("parses word-based relative reminders: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it("parses the day after tomorrow", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate("call Alex day after tomorrow at 8am", "Asia/Singapore", now)?.toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });

  it.each([
    ["remind me at noon", "2026-07-06T04:00:00.000Z"],
    ["remind me at midnight tomorrow", "2026-07-05T16:00:00.000Z"]
  ])("parses named times: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
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

  it.each([
    ["remind me to go to the bank later at 1.30pm", "2026-07-05T05:30:00.000Z"],
    ["remind me to call Mum at 1.30 p.m.", "2026-07-05T05:30:00.000Z"],
    ["remind me at 1 30 pm", "2026-07-05T05:30:00.000Z"],
    ["remind me at 13h30", "2026-07-05T05:30:00.000Z"]
  ])("accepts common clock punctuation and spacing: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    ["remind me tomorrow morning", "2026-07-06T01:00:00.000Z"],
    ["remind me tomorrow afternoon", "2026-07-06T06:00:00.000Z"],
    ["remind me this evening", "2026-07-05T10:00:00.000Z"],
    ["remind me tonight", "2026-07-05T12:00:00.000Z"],
    ["remind me at lunchtime tomorrow", "2026-07-06T04:00:00.000Z"]
  ])("parses conversational parts of the day: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    ["remind me tomorrow at noon", "2026-07-06T04:00:00.000Z"],
    ["remind me tomorrow at midnight", "2026-07-05T16:00:00.000Z"],
    ["remind me tomorrow 13.30", "2026-07-06T05:30:00.000Z"]
  ])("keeps relative days attached to conversational clocks: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    ["remind me quarter past one pm", "2026-07-05T05:15:00.000Z"],
    ["remind me quarter to two pm", "2026-07-05T05:45:00.000Z"],
    ["remind me half past 1 pm", "2026-07-05T05:30:00.000Z"]
  ])("parses spoken clock expressions: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    ["remind me on 18/7 at 1.30pm", "2026-07-18T05:30:00.000Z"],
    ["remind me on 18/7/27 at 9am", "2027-07-18T01:00:00.000Z"],
    ["remind me by end of day", "2026-07-05T09:00:00.000Z"],
    ["remind me next month", "2026-08-01T01:00:00.000Z"]
  ])("parses broader calendar shorthand: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it("parses tomorrow with a time", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    const due = parseDueDate("submit report tomorrow at 9am", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-06T01:00:00.000Z");
  });

  it.each([
    "decide if I am coming to YIH by 1:30 pm today",
    "decide if I am coming to YIH at 1:30 pm today",
    "decide if I am coming to YIH 1:30 pm today"
  ])("parses today reminders when the time comes before today: %s", (text) => {
    const now = new Date("2026-07-08T03:54:00.000Z");
    const due = parseDueDate(text, "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-08T05:30:00.000Z");
  });

  it("parses tomorrow reminders when the time comes before tomorrow", () => {
    const now = new Date("2026-07-08T03:54:00.000Z");
    const due = parseDueDate("submit the form by 8 am tomorrow", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });

  it("parses clock-only reminders as the next future occurrence", () => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    const due = parseDueDate("at 6pm", "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-05T10:00:00.000Z");
  });

  it.each([
    ["Remind me to buy snacks in about 1 hour 15 mins", "2026-07-05T05:15:00.000Z"],
    ["nudge me in roughly 2 hours and 30 minutes", "2026-07-05T06:30:00.000Z"],
    ["alert me 90 minutes from now", "2026-07-05T05:30:00.000Z"],
    ["buy groceries in town in 2 hours", "2026-07-05T06:00:00.000Z"],
    ["remind me in half an hour from now", "2026-07-05T04:30:00.000Z"]
  ])("parses hedged and compound relative reminders: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    ["remind me to finish all tasks by 9 pm", "2026-07-05T13:00:00.000Z"],
    ["remind me to finish all tasks before 9pm", "2026-07-05T13:00:00.000Z"],
    ["please nudge me around 9:30 pm", "2026-07-05T13:30:00.000Z"],
    ["remind me no later than 21:45", "2026-07-05T13:45:00.000Z"],
    ["remind me to call Mum 9pm", "2026-07-05T13:00:00.000Z"]
  ])("parses deadline-style and conversational clocks: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    "declare check-out on UHMS before moving out from KE7 by 8 am 10 July",
    "declare check-out on UHMS before moving out from KE7 8 am 10 July",
    "declare check-out on UHMS before moving out from KE7 10 July at 8 am",
    "declare check-out on UHMS before moving out from KE7 10 July 8 am"
  ])("parses month-day reminders when the time is near the date: %s", (text) => {
    const now = new Date("2026-07-08T17:41:00.000Z");
    const due = parseDueDate(text, "Asia/Singapore", now);
    expect(due?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it.each([
    "remind me on July 10 at 8 am",
    "remind me on 10th July at 8 am"
  ])("parses month-first and ordinal dates: %s", (text) => {
    const now = new Date("2026-07-08T17:41:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
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
    ["remind me to sleep at 12 am nightly", RecurrenceRule.DAILY, 1],
    ["remind me to clean the fridge at 9am every week", RecurrenceRule.WEEKLY, 7],
    ["remind me to take out the trash every Friday at 7pm", RecurrenceRule.WEEKLY, 7],
    ["remind me to call Mum on Fridays at 8pm", RecurrenceRule.WEEKLY, 7],
    ["remind me to pay rent on the 1st of every month at 9am", RecurrenceRule.MONTHLY, 30],
    ["schedule a budget review once a month at 6pm", RecurrenceRule.MONTHLY, 30],
    ["remind me of Mum's birthday on 26 July every year", RecurrenceRule.YEARLY, 365],
    ["remind me of our anniversary annually on 3 March", RecurrenceRule.YEARLY, 365]
  ])("parses recurrence patterns: %s", (text, rule, intervalDays) => {
    expect(parseRecurrencePattern(text)).toEqual({ rule, intervalDays });
  });

  it("strips recurrence words before task title extraction", () => {
    expect(stripRecurrenceText("take my dog out for a walk every day at 5 pm")).toBe("take my dog out for a walk at 5 pm");
    expect(stripRecurrenceText("take out the trash every Friday at 7 pm")).toBe("take out the trash at 7 pm");
    expect(stripRecurrenceText("Mum's birthday on 26 July every year")).toBe("Mum's birthday on 26 July");
  });

  it("advances recurring due dates to the next future occurrence", () => {
    expect(
      nextRecurringDueAt(
        new Date("2026-07-05T11:00:00.000Z"),
        RecurrenceRule.DAILY,
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
    expect(splitReminderText("me of my mom's birthday on 26 July every year")).toEqual({
      whenText: "my mom's birthday on 26 July every year",
      taskText: "my mom's birthday on 26 July every year"
    });

    expect(splitReminderText("us of Mum's birthday on 26 July every year")).toEqual({
      whenText: "Mum's birthday on 26 July every year",
      taskText: "Mum's birthday on 26 July every year"
    });
  });

  it("parses and advances calendar-month reminders without losing the intended day", () => {
    const now = new Date("2026-07-12T04:00:00.000Z");
    expect(parseDueDate("pay rent on the 1st of every month at 9am", "Asia/Singapore", now)?.toISOString()).toBe("2026-08-01T01:00:00.000Z");
    expect(nextRecurringDueAt(new Date("2026-01-31T01:00:00.000Z"), RecurrenceRule.MONTHLY, "Asia/Singapore", new Date("2026-02-01T00:00:00.000Z"), 31).toISOString()).toBe("2026-02-28T01:00:00.000Z");
    expect(nextRecurringDueAt(new Date("2026-02-28T01:00:00.000Z"), RecurrenceRule.MONTHLY, "Asia/Singapore", new Date("2026-03-01T00:00:00.000Z"), 31).toISOString()).toBe("2026-03-31T01:00:00.000Z");
  });

  it("keeps several assignees while parsing the reminder time from the task", () => {
    expect(splitReminderText("Dad and @Soul_Positive_Light to check the bot at 10 pm")).toEqual({
      whenText: "check the bot at 10 pm",
      taskText: "Dad and @Soul_Positive_Light to check the bot at 10 pm"
    });
    expect(splitReminderText("@alex and @sam to submit the form tomorrow at 9")).toEqual({
      whenText: "submit the form tomorrow at 9",
      taskText: "@alex and @sam to submit the form tomorrow at 9"
    });
  });

  it("keeps a same-day weekday occurrence when its time is still ahead", () => {
    const now = new Date("2026-07-10T08:00:00.000Z"); // Friday, 4pm Singapore
    expect(parseDueDate("take out the trash every Friday at 7pm", "Asia/Singapore", now)?.toISOString())
      .toBe("2026-07-10T11:00:00.000Z");
  });

  it("carries recurrence from the schedule side of pipe commands", () => {
    expect(carryRecurrenceToTaskText("take out the trash", "every Friday at 7pm")).toBe("take out the trash every week");
    expect(carryRecurrenceToTaskText("Mum's birthday", "26 July every year")).toBe("Mum's birthday every year");
    expect(carryRecurrenceToTaskText("sleep every day", "at 12am daily")).toBe("sleep every day");
  });

  it("accepts compact reminder text with the task before the time", () => {
    expect(splitReminderText("do this at 4 pm")).toEqual({
      whenText: "do this at 4 pm",
      taskText: "do this at 4 pm"
    });
  });

  it.each([
    [RecurrenceRule.WEEKLY, "2026-07-12T11:00:00.000Z"],
    [RecurrenceRule.YEARLY, "2027-07-05T11:00:00.000Z"]
  ])("advances %s recurrence by calendar units", (rule, expected) => {
    expect(nextRecurringDueAt(
      new Date("2026-07-05T11:00:00.000Z"),
      rule,
      "Asia/Singapore",
      new Date("2026-07-05T11:01:00.000Z")
    ).toISOString()).toBe(expected);
  });

  it.each([
    ["remind me to sleep at 12 am daily", "2026-07-05T16:00:00.000Z"],
    ["remind me to take out the trash every Friday at 7 pm", "2026-07-10T11:00:00.000Z"],
    ["remind me of my mom's birthday on 26 July every year", "2026-07-26T01:00:00.000Z"]
  ])("parses the first occurrence for recurring natural language: %s", (text, expected) => {
    const now = new Date("2026-07-05T04:00:00.000Z");
    expect(parseDueDate(text, "Asia/Singapore", now)?.toISOString()).toBe(expected);
  });

  it.each([
    "me to finish all tasks by 9 pm",
    "me to send the report before 8:30am",
    "me to call Mum 9pm"
  ])("keeps deadline-style reminder text schedulable: %s", (text) => {
    expect(splitReminderText(text)).toEqual({ whenText: text.replace(/^me to /, ""), taskText: text.replace(/^me to /, "") });
  });

  it("accepts informal remind-me wording without requiring the word to", () => {
    expect(splitReminderText("me finish all tasks by 9pm")).toEqual({
      whenText: "finish all tasks by 9pm",
      taskText: "finish all tasks by 9pm"
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
