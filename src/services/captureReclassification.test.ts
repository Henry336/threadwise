import { TaskStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  createScheduledReminder: vi.fn(),
  createNote: vi.fn(),
  createIdea: vi.fn(),
}));

const db = vi.hoisted(() => {
  const client = {
    auditLog: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    task: { findFirst: vi.fn(), updateMany: vi.fn() },
    note: { findFirst: vi.fn(), updateMany: vi.fn() },
    idea: { findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((callback: (tx: typeof client) => unknown) => callback(client));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("./tasks", () => ({ createTask: mocks.createTask, createScheduledReminder: mocks.createScheduledReminder }));
vi.mock("./notes", () => ({ createNote: mocks.createNote }));
vi.mock("./ideas", () => ({ createIdea: mocks.createIdea }));

import { reclassifyRecentPersonalCapture } from "./captureReclassification";

const now = new Date("2026-09-03T08:00:00.000Z");
const originalEntry = {
  id: "audit-old",
  createdAt: new Date("2026-09-03T07:59:00.000Z"),
  metadata: { targetKind: "task", targetId: "task-old", publicId: "TASK-1", title: "Draft report" },
};
const replacementEntry = {
  id: "audit-new",
  createdAt: new Date("2026-09-03T08:00:00.000Z"),
  metadata: { targetKind: "note", targetId: "note-new", publicId: "NOTE-2", title: "Draft report" },
};

describe("recent personal capture reclassification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
    db.task.findFirst.mockResolvedValue({
      id: "task-old",
      userId: "user-1",
      publicId: "TASK-1",
      title: "Draft report",
      sourceText: "Draft the project report",
      status: TaskStatus.OPEN,
      completedAt: null,
      nextReminderAt: null,
      snoozedUntil: null,
    });
    db.task.updateMany.mockResolvedValue({ count: 1 });
    db.note.updateMany.mockResolvedValue({ count: 1 });
    db.auditLog.updateMany.mockResolvedValue({ count: 2 });
    db.auditLog.create.mockResolvedValue({});
    mocks.createNote.mockResolvedValue({ id: "note-new", publicId: "NOTE-2", title: "Draft report" });
  });

  it("replaces the latest active creation and records one reversible correction", async () => {
    db.auditLog.findMany
      .mockResolvedValueOnce([originalEntry])
      .mockResolvedValueOnce([replacementEntry, originalEntry]);

    const result = await reclassifyRecentPersonalCapture("user-1", "note", {} as never, undefined, now);

    expect(result).toEqual({
      previousPublicId: "TASK-1",
      replacementPublicId: "NOTE-2",
      replacementTitle: "Draft report",
      requestedKind: "note",
    });
    expect(mocks.createNote).toHaveBeenCalledWith("user-1", "Draft the project report", expect.anything());
    expect(db.task.updateMany).toHaveBeenCalledWith({
      where: { id: "task-old", userId: "user-1", archivedAt: null },
      data: expect.objectContaining({ archivedReason: "reclassified", status: TaskStatus.CANCELED }),
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "undoable:reclassify",
        metadata: expect.objectContaining({ type: "reclassify" }),
      }),
    });
  });

  it("does nothing when no active creation exists in the ten-minute window", async () => {
    db.auditLog.findMany.mockResolvedValue([]);

    await expect(reclassifyRecentPersonalCapture("user-1", "idea", {} as never, undefined, now))
      .resolves.toBeUndefined();
    expect(mocks.createIdea).not.toHaveBeenCalled();
  });

  it("does not replace an item with a reminder unless the time is future", async () => {
    db.auditLog.findMany.mockResolvedValue([originalEntry]);

    await expect(reclassifyRecentPersonalCapture("user-1", "reminder", {} as never, now, now))
      .resolves.toBeUndefined();
    expect(mocks.createScheduledReminder).not.toHaveBeenCalled();
  });
});
