import { describe, expect, it } from "vitest";
import { formatAssignee, formatAssigneeHtml, formatTaskCreated, parseTaskAssignees, prepareTaskInput } from "./tasks";

describe("task assignees", () => {
  it("parses several usernames and removes duplicates", () => {
    expect(parseTaskAssignees("@alex, @sam and @alex")).toEqual([
      { telegramId: undefined, username: "alex", displayName: "alex" },
      { telegramId: undefined, username: "sam", displayName: "sam" }
    ]);
  });

  it("keeps display-only names alongside Telegram mentions", () => {
    const result = parseTaskAssignees("Dad and @Soul_Positive_Light", [
      { offset: 8, length: 20, username: "Soul_Positive_Light", displayName: "Soul Positive Light" }
    ], true);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Dad" }),
      expect.objectContaining({ username: "Soul_Positive_Light" })
    ]));
  });

  it("formats all assignees for task cards and reminders", () => {
    expect(formatAssignee({ assignees: [
      { username: "alex", displayName: "Alex" },
      { telegramId: "2", displayName: "Dad" }
    ] })).toBe("@alex, Dad");
    expect(formatAssigneeHtml({ assignees: [
      { telegramId: "123", displayName: "Dad" },
      { username: "alex", displayName: "Alex" }
    ] })).toBe('<a href="tg://user?id=123">Dad</a>, @alex');
  });

  it("explains the one-time private nudge opt-in on assigned tasks", () => {
    const message = formatTaskCreated({
      publicId: "TASK-4",
      title: "Check the bot",
      assignees: [{ username: "alex", displayName: "Alex" }]
    });
    expect(message).toContain("Each assignee can open Threadwise privately");
    expect(message).toContain("/settings dm on");
  });

  it("removes a multi-person target prefix from the saved task title", () => {
    const prepared = prepareTaskInput("Dad and @Soul_Positive_Light to check the bot at 10 pm", {
      mentions: [{ offset: 8, length: 20, username: "Soul_Positive_Light", displayName: "Soul Positive Light" }]
    });
    expect(prepared.text).toBe("check the bot at 10 pm");
    expect(prepared.assignees).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Dad" }),
      expect.objectContaining({ username: "Soul_Positive_Light" })
    ]));
  });
});
