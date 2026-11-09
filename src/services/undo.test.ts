import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  auditLog: { findFirst: vi.fn(), update: vi.fn() },
}));
const groupWorkspaces = vi.hoisted(() => ({ isGroupManager: vi.fn() }));

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("./googleCalendar", () => ({ syncTaskCalendarBestEffort: vi.fn() }));
vi.mock("./groupWorkspaces", () => groupWorkspaces);

import { recordCreateUndo, undoLastActionForContext, withUndoActor } from "./undo";

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
