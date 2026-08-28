import { PlanningScope, TaskCaptureDraftItemStatus, TaskCaptureDraftStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { TaskCaptureDraftRecord } from "../services/taskCaptureDrafts";
import type { Context } from "grammy";
import { formatAgenda, formatCarryoverPrompt, formatDraftReview, formatSavedDraft, formatTodayCapturePrompt, isTodayCaptureReply, reviewKeyboard } from "./today";

const draft = {
  id: "00000000-0000-4000-8000-000000000001",
  ownerUserId: "user-1",
  principalTelegramId: "123",
  scope: PlanningScope.PERSONAL,
  timezone: "Asia/Singapore",
  status: TaskCaptureDraftStatus.REVIEWING,
  sourceText: "Prepare tutorial, Buy groceries",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  createdAt: new Date(0),
  updatedAt: new Date(0),
  canceledAt: null,
  committedAt: null,
  groupWorkspaceId: null,
  studyWorkspaceId: null,
  telegramChatId: "123",
  telegramReviewMessageId: 9,
  items: ["Prepare tutorial", "Buy groceries"].map((title, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 2}`,
    draftId: "00000000-0000-4000-8000-000000000001",
    position: index + 1,
    title,
    sourceText: title,
    plannedFor: new Date("2026-08-31T00:00:00.000Z"),
    dueAt: null,
    moduleId: null,
    studyItemType: null,
    assignees: [],
    teamOwnerLabel: null,
    linkedTaskId: null,
    linkedStudyItemId: null,
    included: true,
    status: TaskCaptureDraftItemStatus.READY,
    warnings: [],
    resultTaskId: null,
    resultStudyItemId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })),
} as TaskCaptureDraftRecord;

describe("Today Telegram acceptance dialogue", () => {
  it("keeps the normal review to the agreed three-action button budget", () => {
    const rows = reviewKeyboard(draft).inline_keyboard;
    expect(rows.flat().map((button) => button.text)).toEqual(["Save 2", "＋ Add more", "Edit details"]);
    expect(rows.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ callback_data: `td:save:${draft.id}` }),
      expect.objectContaining({ callback_data: `td:add:${draft.id}` }),
      expect.objectContaining({ callback_data: `td:edit:${draft.id}` }),
    ]));
    expect(formatDraftReview(draft, [])).toContain("Nothing is saved until you approve the list.");
  });

  it("reports that a saved plan created no reminder", () => {
    expect(formatSavedDraft(draft)).toContain("No reminders were created.");
  });

  it("shows Today, Carryover, and Deadline watch in one bounded card", () => {
    const agenda = {
      localDate: "2026-08-31",
      timezone: "Asia/Singapore",
      scope: PlanningScope.PERSONAL,
      today: [{ id: "1", publicId: "TASK-1", title: "Today", mode: "INDIVIDUAL" as const, status: "OPEN", plannedFor: "2026-08-31" }],
      carryover: [{ id: "2", publicId: "TASK-2", title: "Old", mode: "GROUP" as const, status: "OPEN", plannedFor: "2026-08-27", firstPlannedFor: "2026-08-27" }],
      dueSoon: [{ id: "3", publicId: "STUDY-3", title: "Quiz", mode: "STUDY" as const, status: "OPEN", dueAt: "2026-09-01T10:00:00.000Z" }],
      overdue: [],
      unscheduledCount: 0,
    };
    const card = formatAgenda(agenda);
    expect(card).toContain("Today's To-Do List");
    expect(card).toContain("Carryover");
    expect(card).toContain("Deadline watch");
    expect(card).toContain("＋ Add tasks");
    expect(card).toContain("/todo Buy groceries, prepare tutorial");
    expect(formatCarryoverPrompt(agenda.carryover[0]!, agenda)).toContain("Choose a fresh day");
  });

  it("makes the Add tasks force-reply prompt self-explanatory", () => {
    const prompt = formatTodayCapturePrompt();
    expect(prompt).toContain("Add tasks to Today");
    expect(prompt).toContain("commas or new lines");
    expect(prompt).toContain("review the list before anything is saved");
    expect(isTodayCaptureReply({ message: { reply_to_message: { text: "Add tasks to Today" } } } as Context)).toBe(true);
    expect(isTodayCaptureReply({ message: { reply_to_message: { text: "Something else" } } } as Context)).toBe(false);
  });
});
