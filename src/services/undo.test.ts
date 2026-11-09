import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  auditLog: { findFirst: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
const groupWorkspaces = vi.hoisted(() => ({ isGroupManager: vi.fn() }));

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("./googleCalendar", () => ({ syncTaskCalendarBestEffort: vi.fn() }));
vi.mock("./groupWorkspaces", () => groupWorkspaces);

import { Prisma } from "@prisma/client";
import { recordCreateUndo, undoLastAction, undoLastActionForContext, updateItemByKind, withUndoActor } from "./undo";

function groupContext(fromId = 42): Context {
  return { chat: { id: -100, type: "supergroup" }, from: { id: fromId } } as unknown as Context;
}

describe("group undo ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.auditLog.findFirst.mockResolvedValue(null);
  });

  it("stamps the Telegram user handling the update on the undo entries it records", async () => {
    const create = vi.fn(async (_args: { data: { metadata: object } }) => ({}));
    const tx = { auditLog: { create } } as never;

    await withUndoActor("42", () => recordCreateUndo(tx, "chat:-100", { kind: "task", id: "t1", publicId: "TASK-1", title: "Book room" }));
    await recordCreateUndo(tx, "user-1", { kind: "task", id: "t2", publicId: "TASK-2", title: "No actor" });

    expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { metadata: { actorTelegramId: "42", targetId: "t1" } } });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ data: { metadata: { targetId: "t2" } } });
    expect(create.mock.calls[1]?.[0].data.metadata).not.toHaveProperty("actorTelegramId");
  });

  it("lets a group member undo only their own changes, so older entries without an actor stay put", async () => {
    groupWorkspaces.isGroupManager.mockResolvedValue(false);

    const message = await undoLastActionForContext(groupContext(42), "chat:-100");

    expect(db.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "chat:-100", metadata: { path: ["actorTelegramId"], equals: "42" } }),
    }));
    expect(message).toContain("Nothing of yours to undo");
    expect(db.auditLog.update).not.toHaveBeenCalled();
  });

  it("refuses a member's undo when another member changed the same item afterwards", async () => {
    groupWorkspaces.isGroupManager.mockResolvedValue(false);
    db.auditLog.findFirst
      .mockResolvedValueOnce({ id: "mine", createdAt: new Date("2026-11-01T00:00:00Z"), metadata: { type: "rename", targetKind: "task", targetId: "t1", publicId: "TASK-1", title: "Plan", previousTitle: "Draft", actorTelegramId: "42" } });
    // One newer entry for the item, none of them the member's own (a dashboard edit has no actor).
    db.auditLog.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const message = await undoLastActionForContext(groupContext(42), "chat:-100");

    expect(message).toContain("Someone changed that item after you");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not block a member whose only newer change to the item is their own", async () => {
    groupWorkspaces.isGroupManager.mockResolvedValue(false);
    db.auditLog.findFirst.mockResolvedValueOnce({ id: "mine", createdAt: new Date("2026-11-01T00:00:00Z"), metadata: { type: "rename", targetKind: "task", targetId: "t1", publicId: "TASK-1", title: "Plan", previousTitle: "Draft", actorTelegramId: "42" } });
    db.auditLog.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    db.$transaction.mockResolvedValueOnce(undefined);

    const message = await undoLastActionForContext(groupContext(42), "chat:-100");

    expect(message).not.toContain("Someone changed that item after you");
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("lets a group admin undo anyone's latest change", async () => {
    groupWorkspaces.isGroupManager.mockResolvedValue(true);

    await undoLastActionForContext(groupContext(7), "chat:-100");

    const where = (db.auditLog.findFirst.mock.calls[0]?.[0] as { where: object }).where;
    expect(where).not.toHaveProperty("metadata");
  });

  it("keeps private-chat undo unfiltered", async () => {
    const privateChat = { chat: { id: 42, type: "private" }, from: { id: 42 } } as unknown as Context;

    await undoLastActionForContext(privateChat, "user-1");

    const where = (db.auditLog.findFirst.mock.calls[0]?.[0] as { where: object }).where;
    expect(where).not.toHaveProperty("metadata");
    expect(groupWorkspaces.isGroupManager).not.toHaveBeenCalled();
  });
});

describe("undo failures", () => {
  const renameEntry = {
    id: "entry-1",
    metadata: { type: "rename", targetKind: "task", targetId: "t1", publicId: "TASK-1", title: "New", previousTitle: "Old" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.auditLog.findFirst.mockResolvedValue(renameEntry);
  });

  it("keeps the entry after a transient database error so the next /undo retries it", async () => {
    db.$transaction.mockRejectedValue(new Error("Connection terminated unexpectedly"));

    const message = await undoLastAction("user-1");

    expect(message).toContain("Try /undo again");
    expect(db.auditLog.update).not.toHaveBeenCalled();
  });

  it("reports success when the undo committed before the error, instead of inviting a second /undo", async () => {
    db.$transaction.mockRejectedValue(new Error("Connection terminated unexpectedly"));
    db.auditLog.findUnique.mockResolvedValue({ action: "undone:rename" });

    const message = await undoLastAction("user-1");

    expect(message).toContain("Undone");
    expect(message).not.toContain("Try /undo again");
  });

  it("retires the entry when its target row is gone, since a retry cannot succeed", async () => {
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "test" }));

    const message = await undoLastAction("user-1");

    expect(message).toContain("couldn’t undo that cleanly");
    expect(db.auditLog.update).toHaveBeenCalledWith({ where: { id: "entry-1" }, data: { action: "undone:rename" } });
  });
});

describe("updateItemByKind", () => {
  it("routes each kind to its table and adds task-only columns only for tasks", async () => {
    const tables = { task: { updateMany: vi.fn() }, note: { updateMany: vi.fn() }, idea: { updateMany: vi.fn() } };
    const args = { where: { id: "x", archivedAt: null }, data: { archivedReason: "undo" }, taskData: { nextReminderAt: null } };
    for (const kind of ["task", "note", "idea"] as const) await updateItemByKind(tables as never, kind, args);

    expect(tables.task.updateMany).toHaveBeenCalledWith({ where: args.where, data: { archivedReason: "undo", nextReminderAt: null } });
    expect(tables.note.updateMany).toHaveBeenCalledWith({ where: args.where, data: { archivedReason: "undo" } });
    expect(tables.idea.updateMany).toHaveBeenCalledWith({ where: args.where, data: { archivedReason: "undo" } });
  });
});
