import { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";

const UNDO_PREFIX = "undoable:";

type UndoTargetKind = "task" | "note" | "idea" | "reflection";

type UndoTarget = {
  kind: UndoTargetKind;
  id: string;
  publicId: string;
  title: string;
};

type UndoLogPayload = Prisma.InputJsonObject;

export async function recordCreateUndo(tx: Prisma.TransactionClient, userId: string, target: UndoTarget): Promise<void> {
  await recordUndo(tx, userId, "create", {
    type: "create",
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title
  });
}

export async function recordTaskStateUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  task: {
    id: string;
    publicId: string;
    title: string;
    status: TaskStatus;
    completedAt?: Date | null;
    nextReminderAt?: Date | null;
    snoozedUntil?: Date | null;
  },
  type: "complete-task" | "cancel-task"
): Promise<void> {
  await recordUndo(tx, userId, type, {
    type,
    targetKind: "task",
    targetId: task.id,
    publicId: task.publicId,
    title: task.title,
    status: task.status,
    completedAt: toIso(task.completedAt),
    nextReminderAt: toIso(task.nextReminderAt),
    snoozedUntil: toIso(task.snoozedUntil)
  });
}

export async function recordSnoozeUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  task: {
    id: string;
    publicId: string;
    title: string;
    nextReminderAt?: Date | null;
    snoozedUntil?: Date | null;
  }
): Promise<void> {
  await recordUndo(tx, userId, "snooze-task", {
    type: "snooze-task",
    targetKind: "task",
    targetId: task.id,
    publicId: task.publicId,
    title: task.title,
    nextReminderAt: toIso(task.nextReminderAt),
    snoozedUntil: toIso(task.snoozedUntil)
  });
}

export async function recordRenameUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  target: UndoTarget,
  previousTitle: string
): Promise<void> {
  await recordUndo(tx, userId, "rename", {
    type: "rename",
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title,
    previousTitle
  });
}

export async function recordPinUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  target: UndoTarget & { pinnedAt?: Date | null }
): Promise<void> {
  await recordUndo(tx, userId, "pin", {
    type: "pin",
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title,
    previousPinnedAt: toIso(target.pinnedAt)
  });
}

export async function recordNoteMergeUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  mergedNote: UndoTarget,
  sourceNotes: Array<{
    id: string;
    publicId: string;
    title: string;
    archivedAt?: Date | null;
    archivedReason?: string | null;
    mergedIntoNoteId?: string | null;
  }>
): Promise<void> {
  await recordUndo(tx, userId, "merge-notes", {
    type: "merge-notes",
    targetKind: "note",
    targetId: mergedNote.id,
    publicId: mergedNote.publicId,
    title: mergedNote.title,
    sourceNotes: sourceNotes.map((note) => ({
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      archivedAt: toIso(note.archivedAt),
      archivedReason: note.archivedReason ?? null,
      mergedIntoNoteId: note.mergedIntoNoteId ?? null
    }))
  });
}

export async function undoLastAction(userId: string): Promise<string> {
  const entry = await prisma.auditLog.findFirst({
    where: {
      userId,
      action: { startsWith: UNDO_PREFIX }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!entry) {
    return "Nothing to undo right now. I'll keep the next change reversible when I can.";
  }

  const payload = asRecord(entry.metadata);
  const type = stringValue(payload.type);

  if (!type) {
    await markUndoConsumed(entry.id, "unknown");
    return "I found an old undo entry, but it no longer has enough detail to restore safely.";
  }

  try {
    if (type === "create") {
      return await undoCreate(entry.id, payload);
    }

    if (type === "complete-task" || type === "cancel-task") {
      return await undoTaskState(entry.id, payload);
    }

    if (type === "snooze-task") {
      return await undoSnooze(entry.id, payload);
    }

    if (type === "rename") {
      return await undoRename(entry.id, payload);
    }

    if (type === "pin") {
      return await undoPin(entry.id, payload);
    }

    if (type === "merge-notes") {
      return await undoNoteMerge(entry.id, payload);
    }
  } catch {
    await markUndoConsumed(entry.id, type);
    return "I couldn't undo that cleanly, so I left your data as-is.";
  }

  await markUndoConsumed(entry.id, type);
  return "That undo type is no longer supported, so I left your data as-is.";
}

async function undoCreate(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  await prisma.$transaction(async (tx) => {
    const archivedAt = new Date();
    if (target.kind === "task") {
      await tx.task.updateMany({
        where: { id: target.id, archivedAt: null },
        data: {
          archivedAt,
          archivedReason: "undo",
          status: TaskStatus.CANCELED,
          nextReminderAt: null,
          snoozedUntil: null
        }
      });
    } else if (target.kind === "note") {
      await tx.note.updateMany({ where: { id: target.id, archivedAt: null }, data: { archivedAt, archivedReason: "undo" } });
    } else if (target.kind === "idea") {
      await tx.idea.updateMany({ where: { id: target.id, archivedAt: null }, data: { archivedAt, archivedReason: "undo" } });
    } else {
      await tx.reflection.updateMany({ where: { id: target.id, archivedAt: null }, data: { archivedAt, archivedReason: "undo" } });
    }

    await consumeUndo(tx, entryId, "create");
  });

  return `${bold("Undone")} Removed ${code(target.publicId)} from your active Threadwise.`;
}

async function undoTaskState(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const status = taskStatusValue(payload.status);
  if (target.kind !== "task" || !status) {
    throw new Error("Invalid task undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: target.id, archivedAt: null },
      data: {
        status,
        completedAt: dateValue(payload.completedAt),
        nextReminderAt: dateValue(payload.nextReminderAt),
        snoozedUntil: dateValue(payload.snoozedUntil)
      }
    });
    await consumeUndo(tx, entryId, stringValue(payload.type) ?? "task-state");
  });

  return `${bold("Undone")} Restored ${code(target.publicId)} ${h(target.title)}.`;
}

