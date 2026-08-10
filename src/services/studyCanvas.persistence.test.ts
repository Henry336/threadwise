import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyItemStatus, type StudyWorkspace } from "@prisma/client";

const db = vi.hoisted(() => ({
  studyModule: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  studyCanvasAssignment: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  studyItem: { update: vi.fn() },
  $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));

vi.mock("../db/prisma", () => ({ prisma: db }));

import { mapCanvasCourse, persistCanvasAssignment } from "./studyCanvas";

const workspace = { id: "workspace-1" } as StudyWorkspace;
const now = new Date("2026-08-10T10:00:00.000Z");

beforeEach(() => vi.clearAllMocks());

describe("Canvas module visibility persistence", () => {
  it("updates source metadata without reactivating a module archived by the user", async () => {
    const archived = {
      id: "module-1",
      workspaceId: workspace.id,
      code: "CS2100",
      name: "Computer Organisation",
      active: false,
      userArchivedAt: new Date("2026-08-09T00:00:00.000Z"),
    };
    db.studyModule.findFirst.mockResolvedValue(archived);
    db.studyModule.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...archived, ...data }));

    const result = await mapCanvasCourse(workspace, { id: 93730, course_code: "CS2100", name: "Computer Organisation" }, now);

    expect(result.active).toBe(false);
    expect(result.userArchivedAt).toEqual(archived.userArchivedAt);
    expect(db.studyModule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ active: expect.anything() }),
    }));
  });

  it("keeps a newly discovered Canvas course inactive until the owner activates it", async () => {
    db.studyModule.findFirst.mockResolvedValue(null);
    db.studyModule.count.mockResolvedValue(4);
    db.studyModule.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "module-2", ...data }));

    const result = await mapCanvasCourse(workspace, { id: 59403, course_code: "THE1003A", name: "Wellbeing" }, now);

    expect(result.active).toBe(false);
    expect(db.studyModule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ active: false, displayOrder: 4 }),
    }));
  });

  it("refreshes archived assignment source metadata without reopening the local item", async () => {
    const module = { id: "module-1", active: true };
    const existing = {
      id: "canvas-assignment-1",
      itemId: "item-1",
      userArchivedAt: new Date("2026-08-09T00:00:00.000Z"),
      item: { id: "item-1", status: StudyItemStatus.SKIPPED, titleOverridden: false, dueAtOverridden: false },
    };
    db.studyCanvasAssignment.findUnique.mockResolvedValue(existing);

    await persistCanvasAssignment(
      workspace,
      module as never,
      { id: 93730, course_code: "CS2100" },
      { id: 264228, name: "Programming Quiz", workflow_state: "published" },
      now,
    );

    expect(db.studyItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ status: StudyItemStatus.OPEN }),
    }));
    expect(db.studyCanvasAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ userArchivedAt: expect.anything() }),
    }));
  });
});
