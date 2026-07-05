import type { Note } from "@prisma/client";
import type { AiProvider, MergedNotePreview, NoteForMerge } from "../ai/types";
import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { nextPublicId } from "./publicIds";
import { findNoteReference } from "./notes";
import { recordNoteMergeUndo } from "./undo";

const MERGE_EXPIRY_MS = 60 * 60_000;
const MAX_MERGE_NOTES = 8;
const MAX_RETRY_ATTEMPTS = 5;

export type NoteMergePreviewResult = {
  pendingId: string;
  preview: MergedNotePreview;
  sourceNotes: Note[];
  attemptCount: number;
};

export async function createNoteMergePreview(userId: string, references: string[], ai: AiProvider): Promise<NoteMergePreviewResult> {
  const sourceNotes = await resolveMergeNotes(userId, references);
  const preview = await ai.mergeNotes(sourceNotes.map(toNoteForMerge));
  const pending = await prisma.pendingNoteMerge.create({
    data: {
      userId,
      sourceNoteIds: sourceNotes.map((note) => note.id),
      preview,
      expiresAt: new Date(Date.now() + MERGE_EXPIRY_MS)
    }
  });

  return {
    pendingId: pending.id,
    preview,
    sourceNotes,
    attemptCount: pending.attemptCount
  };
}

export async function retryNoteMergePreview(userId: string, pendingId: string, ai: AiProvider): Promise<NoteMergePreviewResult> {
  const pending = await prisma.pendingNoteMerge.findFirstOrThrow({
    where: {
      id: pendingId,
      userId,
      expiresAt: { gt: new Date() }
    }
  });

  if (pending.attemptCount >= MAX_RETRY_ATTEMPTS) {
    throw new Error(`I can try ${MAX_RETRY_ATTEMPTS} previews for one merge. Use this one or cancel and start a new merge.`);
  }

  const sourceNotes = await notesByIds(userId, pending.sourceNoteIds);
  const previousPreview = asMergedNotePreview(pending.preview);
  const preview = await ai.mergeNotes(sourceNotes.map(toNoteForMerge), previousPreview, pending.attemptCount + 1);
  const updated = await prisma.pendingNoteMerge.update({
    where: { id: pending.id },
    data: {
      preview,
      attemptCount: { increment: 1 },
      expiresAt: new Date(Date.now() + MERGE_EXPIRY_MS)
    }
  });

  return {
    pendingId: updated.id,
    preview,
    sourceNotes,
    attemptCount: updated.attemptCount
  };
}

export async function confirmNoteMerge(userId: string, pendingId: string, ai: AiProvider) {
  const pending = await prisma.pendingNoteMerge.findFirstOrThrow({
    where: {
      id: pendingId,
      userId,
      expiresAt: { gt: new Date() }
    }
  });
  const preview = asMergedNotePreview(pending.preview);
  const sourceNotes = await notesByIds(userId, pending.sourceNoteIds);
  const publicId = await nextPublicId(userId, "NOTE");
  const embedding = await ai.embed(`${preview.title}\n${preview.summary}\n${preview.body}`);
  const archivedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const mergedNote = await tx.note.create({
      data: {
        userId,
        publicId,
        title: preview.title,
        body: preview.body,
        summary: preview.summary,
        sourceText: sourceNotes.map((note) => `${note.publicId}: ${note.sourceText}`).join("\n\n"),
        tags: preview.tags,
        embedding
      }
    });

    for (const note of sourceNotes) {
      await tx.note.update({
        where: { id: note.id },
        data: {
          archivedAt,
          archivedReason: "merged",
          mergedIntoNoteId: mergedNote.id,
          pinnedAt: null
        }
      });
    }

    await recordNoteMergeUndo(tx, userId, { kind: "note", id: mergedNote.id, publicId: mergedNote.publicId, title: mergedNote.title }, sourceNotes);
    await tx.pendingNoteMerge.delete({ where: { id: pending.id } });

    return { mergedNote, sourceNotes };
  });
}

