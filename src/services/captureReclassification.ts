import { Prisma, TaskStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { prisma } from "../db/prisma";
import type { CaptureCorrectionKind } from "../bot/captureCorrections";
import { createIdea } from "./ideas";
import { createNote } from "./notes";
import { createScheduledReminder, createTask } from "./tasks";

const RECENT_CAPTURE_WINDOW_MS = 10 * 60_000;

type ReclassifiableKind = "task" | "note" | "idea";

type ReclassifiableTarget = {
  kind: ReclassifiableKind;
  id: string;
  publicId: string;
  title: string;
  sourceText: string;
  taskState?: {
    status: TaskStatus;
    completedAt: Date | null;
    nextReminderAt: Date | null;
    snoozedUntil: Date | null;
  };
};

export type CaptureReclassificationResult = {
  previousPublicId: string;
  replacementPublicId: string;
  replacementTitle: string;
  requestedKind: CaptureCorrectionKind;
};

export async function recentPersonalCaptureCreatedAt(userId: string, now = new Date()): Promise<Date | undefined> {
  return (await latestCreateTarget(userId, now))?.createdAt;
}

/**
 * Reclassifies only the user's most recent reversible creation. Callers must
 * enforce private-chat scope: shared workspaces need an actor-bound target,
 * which older create audit rows do not contain.
 */
export async function reclassifyRecentPersonalCapture(
  userId: string,
  requestedKind: CaptureCorrectionKind,
  ai: AiProvider,
  reminderAt?: Date,
  now = new Date(),
): Promise<CaptureReclassificationResult | undefined> {
  const candidateEntry = await latestCreateTarget(userId, now);
  if (!candidateEntry) return undefined;
  const candidate = candidateEntry.target;
  if (requestedKind === "reminder" && (!reminderAt || reminderAt <= now)) return undefined;

  const replacement = requestedKind === "task"
    ? await createTask(userId, candidate.sourceText, ai)
    : requestedKind === "reminder"
      ? await createScheduledReminder(userId, candidate.sourceText, reminderAt!, ai)
      : requestedKind === "note"
        ? await createNote(userId, candidate.sourceText, ai)
        : await createIdea(userId, candidate.sourceText, ai);
  const replacementKind: ReclassifiableKind = requestedKind === "reminder" ? "task" : requestedKind;

  try {
    await prisma.$transaction(async (tx) => {
      const archived = await archiveTarget(tx, userId, candidate);
      if (!archived) throw new Error("The original capture is no longer active.");

      const createEntries = await tx.auditLog.findMany({
        where: {
          userId,
          action: "undoable:create",
          createdAt: { gte: new Date(now.getTime() - RECENT_CAPTURE_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      });
      const originalEntry = createEntries.find((entry) => metadataTargetId(entry.metadata) === candidate.id);
      const replacementEntry = createEntries.find((entry) => metadataTargetId(entry.metadata) === replacement.id);
      if (!originalEntry || !replacementEntry) throw new Error("Reclassification audit entries are incomplete.");

      await tx.auditLog.updateMany({
        where: { id: { in: [originalEntry.id, replacementEntry.id] }, action: "undoable:create" },
        data: { action: "reclassified:create" },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "undoable:reclassify",
          metadata: {
            type: "reclassify",
            original: targetMetadata(candidate),
            replacement: {
              targetKind: replacementKind,
              targetId: replacement.id,
              publicId: replacement.publicId,
              title: replacement.title,
            },
          } satisfies Prisma.InputJsonObject,
        },
      });
    });
  } catch (error) {
    await archiveReplacementBestEffort(userId, replacementKind, replacement.id);
    throw error;
  }

  return {
    previousPublicId: candidate.publicId,
    replacementPublicId: replacement.publicId,
    replacementTitle: replacement.title,
    requestedKind,
  };
}

async function latestCreateTarget(
  userId: string,
  now: Date,
): Promise<{ target: ReclassifiableTarget; createdAt: Date } | undefined> {
  const entries = await prisma.auditLog.findMany({
    where: {
      userId,
      action: "undoable:create",
      createdAt: { gte: new Date(now.getTime() - RECENT_CAPTURE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  for (const entry of entries) {
    const metadata = asRecord(entry.metadata);
    const kind = reclassifiableKind(metadata.targetKind);
    const id = stringValue(metadata.targetId);
    if (!kind || !id) continue;
    const target = await loadActiveTarget(userId, kind, id);
    if (target) return { target, createdAt: entry.createdAt };
  }
  return undefined;
}

async function loadActiveTarget(userId: string, kind: ReclassifiableKind, id: string): Promise<ReclassifiableTarget | undefined> {
  if (kind === "task") {
    const task = await prisma.task.findFirst({ where: { id, userId, archivedAt: null } });
    return task ? {
      kind,
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      sourceText: task.sourceText,
      taskState: {
        status: task.status,
        completedAt: task.completedAt,
        nextReminderAt: task.nextReminderAt,
        snoozedUntil: task.snoozedUntil,
      },
    } : undefined;
  }
  if (kind === "note") {
    const note = await prisma.note.findFirst({ where: { id, userId, archivedAt: null } });
    return note ? { kind, id: note.id, publicId: note.publicId, title: note.title, sourceText: note.sourceText } : undefined;
  }
  const idea = await prisma.idea.findFirst({ where: { id, userId, archivedAt: null } });
  return idea ? { kind, id: idea.id, publicId: idea.publicId, title: idea.title, sourceText: idea.sourceText } : undefined;
}

async function archiveTarget(tx: Prisma.TransactionClient, userId: string, target: ReclassifiableTarget): Promise<boolean> {
  const archivedAt = new Date();
  if (target.kind === "task") {
    const result = await tx.task.updateMany({
      where: { id: target.id, userId, archivedAt: null },
      data: { archivedAt, archivedReason: "reclassified", status: TaskStatus.CANCELED, nextReminderAt: null, snoozedUntil: null },
    });
    return result.count === 1;
  }
  const result = target.kind === "note"
    ? await tx.note.updateMany({ where: { id: target.id, userId, archivedAt: null }, data: { archivedAt, archivedReason: "reclassified" } })
    : await tx.idea.updateMany({ where: { id: target.id, userId, archivedAt: null }, data: { archivedAt, archivedReason: "reclassified" } });
  return result.count === 1;
}

async function archiveReplacementBestEffort(userId: string, kind: ReclassifiableKind, id: string): Promise<void> {
  const data = { archivedAt: new Date(), archivedReason: "failed_reclassification" };
  try {
    if (kind === "task") {
      await prisma.task.updateMany({ where: { id, userId, archivedAt: null }, data: { ...data, status: TaskStatus.CANCELED, nextReminderAt: null } });
    } else if (kind === "note") {
      await prisma.note.updateMany({ where: { id, userId, archivedAt: null }, data });
    } else {
      await prisma.idea.updateMany({ where: { id, userId, archivedAt: null }, data });
    }
  } catch {
    // The original remains active because its transaction failed. A cleanup
    // failure is intentionally swallowed so the user's correction gets the
    // primary error instead of masking it.
  }
}

function targetMetadata(target: ReclassifiableTarget): Prisma.InputJsonObject {
  return {
    targetKind: target.kind,
    targetId: target.id,
    publicId: target.publicId,
    title: target.title,
    ...(target.taskState ? {
      status: target.taskState.status,
      completedAt: target.taskState.completedAt?.toISOString() ?? null,
      nextReminderAt: target.taskState.nextReminderAt?.toISOString() ?? null,
      snoozedUntil: target.taskState.snoozedUntil?.toISOString() ?? null,
    } : {}),
  };
}

function metadataTargetId(value: Prisma.JsonValue | null): string | undefined {
  return stringValue(asRecord(value).targetId);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function reclassifiableKind(value: unknown): ReclassifiableKind | undefined {
  return value === "task" || value === "note" || value === "idea" ? value : undefined;
}
