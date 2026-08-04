import { CodexJobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { CodexJobWithProject } from "../services/codex";
import {
  CODEX_REPORT_PAGE_CHARS,
  formatCodexTimestamp,
  isSoleOwnerMembership,
  paginateCodexReport,
  parseCodexCommand,
  renderCodexQueuedMessage,
  renderCodexStatus,
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
    expect(parseCodexCommand("doctor")).toEqual({ action: "doctor" });
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

  it("recognizes trusted publishing and auto-merge without changing the prompt", () => {
    const prompt = "Implement this, verify it, publish it, and auto-merge when CI passes.";
    expect(parseCodexCommand(prompt)).toEqual({
      action: "run",
      prompt,
      forceNewThread: false,
      publishRequested: true,
      publishAutoMerge: true
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

  it("parses explicit one-task access profiles", () => {
    expect(parseCodexCommand("--access browser+files -- inspect the live page and upload folder")).toMatchObject({
      action: "run",
      prompt: "inspect the live page and upload folder",
      requestedCapabilities: ["internet", "browser", "files"]
    });
    expect(parseCodexCommand("--access deploy -- release this safely")).toMatchObject({
      action: "run",
      requestedCapabilities: ["internet", "publish", "deploy"],
      publishRequested: true,
      publishAutoMerge: true
    });
    expect(parseCodexCommand("--access root -- inspect this")).toEqual({
      action: "error",
      message: "Unknown access profile: root. Use code, internet, publish, deploy, browser, files, or full."
    });
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

  it("shows the trusted publishing pipeline in the queue acknowledgement", () => {
    expect(renderCodexQueuedMessage({
      projectAlias: "threadwise",
      title: "Publish trusted worker",
      threadId: "new",
      requestId: "12345678",
      continuing: false,
      publishRequested: true,
      publishAutoMerge: true
    })).toContain("Publishing: verify -> commit -> agent/* -> PR -> CI -> auto-merge");
  });
});

describe("Codex mobile status", () => {
  it("formats worker and request times explicitly in Singapore time", () => {
    expect(formatCodexTimestamp(
      new Date("2026-07-29T17:30:23.746Z"),
      "Asia/Singapore"
    )).toBe("30 Jul 2026, 1:30 am SGT");
  });

  it("groups repeated requests by exact project and task", () => {
    const jobs = [
      {
        id: "db7822b2-aaaa-bbbb-cccc-dddddddddddd",
        status: CodexJobStatus.COMPLETED,
        prompt: "Continue the implementation",
        threadTitle: "Add Telegram Codex mode",
        threadId: "019fa9fc-aaaa-bbbb-cccc-dddddddddddd",
        model: null,
        reasoningEffort: null,
        createdAt: new Date("2026-07-29T17:20:00.000Z"),
        startedAt: new Date("2026-07-29T17:21:00.000Z"),
        completedAt: new Date("2026-07-29T17:22:00.000Z"),
        project: { alias: "threadwise" }
      },
      {
        id: "da01e473-aaaa-bbbb-cccc-dddddddddddd",
        status: CodexJobStatus.COMPLETED,
        prompt: "Earlier prompt",
        threadTitle: "Add Telegram Codex mode",
        threadId: "019fa9fc-aaaa-bbbb-cccc-dddddddddddd",
        model: null,
        reasoningEffort: null,
        createdAt: new Date("2026-07-29T17:10:00.000Z"),
        startedAt: new Date("2026-07-29T17:11:00.000Z"),
        completedAt: new Date("2026-07-29T17:12:00.000Z"),
        project: { alias: "threadwise" }
      }
    ] as CodexJobWithProject[];
    const worker = {
      online: true,
      lastSeenAt: new Date("2026-07-29T17:30:23.746Z"),
      geminiAvailable: false,
      fileCourierAvailable: false,
      fileRootCount: 0
    } as Parameters<typeof renderCodexStatus>[1];

    const rendered = renderCodexStatus(jobs, worker, "Asia/Singapore");
    expect(rendered).toContain("Heartbeat: 30 Jul 2026, 1:30 am SGT");
    expect(rendered).toContain("<code>threadwise</code> · Add Telegram Codex mode");
    expect(rendered).toContain("Task <code>019fa9fc</code> · 2 recent requests");
    expect(rendered).toContain("Requests: ✅ <code>db7822b2</code> · ✅ <code>da01e473</code>");
    expect(rendered.match(/Add Telegram Codex mode/g)).toHaveLength(1);
    expect(rendered).not.toContain("2026-07-29T17:30:23.746Z");
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
