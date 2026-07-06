import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { renameIdeaTitle, updateIdeaConcept } from "./ideas";
import { renameNoteTitle, updateNoteBody } from "./notes";
import { renameTaskTitle, updateTaskDescription } from "./tasks";

export type EditableItemKind = "task" | "note" | "idea";
export type EditableItemField = "title" | "description" | "body" | "concept";

type EditableItem = {
  kind: EditableItemKind;
  id: string;
  publicId: string;
  title: string;
  field: EditableItemField;
};

const EDIT_TTL_MS = 15 * 60_000;

export async function beginPendingItemEdit(userId: string, kind: EditableItemKind, itemId: string, field: EditableItemField = "title"): Promise<EditableItem> {
  const item = await findEditableItem(userId, kind, itemId, field);

  await prisma.$transaction(async (tx) => {
    await tx.pendingItemEdit.deleteMany({ where: { userId } });
    await tx.pendingItemEdit.create({
      data: {
        userId,
        itemKind: kind,
        itemId: item.id,
        itemPublicId: item.publicId,
        editField: item.field,
        previousTitle: item.title,
        previousValue: await previousValueForItem(kind, item.id, field),
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

export async function applyPendingItemEdit(userId: string, value: string): Promise<string | undefined> {
  const nextValue = value.trim();
  if (!nextValue) {
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
    if (pending.editField === "description") {
      const task = await updateTaskDescription(userId, pending.itemPublicId, nextValue);
      return editedMessage(task.publicId, "details");
    }

    const task = await renameTaskTitle(userId, pending.itemPublicId, nextValue);
    return renamedMessage(task.publicId, task.title);
  }

  if (pending.itemKind === "note") {
    if (pending.editField === "body") {
      const note = await updateNoteBody(userId, pending.itemPublicId, nextValue);
      return editedMessage(note.publicId, "body");
    }

    const note = await renameNoteTitle(userId, pending.itemPublicId, nextValue);
    return renamedMessage(note.publicId, note.title);
  }

  if (pending.itemKind === "idea") {
    if (pending.editField === "concept") {
      const idea = await updateIdeaConcept(userId, pending.itemPublicId, nextValue);
      return editedMessage(idea.publicId, "concept");
    }

    const idea = await renameIdeaTitle(userId, pending.itemPublicId, nextValue);
    return renamedMessage(idea.publicId, idea.title);
  }

  return undefined;
}

export function formatEditStarted(item: EditableItem): string {
  const label = fieldLabel(item.field);
  return [
    `${bold("Editing")} ${code(item.publicId)} ${h(label)}`,
    `Send the new ${label} as your next message.`,
    `${code("cancel edit")} if you changed your mind.`
  ].join("\n");
}

function renamedMessage(publicId: string, title: string): string {
  return `${bold("Renamed")} ${code(publicId)} ${h(title)}\n${code("/undo")} will put the old title back.`;
}

function editedMessage(publicId: string, field: string): string {
  return `${bold("Updated")} ${code(publicId)} ${h(field)}\n${code("/undo")} will restore the previous version.`;
}

async function findEditableItem(userId: string, kind: EditableItemKind, itemId: string, field: EditableItemField): Promise<EditableItem> {
  if (kind === "task") {
    const task = await prisma.task.findFirstOrThrow({ where: { userId, id: itemId, archivedAt: null } });
    return { kind, id: task.id, publicId: task.publicId, title: task.title, field: field === "description" ? "description" : "title" };
  }

  if (kind === "note") {
    const note = await prisma.note.findFirstOrThrow({ where: { userId, id: itemId, archivedAt: null } });
    return { kind, id: note.id, publicId: note.publicId, title: note.title, field: field === "body" ? "body" : "title" };
  }

  const idea = await prisma.idea.findFirstOrThrow({ where: { userId, id: itemId, archivedAt: null } });
  return { kind, id: idea.id, publicId: idea.publicId, title: idea.title, field: field === "concept" ? "concept" : "title" };
}

async function previousValueForItem(kind: EditableItemKind, itemId: string, field: EditableItemField): Promise<string | null> {
  if (kind === "task") {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: itemId } });
    return field === "description" ? task.description : task.title;
  }

  if (kind === "note") {
    const note = await prisma.note.findUniqueOrThrow({ where: { id: itemId } });
    return field === "body" ? note.body : note.title;
  }

  const idea = await prisma.idea.findUniqueOrThrow({ where: { id: itemId } });
  return field === "concept" ? idea.concept : idea.title;
}

function fieldLabel(field: EditableItemField): string {
  if (field === "description") return "details";
  return field;
}