async function undoSnooze(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  if (target.kind !== "task") {
    throw new Error("Invalid snooze undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: target.id, archivedAt: null },
      data: {
        nextReminderAt: dateValue(payload.nextReminderAt),
        snoozedUntil: dateValue(payload.snoozedUntil)
      }
    });
    await consumeUndo(tx, entryId, "snooze-task");
  });

  return `${bold("Undone")} Restored the reminder timing for ${code(target.publicId)}.`;
}

async function undoRename(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const previousTitle = stringValue(payload.previousTitle);
  if (!previousTitle) {
    throw new Error("Invalid rename undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    if (target.kind === "task") {
      await tx.task.updateMany({ where: { id: target.id, archivedAt: null }, data: { title: previousTitle } });
    } else if (target.kind === "note") {
      await tx.note.updateMany({ where: { id: target.id, archivedAt: null }, data: { title: previousTitle } });
    } else if (target.kind === "idea") {
      await tx.idea.updateMany({ where: { id: target.id, archivedAt: null }, data: { title: previousTitle } });
    } else {
      throw new Error("Reflection titles are not editable.");
    }

    await consumeUndo(tx, entryId, "rename");
  });

  return `${bold("Undone")} Renamed ${code(target.publicId)} back to ${h(previousTitle)}.`;
}

async function undoPin(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const previousPinnedAt = dateValue(payload.previousPinnedAt);

  await prisma.$transaction(async (tx) => {
    if (target.kind === "task") {
      await tx.task.updateMany({ where: { id: target.id, archivedAt: null }, data: { pinnedAt: previousPinnedAt } });
    } else if (target.kind === "note") {
      await tx.note.updateMany({ where: { id: target.id, archivedAt: null }, data: { pinnedAt: previousPinnedAt } });
    } else if (target.kind === "idea") {
      await tx.idea.updateMany({ where: { id: target.id, archivedAt: null }, data: { pinnedAt: previousPinnedAt } });
    } else {
      await tx.reflection.updateMany({ where: { id: target.id, archivedAt: null }, data: { pinnedAt: previousPinnedAt } });
    }

    await consumeUndo(tx, entryId, "pin");
  });

  return previousPinnedAt
    ? `${bold("Undone")} Restored the pin on ${code(target.publicId)}.`
    : `${bold("Undone")} Unpinned ${code(target.publicId)}.`;
}

async function undoNoteMerge(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const sourceNotes = sourceNotesFromPayload(payload.sourceNotes);
  if (target.kind !== "note" || sourceNotes.length === 0) {
    throw new Error("Invalid merge undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.note.updateMany({
      where: { id: target.id, archivedAt: null },
      data: {
        archivedAt: new Date(),
        archivedReason: "undo"
      }
    });

    for (const source of sourceNotes) {
      await tx.note.updateMany({
        where: { id: source.id },
        data: {
          archivedAt: source.archivedAt,
          archivedReason: source.archivedReason,
          mergedIntoNoteId: source.mergedIntoNoteId
        }
      });
    }

    await consumeUndo(tx, entryId, "merge-notes");
  });

  return `${bold("Undone")} Restored ${sourceNotes.map((note) => code(note.publicId)).join(", ")} and archived ${code(target.publicId)}.`;
}

async function recordUndo(tx: Prisma.TransactionClient, userId: string, type: string, metadata: UndoLogPayload): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId,
      action: `${UNDO_PREFIX}${type}`,
      metadata
    }
  });
}

async function markUndoConsumed(entryId: string, type: string): Promise<void> {
  await prisma.auditLog.update({
    where: { id: entryId },
    data: { action: `undone:${type}` }
  });
}

async function consumeUndo(tx: Prisma.TransactionClient, entryId: string, type: string): Promise<void> {
  await tx.auditLog.update({
    where: { id: entryId },
    data: { action: `undone:${type}` }
  });
}

function targetFromPayload(payload: Record<string, unknown>): UndoTarget {
  const kind = targetKindValue(payload.targetKind);
  const id = stringValue(payload.targetId);
  const publicId = stringValue(payload.publicId);
  const title = stringValue(payload.title);

  if (!kind || !id || !publicId || !title) {
    throw new Error("Invalid undo target.");
  }

  return { kind, id, publicId, title };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function taskStatusValue(value: unknown): TaskStatus | undefined {
  if (value === TaskStatus.OPEN || value === TaskStatus.DONE || value === TaskStatus.CANCELED) {
    return value;
  }

  return undefined;
}

function targetKindValue(value: unknown): UndoTargetKind | undefined {
  if (value === "task" || value === "note" || value === "idea" || value === "reflection") {
    return value;
  }

  return undefined;
}

function sourceNotesFromPayload(value: unknown): Array<{
  id: string;
  publicId: string;
  archivedAt: Date | null;
  archivedReason: string | null;
  mergedIntoNoteId: string | null;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      id: stringValue(item.id),
      publicId: stringValue(item.publicId),
      archivedAt: dateValue(item.archivedAt),
      archivedReason: stringValue(item.archivedReason) ?? null,
      mergedIntoNoteId: stringValue(item.mergedIntoNoteId) ?? null
    }))
    .filter((item): item is {
      id: string;
      publicId: string;
      archivedAt: Date | null;
      archivedReason: string | null;
      mergedIntoNoteId: string | null;
    } => Boolean(item.id && item.publicId));
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}
