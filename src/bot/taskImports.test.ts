import { TaskImportItemStatus, TaskImportStatus, TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { TaskImportReview } from "../services/taskImports";
import { formatTaskImportPreviewHtml, taskImportPageCount, TASK_IMPORT_PAGE_SIZE } from "./taskImports";

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

describe("Telegram task import pagination", () => {
  it("shows no more than six tasks on each page", () => {
    const taskImport = reviewWithItems(8);

    expect(TASK_IMPORT_PAGE_SIZE).toBe(6);
    expect(taskImportPageCount(taskImport)).toBe(2);

    const firstPage = formatTaskImportPreviewHtml(taskImport, "Asia/Singapore", 0);
    expect(firstPage).toContain("Page 1/2");
    expect(firstPage).toContain("1. Task 1");
    expect(firstPage).toContain("6. Task 6");
    expect(firstPage).not.toContain("7. Task 7");
    expect(firstPage).not.toContain("+2 more");

    const secondPage = formatTaskImportPreviewHtml(taskImport, "Asia/Singapore", 1);
    expect(secondPage).toContain("Page 2/2");
    expect(secondPage).toContain("7. Task 7");
    expect(secondPage).toContain("8. Task 8");
    expect(secondPage).not.toContain("6. Task 6");
  });

  it("clamps stale page requests after rows are omitted", () => {
    const taskImport = reviewWithItems(8);
    taskImport.items[6]!.included = false;
    taskImport.items[7]!.status = TaskImportItemStatus.SKIPPED;

    expect(taskImportPageCount(taskImport)).toBe(1);
    const page = formatTaskImportPreviewHtml(taskImport, "Asia/Singapore", 99);
    expect(page).not.toContain("Page 2");
    expect(page).toContain("6. Task 6");
  });
});
