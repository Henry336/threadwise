import { CodexJobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { CodexJobWithProject } from "../services/codex";
import {
  CODEX_REPORT_PAGE_CHARS,
  isSoleOwnerMembership,
  paginateCodexReport,
  parseCodexCommand,
  renderCodexQueuedMessage,
  renderReportPage,
  reportKeyboard
} from "./codex";

describe("private Codex command parsing", () => {
  it("parses project selection and discovery commands", () => {
    expect(parseCodexCommand("projects")).toEqual({ action: "projects" });
    expect(parseCodexCommand("tasks threadwise")).toEqual({ action: "tasks", alias: "threadwise" });
    expect(parseCodexCommand("tasks")).toEqual({ action: "tasks", alias: undefined });
    expect(parseCodexCommand("use Threadwise")).toEqual({ action: "use", alias: "Threadwise" });
    expect(parseCodexCommand('use task "Add Telegram Codex mode"')).toEqual({
      action: "useTask",
      reference: "Add Telegram Codex mode"
    });
    expect(parseCodexCommand("status")).toEqual({ action: "status" });
  });

  it("routes a prompt to an explicit project", () => {
    expect(parseCodexCommand("in subscription-radar fix the renewal calculation")).toEqual({
      action: "run",
      alias: "subscription-radar",
      prompt: "fix the renewal calculation",
      forceNewThread: false
    });
  });

  it("supports fresh threads with or without an explicit project", () => {
    expect(parseCodexCommand("new investigate the failing tests")).toEqual({
      action: "run",
      prompt: "investigate the failing tests",
      forceNewThread: true
    });
    expect(parseCodexCommand("new in threadwise redesign the command router")).toEqual({
      action: "run",
      alias: "threadwise",
      prompt: "redesign the command router",
      forceNewThread: true
    });
  });

  it("treats all other text as a prompt", () => {
    expect(parseCodexCommand("please review the current diff")).toEqual({
      action: "run",
      prompt: "please review the current diff",
      forceNewThread: false
    });
  });

  it("targets an existing task by its report id", () => {
    expect(parseCodexCommand("continue a1b2c3d4 add regression tests")).toMatchObject({
      action: "run",
      taskRef: "a1b2c3d4",
      prompt: "add regression tests",
      forceNewThread: false
    });
  });

  it("targets an existing desktop task by project and title", () => {
    expect(parseCodexCommand(
      'in threadwise task "Add Telegram Codex mode": finish the task picker'
    )).toMatchObject({
      action: "run",
      alias: "threadwise",
      threadRef: "Add Telegram Codex mode",
      prompt: "finish the task picker",
      forceNewThread: false
    });
  });

  it("targets a task in the active project by short thread id", () => {
    expect(parseCodexCommand("task 019fa9fc: run all tests")).toMatchObject({
      action: "run",
      threadRef: "019fa9fc",
      prompt: "run all tests",
      forceNewThread: false
    });
  });

  it("parses per-task model and reasoning controls in a phone-friendly order", () => {
    expect(parseCodexCommand(
      "new --model gpt-5.6-sol --reasoning HIGH -- in threadwise fix CI"
    )).toMatchObject({
      action: "run",
      alias: "threadwise",
      prompt: "fix CI",
      forceNewThread: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high"
    });
  });

  it("rejects unsupported reasoning levels", () => {
    expect(parseCodexCommand("--reasoning enormous -- review this")).toEqual({
      action: "error",
      message: "Reasoning must be one of: minimal, low, medium, high, xhigh."
    });
  });

  it("rejects incomplete project and continuation commands", () => {
    expect(parseCodexCommand("in threadwise")).toEqual({
      action: "error",
      message: "Add a prompt for Codex to work on."
    });
    expect(parseCodexCommand("continue a1b2c3d4")).toEqual({
      action: "error",
      message: "Add a prompt for Codex to work on."
    });
  });
});

describe("Codex Telegram report pagination", () => {
  it("keeps every page below the reserved report-body limit without losing text", () => {
    const report = `Start\n${"🧭abcdef".repeat(2_000)}\nEnd`;
    const pages = paginateCodexReport(report);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => Array.from(page).length <= CODEX_REPORT_PAGE_CHARS)).toBe(true);
    expect(pages.join("")).toBe(report);
  });

  it("provides previous and next callbacks for an interior page", () => {
    const keyboard = reportKeyboard("019faa1e-8e4c-71f2-b417-9485acdd2637", 1, 3);
    expect(keyboard?.inline_keyboard.flat().map((button) => "callback_data" in button ? button.callback_data : undefined)).toEqual([
      "codex:report:019faa1e-8e4c-71f2-b417-9485acdd2637:0",
      "codex:report:019faa1e-8e4c-71f2-b417-9485acdd2637:2"
    ]);
  });

  it("keeps the completed answer above optional technical details", () => {
    const job = {
      id: "64475759-aaaa-bbbb-cccc-dddddddddddd",
      status: CodexJobStatus.COMPLETED,
      prompt: "How fast do you respond?",
      threadTitle: "How fast do you respond?",
      threadId: "019facfb-aaaa-bbbb-cccc-dddddddddddd",
      model: null,
      reasoningEffort: null,
      project: {
        alias: "bell-app",
        path: "C:\\Users\\Henry\\OneDrive\\Documents\\Bell App"
      }
    } as CodexJobWithProject;

    expect(renderReportPage(job, ["Usually within a few seconds."], 0)).toBe([
      "✅ Codex finished",
      "How fast do you respond?",
      "bell-app · task 019facfb · request 64475759",
      "",
      "Usually within a few seconds."
    ].join("\n"));
  });

  it("keeps queue acknowledgements short and hides inherited defaults", () => {
    expect(renderCodexQueuedMessage({
      projectAlias: "bell-app",
      title: "How fast do you respond?",
      threadId: "new",
      requestId: "64475759",
      continuing: false
    })).toBe([
      "<b>⏳ Codex is working</b>",
      "How fast do you respond?",
      "<code>bell-app</code> · new task · request <code>64475759</code>"
    ].join("\n"));
  });
});

describe("Codex group privacy guard", () => {
  it("requires the exact owner to be active and no third group member", () => {
    expect(isSoleOwnerMembership(2, "member")).toBe(true);
    expect(isSoleOwnerMembership(3, "member")).toBe(false);
    expect(isSoleOwnerMembership(1, "member")).toBe(false);
    expect(isSoleOwnerMembership(2, "left")).toBe(false);
    expect(isSoleOwnerMembership(2, "kicked")).toBe(false);
    expect(isSoleOwnerMembership(2, "restricted", false)).toBe(false);
    expect(isSoleOwnerMembership(2, "restricted", true)).toBe(true);
  });
});
