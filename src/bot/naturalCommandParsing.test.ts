import { describe, expect, it } from "vitest";
import { parseListRequest, parseNaturalReminderBody, parseNaturalSettingChange, parseNaturalTimezoneChange } from "./naturalCommandParsing";

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
    ["set due nudge to 3 mins", ["due-nudge", "3"]],
    ["quiet hours off", ["quiet", "off"]],
    ["set quiet hours to 22:00-08:00", ["quiet", "22:00", "08:00"]],
    ["max reminders 5", ["max", "5"]]
  ])("parses natural settings: %s", (input, expected) => {
    expect(parseNaturalSettingChange(input)).toEqual(expected);
  });

  it.each([
    ["remind me to check the washer after 5 mins", "me to check the washer after 5 mins"],
    ["please remind me about the meeting in 2 hours", "me about the meeting in 2 hours"],
    ["set a reminder for school at 9 am", "for school at 9 am"],
    ["create reminder to leave in 20 min", "to leave in 20 min"]
  ])("parses reminder starter bodies: %s", (input, expected) => {
    expect(parseNaturalReminderBody(input)).toBe(expected);
  });
});
