/**
 * The /undo system. Services call the record* helpers inside their own write transaction to add an
 * AuditLog row with action "undoable:<type>" and a JSON snapshot of what to restore. /undo (and undo
 * buttons) take the newest such row, reverse it, and rename it "undone:<type>" so it is used once.
 * Undo restores or archives items; it never hard-deletes, so public IDs are never reused.
 * Called from tasks/notes/ideas/pins/storedImages/noteMerges and other services, and from src/bot and src/dashboard.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, TaskStatus, type PrismaClient } from "@prisma/client";
import type { Context } from "grammy";
import { prisma } from "../db/prisma";
import { isGroupChat } from "../bot/groupRouting";
import { isGroupManager } from "./groupWorkspaces";
import { completeSearchableContentUpdate } from "../security/contentEncryption";
import { bold, code, h } from "../utils/html";
import { syncTaskCalendarBestEffort } from "./googleCalendar";
import { logger } from "../logger";

const UNDO_PREFIX = "undoable:";

type UndoTargetKind = "task" | "note" | "idea";

type UndoTarget = {
  kind: UndoTargetKind;
  id: string;
  publicId: string;
  title: string;
};

type UndoLogPayload = Prisma.InputJsonObject;

/**
 * Updates one task, note or idea by kind, using the columns the three tables share
 * (archive state, pin). `taskData` adds task-only columns such as status and reminder
 * times when the kind is "task". It replaces the per-kind if-chains in undo and
 * capture reclassification, so the three tables cannot be handled differently by mistake.
 */
export function updateItemByKind(
  db: Prisma.TransactionClient | PrismaClient,
  kind: UndoTargetKind,
  args: {
    where: { id: string; userId?: string; archivedAt?: null; archivedReason?: string };
    data: { archivedAt?: Date | null; archivedReason?: string | null; pinnedAt?: Date | null };
    taskData?: Prisma.TaskUpdateManyMutationInput;
  },
): Promise<Prisma.BatchPayload> {
  if (kind === "task") return db.task.updateMany({ where: args.where, data: { ...args.data, ...args.taskData } });
  if (kind === "note") return db.note.updateMany({ where: args.where, data: args.data });
  return db.idea.updateMany({ where: args.where, data: args.data });
}

// The Telegram user whose update is being handled. Group changes are all owned by the
// synthetic `chat:<id>` user, so this is the only record of which member made them.
const undoActor = new AsyncLocalStorage<string>();

/**
 * Runs `work` with `actorTelegramId` stamped on every undo entry it records, however deep in
 * the services that happens. The bot wraps each Telegram update in this so group undo can tell
 * members' changes apart without threading the actor through every service signature.
 */
export function withUndoActor<T>(actorTelegramId: string | undefined, work: () => T): T {
  return actorTelegramId ? undoActor.run(actorTelegramId, work) : work();
}

/** Records that an item was just created; undoing it archives the item (tasks are also canceled). */
export async function recordCreateUndo(tx: Prisma.TransactionClient, userId: string, target: UndoTarget): Promise<void> {
  await recordUndo(tx, userId, "create", {
    type: "create",
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title
  });
}

/** Snapshots a task's status and timing before it is completed, canceled, or restored. */
export async function recordTaskStateUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  task: {
    id: string;
    publicId: string;
    title: string;
    status: TaskStatus;
    dueAt?: Date | null;
    completedAt?: Date | null;
    nextReminderAt?: Date | null;
    snoozedUntil?: Date | null;
  },
  type: "complete-task" | "cancel-task" | "restore-task"
): Promise<void> {
  await recordUndo(tx, userId, type, {
    type,
    targetKind: "task",
    targetId: task.id,
    publicId: task.publicId,
    title: task.title,
    status: task.status,
    dueAt: toIso(task.dueAt),
    completedAt: toIso(task.completedAt),
    nextReminderAt: toIso(task.nextReminderAt),
    snoozedUntil: toIso(task.snoozedUntil)
  });
}

/** Snapshots a task's reminder timing before a snooze. */
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

/** Stores the previous title before a rename. */
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

/** Stores the previous task description, note body, or idea concept before an edit. */
export async function recordFieldEditUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  target: UndoTarget,
  field: "description" | "body" | "concept",
  previousValue: string | null
): Promise<void> {
  await recordUndo(tx, userId, "field-edit", {
    type: "field-edit",
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title,
    field,
    previousValue
  });
}

