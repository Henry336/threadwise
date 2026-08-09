import { TaskImportItemStatus, TaskImportStatus, TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { TaskImportReview } from "../services/taskImports";
import { formatTaskImportPreviewHtml, taskImportPreviewKeyboard } from "./taskImports";

function reviewWithItems(count: number): TaskImportReview {
  const now = new Date("2026-08-04T00:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    workspaceId: "workspace-1",
    requestedByTelegramId: "123",
    requestedByName: "Henry",
    sourceText: "TODO",
    status: TaskImportStatus.PENDING,
    telegramMessageId: null,
    telegramThreadId: null,
    expiresAt: new Date("2026-08-05T00:00:00.000Z"),
    importedAt: null,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    workspace: { title: "Test", telegramChatId: "-100123" },
    items: Array.from({ length: count }, (_, index) => ({
      id: `item-${index + 1}`,
      importId: "11111111-1111-4111-8111-111111111111",
      position: index + 1,
      title: `Task ${index + 1}`,
      sourceText: `Task ${index + 1}`,
      dueAt: null,
      assignees: [],
      teamOwnerLabel: null,
      initialStatus: TaskStatus.OPEN,
      included: true,
      warnings: [],
      status: TaskImportItemStatus.READY,
      errorMessage: null,
      taskId: null,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

describe("Telegram task import progressive disclosure", () => {
  it("shows only the first three tasks plus a remainder count", () => {
    const preview = formatTaskImportPreviewHtml(reviewWithItems(8), "Asia/Singapore", 0);
    expect(preview).toContain("1. Task 1");
    expect(preview).toContain("3. Task 3");
    expect(preview).toContain("+5 more");
    expect(preview).not.toContain("4. Task 4");
  });

  it("offers one exact review link and two immediate decisions", () => {
    const keyboard = taskImportPreviewKeyboard(reviewWithItems(8), 0);
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toEqual(["Review & edit ↗", "Import", "Cancel"]);
    expect(JSON.stringify(keyboard.inline_keyboard)).toContain("import%3D11111111-1111-4111-8111-111111111111");
  });
});
