import { TaskStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client = {
    auditLog: { findFirst: vi.fn(), update: vi.fn() },
    task: { updateMany: vi.fn() },
    note: { updateMany: vi.fn() },
    idea: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((callback: (tx: typeof client) => unknown) => callback(client));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("./googleCalendar", () => ({ syncTaskCalendarBestEffort: vi.fn() }));

import { undoLastAction } from "./undo";

describe("reclassification undo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
    db.task.updateMany.mockResolvedValue({ count: 1 });
    db.note.updateMany.mockResolvedValue({ count: 1 });
    db.auditLog.update.mockResolvedValue({});
  });

  it("archives the replacement and restores the original task state", async () => {
    db.auditLog.findFirst.mockResolvedValue({
      id: "audit-reclassify",
      metadata: {
        type: "reclassify",
        original: {
          targetKind: "task",
          targetId: "task-old",
          publicId: "TASK-1",
          title: "Draft report",
          status: TaskStatus.OPEN,
          completedAt: null,
          nextReminderAt: "2026-09-04T08:00:00.000Z",
          snoozedUntil: null,
        },
        replacement: {
          targetKind: "note",
          targetId: "note-new",
          publicId: "NOTE-2",
          title: "Draft report",
        },
      },
    });

    const message = await undoLastAction("user-1");

    expect(message).toContain("TASK-1");
    expect(message).toContain("NOTE-2");
    expect(db.note.updateMany).toHaveBeenCalledWith({
      where: { id: "note-new", archivedAt: null },
      data: expect.objectContaining({ archivedReason: "undo" }),
    });
    expect(db.task.updateMany).toHaveBeenCalledWith({
      where: { id: "task-old", archivedReason: "reclassified" },
      data: expect.objectContaining({
        archivedAt: null,
        archivedReason: null,
        status: TaskStatus.OPEN,
        nextReminderAt: new Date("2026-09-04T08:00:00.000Z"),
      }),
    });
    expect(db.auditLog.update).toHaveBeenCalledWith({
      where: { id: "audit-reclassify" },
      data: { action: "undone:reclassify" },
    });
  });
});