/** Stores a saved image's previous caption before it is changed. */
export async function recordImageCaptionUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  image: { id: string; publicId: string; caption?: string | null },
  previousCaption: string | null
): Promise<void> {
  await recordUndo(tx, userId, "image-caption", {
    type: "image-caption",
    targetId: image.id,
    publicId: image.publicId,
    previousCaption
  });
}

/** Snapshots a task's due date, timezone, calendar link, reminder timing, and recurrence before a reschedule. */
export async function recordRescheduleUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  task: {
    id: string;
    publicId: string;
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    calendarUrl?: string | null;
    nextReminderAt?: Date | null;
    snoozedUntil?: Date | null;
    recurrenceDayOfMonth?: number | null;
  }
): Promise<void> {
  await recordUndo(tx, userId, "reschedule-task", {
    type: "reschedule-task",
    targetKind: "task",
    targetId: task.id,
    publicId: task.publicId,
    title: task.title,
    dueAt: toIso(task.dueAt),
    timezone: task.timezone ?? null,
    calendarUrl: task.calendarUrl ?? null,
    nextReminderAt: toIso(task.nextReminderAt),
    snoozedUntil: toIso(task.snoozedUntil),
    recurrenceDayOfMonth: task.recurrenceDayOfMonth ?? null
  });
}

/** Stores the previous star time (or null) before a star or unstar. */
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

/** Stores the previous archive state before an item is archived. */
export async function recordArchiveUndo(
  tx: Prisma.TransactionClient,
  userId: string,
  target: UndoTarget & {
    archivedAt?: Date | null;
    archivedReason?: string | null;
  }
): Promise<void> {
  await recordUndo(tx, userId, "archive", {
    type: "archive",
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title,
    archivedAt: toIso(target.archivedAt),
    archivedReason: target.archivedReason ?? null
  });
}

/** Records a merge: the new note plus each source note's previous archive state and merge link. */
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

/**
 * Undoes the newest change the person behind `ctx` may reverse. In a group every change belongs
 * to the shared group owner, so a member may only undo their own changes; group admins may undo
 * anyone's. Private chats keep the plain "undo my last change" behaviour.
 */
export async function undoLastActionForContext(ctx: Context, userId: string): Promise<string> {
  if (!isGroupChat(ctx) || await isGroupManager(ctx)) return undoLastAction(userId);
  // No sender means nobody to match, so nothing is undoable (fail closed).
  return undoLastAction(userId, { actorTelegramId: ctx.from ? String(ctx.from.id) : "" });
}

/**
 * Reverses the newest undoable entry for `userId`. With `actorTelegramId`, only entries recorded
 * by that Telegram user are considered; older entries without an actor never match.
 * Each type's reversal and the "undone:" rename happen in one transaction. Transient errors keep the
 * entry for a retry; a malformed entry or a missing row retires it so it cannot block later undos.
 */
export async function undoLastAction(userId: string, options: { actorTelegramId?: string } = {}): Promise<string> {
  const onlyActor = options.actorTelegramId !== undefined;
  const entry = await prisma.auditLog.findFirst({
    where: {
      userId,
      action: { startsWith: UNDO_PREFIX },
      ...(onlyActor ? { metadata: { path: ["actorTelegramId"], equals: options.actorTelegramId } } : {})
    },
    orderBy: { createdAt: "desc" }
  });

  if (!entry) {
    return onlyActor
      ? "Nothing of yours to undo right now. A group admin can undo changes made by other members."
      : "Nothing to undo right now. When a change can be reversed, I’ll keep that option close by.";
  }

  const payload = asRecord(entry.metadata);
  const type = stringValue(payload.type);

  // Undoing an older change over someone else's newer change to the same item would silently wipe
  // theirs, so a member must leave that to an admin (who undoes in plain newest-first order).
  const targetId = stringValue(payload.targetId);
  if (onlyActor && targetId && await newerUndoByOthers(userId, entry.createdAt, targetId, options.actorTelegramId ?? "")) {
    return "Someone changed that item after you, so I left it as it is. A group admin can undo the newer change first.";
  }

  if (!type) {
    await markUndoConsumed(entry.id, "unknown");
    return "I found an older change, but there is not enough detail to restore it safely—so I left everything untouched.";
  }

  try {
    if (type === "create") {
      return await undoCreate(entry.id, payload);
    }

    if (type === "complete-task" || type === "cancel-task" || type === "restore-task") {
      return await undoTaskState(entry.id, payload);
    }

    if (type === "snooze-task") {
      return await undoSnooze(entry.id, payload);
    }

    if (type === "rename") {
      return await undoRename(entry.id, payload);
    }

    if (type === "field-edit") {
      return await undoFieldEdit(entry.id, payload);
    }

    if (type === "image-caption") {
      return await undoImageCaption(entry.id, payload);
    }

    if (type === "reschedule-task") {
      return await undoReschedule(entry.id, payload);
    }

    if (type === "pin") {
      return await undoPin(entry.id, payload);
    }

    if (type === "archive") {
      return await undoArchive(entry.id, payload);
    }

    if (type === "merge-notes") {
      return await undoNoteMerge(entry.id, payload);
    }

    if (type === "reclassify") {
      return await undoReclassify(entry.id, payload);
    }
  } catch (error) {
    if (!isPermanentUndoFailure(error)) {
      // The error may have come after the commit (e.g. the connection dropped on COMMIT), so
      // check before telling the user nothing changed; otherwise the next /undo reverses an older change.
      if (await undoWasConsumed(entry.id)) {
        logger.warn("Undo committed before an error; reporting success.", { entryId: entry.id, type, error: String(error) });
        return `${bold("Undone")} Your last change was reversed.`;
      }
      // A transient failure (for example the database dropping a connection) must not burn the
      // user's undo: the entry stays, so the next /undo tries the same change again.
      logger.error("Undo failed; keeping the entry for a retry.", { entryId: entry.id, type, error: String(error) });
      return "I couldn’t undo that just now, so I left your data exactly as it was. Try /undo again in a moment.";
    }
    logger.warn("Undo cannot be applied; retiring the entry.", { entryId: entry.id, type, error: String(error) });
    await markUndoConsumed(entry.id, type);
    return "I couldn’t undo that cleanly, so I left your data exactly as it was.";
  }

  await markUndoConsumed(entry.id, type);
  return "That undo type is no longer supported, so I left your data as-is.";
}

