import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { renameIdeaTitle, updateIdeaConcept } from "./ideas";
import { renameNoteTitle, updateNoteBody } from "./notes";
import { renameTaskTitle, updateTaskDescription } from "./tasks";
import { updateStoredImageCaption } from "./storedImages";

export type EditableItemKind = "task" | "note" | "idea" | "image";
export type EditableItemField = "title" | "description" | "body" | "concept" | "caption";

type EditableItem = {
  kind: EditableItemKind;
  id: string;
  publicId: string;
  title: string;
  field: EditableItemField;
};

export type AppliedItemEdit = {
  kind: EditableItemKind;
  publicId: string;
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

export async function applyPendingItemEdit(userId: string, value: string): Promise<AppliedItemEdit | undefined> {
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
      return { kind: "task", publicId: task.publicId };
    }

    const task = await renameTaskTitle(userId, pending.itemPublicId, nextValue);
    return { kind: "task", publicId: task.publicId };
  }

  if (pending.itemKind === "note") {
    if (pending.editField === "body") {
      const note = await updateNoteBody(userId, pending.itemPublicId, nextValue);
      return { kind: "note", publicId: note.publicId };
    }

    const note = await renameNoteTitle(userId, pending.itemPublicId, nextValue);
    return { kind: "note", publicId: note.publicId };
  }

  if (pending.itemKind === "idea") {
    if (pending.editField === "concept") {
      const idea = await updateIdeaConcept(userId, pending.itemPublicId, nextValue);
      return { kind: "idea", publicId: idea.publicId };
    }

    const idea = await renameIdeaTitle(userId, pending.itemPublicId, nextValue);
    return { kind: "idea", publicId: idea.publicId };
  }

  if (pending.itemKind === "image") {
    const image = await updateStoredImageCaption(userId, pending.itemPublicId, nextValue);
    return { kind: "image", publicId: image.publicId };
  }

  return undefined;
}

export function formatEditStarted(item: EditableItem): string {
  const label = fieldLabel(item.field);
  return [
    `${bold("✏️ Ready to edit")} ${code(item.publicId)} ${h(label)}`,
    `Send the new ${label} as your next message.`,
    "Changed your mind? Tap Cancel edit and I’ll leave it untouched."
  ].join("\n");
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

  if (kind === "image") {
    const image = await prisma.storedImage.findFirstOrThrow({ where: { userId, id: itemId } });
    return { kind, id: image.id, publicId: image.publicId, title: image.caption || image.fileName || "Saved image", field: "caption" };
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

  if (kind === "image") {
    const image = await prisma.storedImage.findUniqueOrThrow({ where: { id: itemId } });
    return image.caption;
  }

  const idea = await prisma.idea.findUniqueOrThrow({ where: { id: itemId } });
  return field === "concept" ? idea.concept : idea.title;
}

function fieldLabel(field: EditableItemField): string {
  if (field === "description") return "details";
  return field;
}
