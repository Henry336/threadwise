import { describe, expect, it } from "vitest";
import { parseListRequest, parseNaturalHelpRequest, parseNaturalReminderBody, parseNaturalSettingChange, parseNaturalTimezoneChange } from "./naturalCommandParsing";

describe("natural command parsing", () => {
  it.each([
    ["show me the notes", "notes"],
    ["show me the tasks", "tasks"],
    ["list my ideas", "ideas"],
    ["open tasks", "tasks"]
  ])("parses list requests: %s", (input, expected) => {
    expect(parseListRequest(input)).toBe(expected);
  });

  it.each([
    ["help", "general"],
    ["how do i use this bot?", "general"],
    ["what can you do", "general"],
    ["how do i set reminders?", "reminders"],
    ["help me with reminders", "reminders"],
    ["help me set reminders", "reminders"],
    ["how can i snooze tasks?", "reminders"],
    ["how do i save notes?", "notes"],
    ["help me with notes", "notes"],
    ["how do i save ideas?", "ideas"],
    ["what can i do with search?", "search"],
    ["how do i change my settings?", "settings"],
    ["help me with quiet hours", "settings"],
    ["how do i view the command list?", "commands"],
    ["show command list", "commands"],
    ["slash commands", "commands"],
    ["how do i undo something?", "cleanup"]
  ])("parses natural help requests: %s", (input, expected) => {
    expect(parseNaturalHelpRequest(input)).toBe(expected);
  });

  it.each([
    ["change my timezone to myanmar", "myanmar"],
    ["change my timezone to yangon", "yangon"],
    ["change my timezone to malaysia", "malaysia"],
    ["change timezone to singapore", "singapore"],
    ["change timezone singapore", "singapore"],
    ["timezone is Yangon", "Yangon"]
  ])("parses timezone changes: %s", (input, expected) => {
    expect(parseNaturalTimezoneChange(input)).toBe(expected);
  });

  it.each([
    ["set reminder interval to 3 hours", ["interval", "180"]],
    ["remind me again every 3 hours", ["interval", "180"]],
    ["set due nudge to 3 mins", ["due-nudge", "3"]],
    ["warn me 10 mins before due tasks", ["due-nudge", "10"]],
    ["start warning me 30 minutes before reminders", ["due-nudge", "30"]],
    ["quiet hours off", ["quiet", "off"]],
    ["set quiet hours to 22:00-08:00", ["quiet", "22:00", "08:00"]],
    ["max reminders 5", ["max", "5"]],
    ["allow up to 200 reminders per day", ["max", "200"]]
  ])("parses natural settings: %s", (input, expected) => {
    expect(parseNaturalSettingChange(input)).toEqual(expected);
  });

  it.each([
    ["remind me to check the washer after 5 mins", "me to check the washer after 5 mins"],
    ["please remind me about the meeting in 2 hours", "me about the meeting in 2 hours"],
    ["remind us to submit our assignment at 10:16 am", "us to submit our assignment at 10:16 am"],
    ["remind @henry_derek to submit his assignment at 10:19 am", "@henry_derek to submit his assignment at 10:19 am"],
    ["set a reminder for school at 9 am", "for school at 9 am"],
    ["create reminder to leave in 20 min", "to leave in 20 min"]
  ])("parses reminder starter bodies: %s", (input, expected) => {
    expect(parseNaturalReminderBody(input)).toBe(expected);
  });
});