/**
 * Reverses a capture reclassification: archives the replacement and brings back the original,
 * including its saved task status and reminder times. Only an original still marked "reclassified" is restored.
 */
async function undoReclassify(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const original = targetFromPayload(asRecord(payload.original));
  const replacement = targetFromPayload(asRecord(payload.replacement));
  const originalState = asRecord(payload.original);

  await prisma.$transaction(async (tx) => {
    await updateItemByKind(tx, replacement.kind, {
      where: { id: replacement.id, archivedAt: null },
      data: { archivedAt: new Date(), archivedReason: "undo" },
      taskData: { status: TaskStatus.CANCELED, nextReminderAt: null, snoozedUntil: null },
    });
    await updateItemByKind(tx, original.kind, {
      where: { id: original.id, archivedReason: "reclassified" },
      data: { archivedAt: null, archivedReason: null },
      taskData: {
        status: taskStatusValue(originalState.status) ?? TaskStatus.OPEN,
        completedAt: nullableDateValue(originalState.completedAt),
        nextReminderAt: nullableDateValue(originalState.nextReminderAt),
        snoozedUntil: nullableDateValue(originalState.snoozedUntil),
      },
    });
    await consumeUndo(tx, entryId, "reclassify");
  });

  return `${bold("Undone")} Restored ${code(original.publicId)} and removed ${code(replacement.publicId)} from active Threadwise.`;
}

/** Undoes a create by archiving the item with reason "undo" (tasks are also canceled and stop reminding). */
async function undoCreate(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  await prisma.$transaction(async (tx) => {
    await updateItemByKind(tx, target.kind, {
      where: { id: target.id, archivedAt: null },
      data: { archivedAt: new Date(), archivedReason: "undo" },
      taskData: { status: TaskStatus.CANCELED, nextReminderAt: null, snoozedUntil: null },
    });

    await consumeUndo(tx, entryId, "create");
  });

  return `${bold("Undone")} Removed ${code(target.publicId)} from your active Threadwise.`;
}

