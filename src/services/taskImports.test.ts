import { TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildTaskImportWarnings,
  canControlTaskImport,
  importClaimExpired,
  MAX_TASK_IMPORT_ITEMS,
  parseTaskImportText,
  stripTaskImportHeader,
  taskImportBelongsToChat,
} from "./taskImports";

describe("task import parsing", () => {
  it("requires an explicit heading at the start", () => {
    expect(stripTaskImportHeader("TODO:\n- Send the deck")).toBe("- Send the deck");
    expect(stripTaskImportHeader("Action items: Book the room")).toBe("Book the room");
    expect(stripTaskImportHeader("We discussed TODO: Send the deck")).toBeUndefined();
  });

  it("parses wrapped bullets, usernames, teams, and completion status", () => {
    const result = parseTaskImportText([
      "TODO:",
      "- Send the orientation deck and include the updated schedule",
      "  before Friday (Maya & internal comms)",
      "- Confirm the venue (@sam)",
      "- Publish the announcement (sent already)",
    ].join("\n"), "Asia/Singapore", [], [
      { telegramId: "10", username: "maya", firstName: "Maya", lastName: "Tan" },
      { telegramId: "11", username: "sam", firstName: "Sam", lastName: "Lee" },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]?.assignees).toEqual([{ telegramId: "10", username: "maya", displayName: "Maya Tan" }]);
    expect(result[0]?.teamOwnerLabel).toBe("internal comms");
    expect(result[1]?.assignees[0]).toMatchObject({ telegramId: "11", username: "sam", displayName: "Sam Lee" });
    expect(result[2]?.initialStatus).toBe(TaskStatus.DONE);
    expect(result[2]?.title.toLowerCase()).toContain("publish the announcement");
  });

  it("marks unknown usernames and unassigned rows for review", () => {
    const result = parseTaskImportText("ACTION ITEMS:\n- Ask @new_member for the files\n- Book the room", "UTC");
    expect(result[0]?.warnings.join(" ")).toContain("@new_member");
    expect(result[1]?.warnings).toContain("Unassigned");
  });

  it("keeps ordinary parenthetical details in the task instead of treating them as an owner", () => {
    const [item] = parseTaskImportText("TODO:\n- Prepare launch deck (include metrics)", "UTC");
    expect(item?.sourceText).toContain("(include metrics)");
    expect(item?.teamOwnerLabel).toBeUndefined();
    expect(item?.warnings).toContain("Unassigned");
    const [designReview] = parseTaskImportText("TODO:\n- Prepare launch deck (design review)", "UTC");
    expect(designReview?.teamOwnerLabel).toBeUndefined();
    expect(designReview?.sourceText).toContain("(design review)");
  });

  it("does not guess when two active members share the same first name", () => {
    const [item] = parseTaskImportText("TODO:\n- Confirm the venue (Alex)", "UTC", [], [
      { telegramId: "10", username: "alex_one", firstName: "Alex", lastName: "Tan" },
      { telegramId: "11", username: "alex_two", firstName: "Alex", lastName: "Lee" },
    ]);
    expect(item?.assignees).toEqual([]);
    expect(item?.sourceText).toContain("(Alex)");
  });

  it("merges an explicit username and its Telegram entity into one assignee", () => {
    const mention = { telegramId: "10", username: "henry_derek", displayName: "Henry", offset: 20, length: 12 };
    const membership = { telegramId: "10", username: null, firstName: "Henry", lastName: null };
    const result = parseTaskImportText([
      "TODO:",
      "- Do nothing (@henry_derek)",
      "- Do something (@henry_derek",
    ].join("\n"), "Asia/Singapore", [mention], [membership]);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.assignees)).toEqual([
      [{ telegramId: "10", username: "henry_derek", displayName: "Henry" }],
      [{ telegramId: "10", username: "henry_derek", displayName: "Henry" }],
    ]);
  });

  it("accepts plain checklist rows and preserves their completion state", () => {
    const result = parseTaskImportText("TODO:\n[ ] Draft the update\n[x] Publish it\n☑ Share it", "UTC");
    expect(result.map((item) => item.initialStatus)).toEqual([TaskStatus.OPEN, TaskStatus.DONE, TaskStatus.DONE]);
    expect(result[0]?.title).not.toContain("[ ]");
  });

  it("accepts emoji checklist rows with presentation selectors", () => {
    const result = parseTaskImportText("TODO:\n☑️ Share the notes\n✅️ Confirm the venue", "UTC");
    expect(result.map((item) => item.initialStatus)).toEqual([TaskStatus.DONE, TaskStatus.DONE]);
    expect(result.map((item) => item.title)).toEqual(["Share the notes", "Confirm the venue"]);
  });

  it("recomputes warnings after a reviewer resolves ownership or completion", () => {
    expect(buildTaskImportWarnings([], null, TaskStatus.OPEN)).toEqual(["Unassigned"]);
    expect(buildTaskImportWarnings([{ telegramId: "10", username: "maya", displayName: "Maya" }], null, TaskStatus.OPEN)).toEqual([]);
    expect(buildTaskImportWarnings([], "Internal comms", TaskStatus.DONE)).toEqual(["Will be imported as completed"]);
  });

  it("caps a single import to a safe review size", () => {
    const rows = Array.from({ length: MAX_TASK_IMPORT_ITEMS + 5 }, (_, index) => `- Task ${index + 1}`);
    expect(parseTaskImportText(["TODO:", ...rows].join("\n"), "UTC")).toHaveLength(MAX_TASK_IMPORT_ITEMS);
  });

  it("only recovers abandoned import claims after the safety window", () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    expect(importClaimExpired(new Date("2026-08-03T11:51:00.000Z"), now)).toBe(false);
    expect(importClaimExpired(new Date("2026-08-03T11:50:00.000Z"), now)).toBe(true);
  });

  it("restricts import controls to the sender or a group manager", () => {
    expect(canControlTaskImport("sender", { telegramId: "sender", isManager: false })).toBe(true);
    expect(canControlTaskImport("sender", { telegramId: "admin", isManager: true })).toBe(true);
    expect(canControlTaskImport("sender", { telegramId: "member", isManager: false })).toBe(false);
  });

  it("binds Telegram import controls to the group that created the review", () => {
    expect(taskImportBelongsToChat("-100123", -100123)).toBe(true);
    expect(taskImportBelongsToChat("-100123", -100999)).toBe(false);
    expect(taskImportBelongsToChat("-100123", undefined)).toBe(false);
  });
});
