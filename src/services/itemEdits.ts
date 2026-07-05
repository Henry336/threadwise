import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { renameIdeaTitle } from "./ideas";
import { renameNoteTitle } from "./notes";
import { renameTaskTitle } from "./tasks";

export type EditableItemKind = "task" | "note" | "idea";

type EditableItem = {
  kind: EditableItemKind;
  id: string;
  publicId: string;
  title: string;
};

const EDIT_TTL_MS = 15 * 60_000;

export async function beginPendingItemEdit(userId: string, kind: EditableItemKind, itemId: string): Promise<EditableItem> {
  const item = await findEditableItem(userId, kind, itemId);

  await prisma.$transaction(async (tx) => {
    await tx.pendingItemEdit.deleteMany({ where: { userId } });
    await tx.pendingItemEdit.create({
      data: {
        userId,
        itemKind: kind,
        itemId: item.id,
        itemPublicId: item.publicId,
        previousTitle: item.title,
        expiresAt: new Date(Date.now() + EDIT_TTL_MS)
      }
    });
  });

  return item;
}

export async function cancelPendingItemEdit(userId: string): Promise<boolean> {
  const result = await prisma.pendingItemEdit.deleteMany({ where: { userId } });
  return result.count > 0;
}

export async function applyPendingItemEdit(userId: string, title: string): Promise<string | undefined> {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return undefined;
  }

  const pending = await prisma.pendingItemEdit.findFirst({
    where: {
      userId,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!pending) {
    await prisma.pendingItemEdit.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
    return undefined;
  }

  await prisma.pendingItemEdit.delete({ where: { id: pending.id } });

  if (pending.itemKind === "task") {
    const task = await renameTaskTitle(userId, pending.itemPublicId, nextTitle);
    return renamedMessage(task.publicId, task.title);
  }

  if (pending.itemKind === "note") {
    const note = await renameNoteTitle(userId, pending.itemPublicId, nextTitle);
    return renamedMessage(note.publicId, note.title);
  }

  if (pending.itemKind === "idea") {
    const idea = await renameIdeaTitle(userId, pending.itemPublicId, nextTitle);
    return renamedMessage(idea.publicId, idea.title);
  }

  return undefined;
}

export function formatEditStarted(item: EditableItem): string {
  return [
    `${bold("Editing")} ${code(item.publicId)} ${h(item.title)}`,
    "Send the new title as your next message.",
    `${code("cancel edit")} if you changed your mind.`
  ].join("\n");
}

function renamedMessage(publicId: string, title: string): string {
  return `${bold("Renamed")} ${code(publicId)} ${h(title)}\n${code("/undo")} will put the old title back.`;
}

async function findEditableItem(userId: string, kind: EditableItemKind, itemId: string): Promise<EditableItem> {
  if (kind === "task") {
    const task = await prisma.task.findFirstOrThrow({ where: { userId, id: itemId, archivedAt: null } });
    return { kind, id: task.id, publicId: task.publicId, title: task.title };
  }

  if (kind === "note") {
    const note = await prisma.note.findFirstOrThrow({ where: { userId, id: itemId, archivedAt: null } });
    return { kind, id: note.id, publicId: note.publicId, title: note.title };
  }

  const idea = await prisma.idea.findFirstOrThrow({ where: { userId, id: itemId, archivedAt: null } });
  return { kind, id: idea.id, publicId: idea.publicId, title: idea.title };
}