async function undoTaskState(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const status = taskStatusValue(payload.status);
  if (target.kind !== "task" || !status) {
    throw new UndoPayloadError("Invalid task undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: target.id, archivedAt: null },
      data: {
        status,
        dueAt: dateValue(payload.dueAt),
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
    throw new UndoPayloadError("Invalid snooze undo payload.");
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

/**
 * Restores the previous title. Writes go through completeSearchableContentUpdate so encrypted
 * search tokens are rebuilt from the whole record. An item archived since then is left alone.
 */
async function undoRename(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const previousTitle = stringValue(payload.previousTitle);
  if (!previousTitle) {
    throw new UndoPayloadError("Invalid rename undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    if (target.kind === "task") {
      const current = await tx.task.findFirst({ where: { id: target.id, archivedAt: null } });
      if (current) await tx.task.update({ where: { id: current.id }, data: completeSearchableContentUpdate("Task", current, { title: previousTitle }) });
    } else if (target.kind === "note") {
      const current = await tx.note.findFirst({ where: { id: target.id, archivedAt: null } });
      if (current) await tx.note.update({ where: { id: current.id }, data: completeSearchableContentUpdate("Note", current, { title: previousTitle }) });
    } else {
      const current = await tx.idea.findFirst({ where: { id: target.id, archivedAt: null } });
      if (current) await tx.idea.update({ where: { id: current.id }, data: completeSearchableContentUpdate("Idea", current, { title: previousTitle }) });
    }

    await consumeUndo(tx, entryId, "rename");
  });

  return `${bold("Undone")} Renamed ${code(target.publicId)} back to ${h(previousTitle)}.`;
}

async function undoFieldEdit(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const field = stringValue(payload.field);
  const previousValue = nullableStringValue(payload.previousValue);

  await prisma.$transaction(async (tx) => {
    if (target.kind === "task" && field === "description") {
      const current = await tx.task.findFirst({ where: { id: target.id, archivedAt: null } });
      if (current) await tx.task.update({ where: { id: current.id }, data: completeSearchableContentUpdate("Task", current, { description: previousValue }) });
    } else if (target.kind === "note" && field === "body") {
      const current = await tx.note.findFirst({ where: { id: target.id, archivedAt: null } });
      if (current) await tx.note.update({
        where: { id: current.id },
        data: completeSearchableContentUpdate("Note", current, {
          body: previousValue ?? "",
          summary: summarizeManualText(previousValue ?? ""),
          sourceText: previousValue ?? ""
        })
      });
    } else if (target.kind === "idea" && field === "concept") {
      const current = await tx.idea.findFirst({ where: { id: target.id, archivedAt: null } });
      if (current) await tx.idea.update({ where: { id: current.id }, data: completeSearchableContentUpdate("Idea", current, { concept: previousValue ?? "", sourceText: previousValue ?? "" }) });
    } else {
      throw new UndoPayloadError("Invalid field edit undo payload.");
    }

    await consumeUndo(tx, entryId, "field-edit");
  });

  return `${bold("Undone")} Restored the previous ${h(field ?? "field")} for ${code(target.publicId)}.`;
}

async function undoImageCaption(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const id = stringValue(payload.targetId);
  const publicId = stringValue(payload.publicId);
  if (!id || !publicId) throw new UndoPayloadError("Invalid image caption undo payload.");
  const previousCaption = nullableStringValue(payload.previousCaption);
  await prisma.$transaction(async (tx) => {
    const current = await tx.storedImage.findUnique({ where: { id } });
    if (current) await tx.storedImage.update({ where: { id }, data: completeSearchableContentUpdate("StoredImage", current, { caption: previousCaption }) });
    await consumeUndo(tx, entryId, "image-caption");
  });
  return `${bold("↩️ Undone")} Restored the previous caption for ${code(publicId)}.`;
}

async function undoReschedule(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  if (target.kind !== "task") {
    throw new UndoPayloadError("Invalid reschedule undo payload.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: target.id, archivedAt: null },
      data: {
        dueAt: dateValue(payload.dueAt),
        timezone: nullableStringValue(payload.timezone),
        calendarUrl: nullableStringValue(payload.calendarUrl),
        nextReminderAt: dateValue(payload.nextReminderAt),
        snoozedUntil: dateValue(payload.snoozedUntil),
        recurrenceDayOfMonth: nullableIntegerValue(payload.recurrenceDayOfMonth)
      }
    });
    await consumeUndo(tx, entryId, "reschedule-task");
  });

  return `${bold("Undone")} Restored the previous schedule for ${code(target.publicId)}.`;
}

async function undoPin(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const previousPinnedAt = dateValue(payload.previousPinnedAt);

  await prisma.$transaction(async (tx) => {
    await updateItemByKind(tx, target.kind, { where: { id: target.id, archivedAt: null }, data: { pinnedAt: previousPinnedAt } });

    await consumeUndo(tx, entryId, "pin");
  });

  return previousPinnedAt
    ? `${bold("Undone")} Restored the pin on ${code(target.publicId)}.`
    : `${bold("Undone")} Unpinned ${code(target.publicId)}.`;
}

/** Puts back the previous archive state; a task that becomes active again is re-synced to Google Calendar. */
async function undoArchive(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const archivedAt = dateValue(payload.archivedAt);
  const archivedReason = nullableStringValue(payload.archivedReason);

  await prisma.$transaction(async (tx) => {
    await updateItemByKind(tx, target.kind, { where: { id: target.id }, data: { archivedAt, archivedReason } });

    await consumeUndo(tx, entryId, "archive");
  });

  if (target.kind === "task" && archivedAt === null) {
    // The undo is already committed; a failed calendar refresh must not be reported as a failed undo.
    try {
      const restored = await prisma.task.findUnique({ where: { id: target.id } });
      if (restored) await syncTaskCalendarBestEffort(restored.userId, restored);
    } catch (error) {
      logger.warn("Calendar sync after undo failed.", { taskId: target.id, error: String(error) });
    }
  }

  return `${bold("Undone")} Restored ${code(target.publicId)} to active ${activeLabel(target.kind)}.`;
}

/** Archives the merged note and restores each source note's previous archive state and merge link. */
async function undoNoteMerge(entryId: string, payload: Record<string, unknown>): Promise<string> {
  const target = targetFromPayload(payload);
  const sourceNotes = sourceNotesFromPayload(payload.sourceNotes);
  if (target.kind !== "note" || sourceNotes.length === 0) {
    throw new UndoPayloadError("Invalid merge undo payload.");
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

/** Writes the "undoable:<type>" audit row in the caller's transaction, adding the acting member when known. */
async function recordUndo(tx: Prisma.TransactionClient, userId: string, type: string, metadata: UndoLogPayload): Promise<void> {
  const actorTelegramId = undoActor.getStore();
  await tx.auditLog.create({
    data: {
      userId,
      action: `${UNDO_PREFIX}${type}`,
      metadata: actorTelegramId ? { ...metadata, actorTelegramId } : metadata
    }
  });
}

/** Thrown when a stored undo entry is malformed; retrying it can never succeed. */
class UndoPayloadError extends Error {}

/**
 * Whether an undo failure will repeat on every retry: the entry's payload is malformed, or the
 * row it targets is gone (Prisma P2025). Anything else is treated as transient and retried.
 */
function isPermanentUndoFailure(error: unknown): boolean {
  return error instanceof UndoPayloadError
    || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025");
}

/**
 * Whether anyone else recorded an undoable change to `targetId` after `since`. An entry with no
 * actor (a dashboard edit) counts as someone else; that is compared here rather than in SQL,
 * where a JSON NOT on a missing key is NULL and would silently skip it.
 */
async function newerUndoByOthers(userId: string, since: Date, targetId: string, actorTelegramId: string): Promise<boolean> {
  const newer = await prisma.auditLog.findMany({
    where: {
      userId,
      action: { startsWith: UNDO_PREFIX },
      createdAt: { gt: since },
      metadata: { path: ["targetId"], equals: targetId }
    },
    select: { metadata: true }
  });
  return newer.some((entry) => asRecord(entry.metadata).actorTelegramId !== actorTelegramId);
}

/** Whether the entry was already retired; false if it cannot be read either, so the caller keeps it for a retry. */
async function undoWasConsumed(entryId: string): Promise<boolean> {
  try {
    const current = await prisma.auditLog.findUnique({ where: { id: entryId }, select: { action: true } });
    return Boolean(current && !current.action.startsWith(UNDO_PREFIX));
  } catch {
    return false;
  }
}

/** Retires an entry outside a transaction (used when it cannot be applied). consumeUndo is the in-transaction twin. */
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

/** Reads the target item from a stored payload; a missing field is a permanent (non-retryable) error. */
function targetFromPayload(payload: Record<string, unknown>): UndoTarget {
  const kind = targetKindValue(payload.targetKind);
  const id = stringValue(payload.targetId);
  const publicId = stringValue(payload.publicId);
  const title = stringValue(payload.title);

  if (!kind || !id || !publicId || !title) {
    throw new UndoPayloadError("Invalid undo target.");
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

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableIntegerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableDateValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function summarizeManualText(value: string): string {
  return value.length <= 180 ? value : `${value.slice(0, 177).trim()}...`;
}

function taskStatusValue(value: unknown): TaskStatus | undefined {
  if (value === TaskStatus.OPEN || value === TaskStatus.DONE || value === TaskStatus.CANCELED) {
    return value;
  }

  return undefined;
}

function targetKindValue(value: unknown): UndoTargetKind | undefined {
  if (value === "task" || value === "note" || value === "idea") {
    return value;
  }

  return undefined;
}

function activeLabel(kind: UndoTargetKind): string {
  if (kind === "note") return "notes";
  if (kind === "idea") return "ideas";
  return "tasks";
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