export async function cancelNoteMerge(userId: string, pendingId: string): Promise<void> {
  await prisma.pendingNoteMerge.deleteMany({
    where: {
      id: pendingId,
      userId
    }
  });
}

export function formatNoteMergePreview(result: NoteMergePreviewResult): string {
  const preview = result.preview;
  return [
    `${bold("Merged note preview")} ${code(`attempt ${result.attemptCount}`)}`,
    `${bold("Sources")} ${result.sourceNotes.map((note) => code(note.publicId)).join(", ")}`,
    "",
    `${bold("Title")} ${h(preview.title)}`,
    "",
    h(preview.body),
    "",
    `${bold("Summary")} ${h(preview.summary)}`,
    preview.connections.length ? ["", bold("Connections"), ...preview.connections.map((item) => `- ${h(item)}`)].join("\n") : undefined,
    preview.preservedDetails.length ? ["", bold("Details preserved"), ...preview.preservedDetails.map((item) => `- ${h(item)}`)].join("\n") : undefined,
    preview.possibleMissingContext.length
      ? ["", bold("Possible missing context"), ...preview.possibleMissingContext.map((item) => `- ${h(item)}`)].join("\n")
      : undefined,
    preview.tags.length ? ["", `${bold("Tags")} ${h(preview.tags.join(", "))}`].join("\n") : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatNoteMergeConfirmed(result: { mergedNote: Note; sourceNotes: Note[] }): string {
  return [
    `${bold("Merged")} ${result.sourceNotes.map((note) => code(note.publicId)).join(", ")} ${bold("into")} ${code(result.mergedNote.publicId)}`,
    h(result.mergedNote.title),
    "",
    `${code("/undo")} restores the source notes and archives the merged note.`
  ].join("\n");
}

async function resolveMergeNotes(userId: string, references: string[]): Promise<Note[]> {
  const cleaned = references.map((reference) => reference.trim()).filter(Boolean);
  if (cleaned.length < 2) {
    throw new Error("Pick at least two notes to merge.");
  }

  if (cleaned.length > MAX_MERGE_NOTES) {
    throw new Error(`Merge up to ${MAX_MERGE_NOTES} notes at a time so the preview stays reviewable.`);
  }

  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const reference of cleaned) {
    const note = await findNoteReference(userId, reference);
    if (!seen.has(note.id)) {
      notes.push(note);
      seen.add(note.id);
    }
  }

  if (notes.length < 2) {
    throw new Error("Those references point to fewer than two unique notes.");
  }

  return notes;
}

async function notesByIds(userId: string, ids: string[]): Promise<Note[]> {
  const notes = await prisma.note.findMany({
    where: {
      userId,
      id: { in: ids },
      archivedAt: null
    }
  });
  const byId = new Map(notes.map((note) => [note.id, note]));
  const ordered = ids.map((id) => byId.get(id)).filter((note): note is Note => Boolean(note));
  if (ordered.length !== ids.length) {
    throw new Error("One of those notes is no longer active. Start the merge again from /notes.");
  }

  return ordered;
}

function toNoteForMerge(note: Note): NoteForMerge {
  return {
    publicId: note.publicId,
    title: note.title,
    body: note.body,
    summary: note.summary,
    tags: note.tags,
    sourceText: note.sourceText,
    createdAt: note.createdAt.toISOString()
  };
}

function asMergedNotePreview(value: unknown): MergedNotePreview {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    title: stringValue(record.title) ?? "Merged Note",
    body: stringValue(record.body) ?? "",
    summary: stringValue(record.summary) ?? "",
    tags: stringArray(record.tags),
    connections: stringArray(record.connections),
    preservedDetails: stringArray(record.preservedDetails),
    possibleMissingContext: stringArray(record.possibleMissingContext)
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
