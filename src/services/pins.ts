import { TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { bold, code, h, italic } from "../utils/html";
import { findIdeaReference } from "./ideas";
import { findNoteReference } from "./notes";
import { findTaskReference } from "./tasks";
import { recordPinUndo } from "./undo";

type PinnableKind = "task" | "note" | "idea";

type PinnableItem = {
  kind: PinnableKind;
  id: string;
  publicId: string;
  title: string;
  summary: string;
  pinnedAt?: Date | null;
  createdAt: Date;
};

export async function pinItem(userId: string, reference: string, shouldPin: boolean): Promise<PinnableItem & { changed: boolean }> {
  const target = await findPinnableItem(userId, reference);
  if (shouldPin && target.pinnedAt) {
    return { ...target, changed: false };
  }

  if (!shouldPin && !target.pinnedAt) {
    return { ...target, changed: false };
  }

  const pinnedAt = shouldPin ? new Date() : null;
  await prisma.$transaction(async (tx) => {
    await recordPinUndo(tx, userId, target);
    if (target.kind === "task") {
      await tx.task.update({ where: { id: target.id }, data: { pinnedAt } });
    } else if (target.kind === "note") {
      await tx.note.update({ where: { id: target.id }, data: { pinnedAt } });
    } else {
      await tx.idea.update({ where: { id: target.id }, data: { pinnedAt } });
    }
  });

  return { ...target, pinnedAt, changed: true };
}

export async function listPinnedItems(userId: string): Promise<PinnableItem[]> {
  const [tasks, notes, ideas] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: TaskStatus.OPEN, archivedAt: null, pinnedAt: { not: null } },
      orderBy: { pinnedAt: "desc" },
      take: 25
    }),
    prisma.note.findMany({
      where: { userId, archivedAt: null, pinnedAt: { not: null } },
      orderBy: { pinnedAt: "desc" },
      take: 25
    }),
    prisma.idea.findMany({
      where: { userId, archivedAt: null, pinnedAt: { not: null } },
      orderBy: { pinnedAt: "desc" },
      take: 25
    })
  ]);

  return [
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      pinnedAt: task.pinnedAt,
      createdAt: task.createdAt
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      summary: note.summary,
      pinnedAt: note.pinnedAt,
      createdAt: note.createdAt
    })),
    ...ideas.map((idea) => ({
      kind: "idea" as const,
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      pinnedAt: idea.pinnedAt,
      createdAt: idea.createdAt
    }))
  ].sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) {
      return b.pinnedAt.getTime() - a.pinnedAt.getTime();
    }

    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export function formatPinResult(item: PinnableItem & { changed: boolean }, shouldPin: boolean): string {
  if (!item.changed) {
    return shouldPin
      ? `${code(item.publicId)} is already pinned.`
      : `${code(item.publicId)} is not pinned right now.`;
  }

  return shouldPin
    ? `${bold("Pinned")} ${code(item.publicId)} ${h(item.title)}`
    : `${bold("Unpinned")} ${code(item.publicId)} ${h(item.title)}`;
}

export function formatPinnedItems(items: PinnableItem[]): string {
  if (items.length === 0) {
    return "No pinned items yet. Use /pin 1, /pin NOTE-1, or /star IDEA-1 to keep something close.";
  }

  return [
    bold("Pinned items"),
    "",
    ...items.map((item) => `${code(item.publicId)} ${bold(item.title)}\n${italic(item.kind)} - ${h(item.summary.slice(0, 180))}`)
  ].join("\n\n");
}

async function findPinnableItem(userId: string, reference: string): Promise<PinnableItem> {
  const normalized = reference.trim();
  if (!normalized) {
    throw new Error("Missing item reference.");
  }

  const typedNumber = normalized.match(/^(tasks?|notes?|ideas?)\s+(\d+)$/i);
  if (typedNumber?.[1] && typedNumber[2]) {
    const kind = typedNumber[1].toLowerCase();
    if (kind.startsWith("task")) {
      const task = await findTaskReference(userId, typedNumber[2]);
      return {
        kind: "task",
        id: task.id,
        publicId: task.publicId,
        title: task.title,
        summary: task.description ?? task.sourceText,
        pinnedAt: task.pinnedAt,
        createdAt: task.createdAt
      };
    }

    if (kind.startsWith("note")) {
      const note = await findNoteReference(userId, typedNumber[2]);
      return {
        kind: "note",
        id: note.id,
        publicId: note.publicId,
        title: note.title,
        summary: note.summary,
        pinnedAt: note.pinnedAt,
        createdAt: note.createdAt
      };
    }

    const idea = await findIdeaReference(userId, typedNumber[2]);
    return {
      kind: "idea",
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      pinnedAt: idea.pinnedAt,
      createdAt: idea.createdAt
    };
  }

  if (/^\d+$/.test(normalized)) {
    const task = await findTaskReference(userId, normalized);
    return {
      kind: "task",
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      pinnedAt: task.pinnedAt,
      createdAt: task.createdAt
    };
  }

  const upper = normalized.toUpperCase();
  const taskById = await prisma.task.findFirst({ where: { userId, id: normalized, archivedAt: null } });
  if (taskById) {
    return {
      kind: "task",
      id: taskById.id,
      publicId: taskById.publicId,
      title: taskById.title,
      summary: taskById.description ?? taskById.sourceText,
      pinnedAt: taskById.pinnedAt,
      createdAt: taskById.createdAt
    };
  }

  const noteById = await prisma.note.findFirst({ where: { userId, id: normalized, archivedAt: null } });
  if (noteById) {
    return {
      kind: "note",
      id: noteById.id,
      publicId: noteById.publicId,
      title: noteById.title,
      summary: noteById.summary,
      pinnedAt: noteById.pinnedAt,
      createdAt: noteById.createdAt
    };
  }

  const ideaById = await prisma.idea.findFirst({ where: { userId, id: normalized, archivedAt: null } });
  if (ideaById) {
    return {
      kind: "idea",
      id: ideaById.id,
      publicId: ideaById.publicId,
      title: ideaById.title,
      summary: ideaById.concept,
      pinnedAt: ideaById.pinnedAt,
      createdAt: ideaById.createdAt
    };
  }

  if (upper.startsWith("TASK-")) {
    const task = await prisma.task.findFirstOrThrow({ where: { userId, publicId: upper, archivedAt: null } });
    return {
      kind: "task",
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      pinnedAt: task.pinnedAt,
      createdAt: task.createdAt
    };
  }

  if (upper.startsWith("NOTE-")) {
    const note = await prisma.note.findFirstOrThrow({ where: { userId, publicId: upper, archivedAt: null } });
    return {
      kind: "note",
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      summary: note.summary,
      pinnedAt: note.pinnedAt,
      createdAt: note.createdAt
    };
  }

  if (upper.startsWith("IDEA-")) {
    const idea = await prisma.idea.findFirstOrThrow({ where: { userId, publicId: upper, archivedAt: null } });
    return {
      kind: "idea",
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      pinnedAt: idea.pinnedAt,
      createdAt: idea.createdAt
    };
  }

  throw new Error("Unsupported pin reference.");
}
