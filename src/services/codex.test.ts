import { describe, expect, it } from "vitest";
import {
  isPrivateCodexActor,
  isPrivateCodexReportActor,
  projectAlias,
  splitTelegramReport,
  taskTitleFromPrompt
} from "./codex";

describe("private Codex access", () => {
  const expected = {
    ownerTelegramId: "123456789",
    telegramChatId: "-987654321"
  };

  it("requires both the exact user and exact chat", () => {
    expect(isPrivateCodexActor({
      telegramUserId: "123456789",
      telegramChatId: "-987654321"
    }, expected)).toBe(true);
    expect(isPrivateCodexActor({
      telegramUserId: "999",
      telegramChatId: "-987654321"
    }, expected)).toBe(false);
    expect(isPrivateCodexActor({
      telegramUserId: "123456789",
      telegramChatId: "-999"
    }, expected)).toBe(false);
  });

  it("allows report controls only for the owner in the group or the owner's fallback DM", () => {
    expect(isPrivateCodexReportActor({
      telegramUserId: "123456789",
      telegramChatId: "-987654321",
      chatType: "group"
    }, expected)).toBe(true);
    expect(isPrivateCodexReportActor({
      telegramUserId: "123456789",
      telegramChatId: "123456789",
      chatType: "private"
    }, expected)).toBe(true);
    expect(isPrivateCodexReportActor({
      telegramUserId: "999",
      telegramChatId: "-987654321",
      chatType: "group"
    }, expected)).toBe(false);
    expect(isPrivateCodexReportActor({
      telegramUserId: "123456789",
      telegramChatId: "999",
      chatType: "private"
    }, expected)).toBe(false);
  });
});

describe("Codex project aliases", () => {
  it("creates Telegram-friendly aliases from Windows paths", () => {
    expect(projectAlias("C:\\Users\\Henry\\Documents\\Codex\\Threadwise")).toBe("threadwise");
    expect(projectAlias("C:\\Users\\Henry\\OneDrive\\Desktop\\May Vacation Plans")).toBe("may-vacation-plans");
  });
});

describe("Codex report chunking", () => {
  it("preserves the exact report when chunks are reassembled", () => {
    const report = `Header\n${"🧭abc".repeat(2_000)}\nFooter`;
    const chunks = splitTelegramReport(report, 250);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 250)).toBe(true);
    expect(chunks.join("")).toBe(report);
  });
});

describe("Codex task titles", () => {
  it("creates a stable concise title for a task started from Telegram", () => {
    expect(taskTitleFromPrompt("Fix the task router\nThen deploy it")).toBe("Fix the task router");
    expect(Array.from(taskTitleFromPrompt("x".repeat(200))).length).toBe(80);
  });
});
