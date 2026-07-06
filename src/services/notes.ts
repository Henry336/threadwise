import { Prisma } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { shouldUseAiForNoteStructure, structureNoteDeterministically } from "../ai/deterministic";
import { bold, code, h } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextPublicId } from "./publicIds";
import { recordArchiveUndo, recordCreateUndo, recordFieldEditUndo, recordRenameUndo } from "./undo";
import { formatDateTimeForUser } from "../utils/dates";

export async function createNote(userId: string, sourceText: string, ai: AiProvider) {
  const structured = shouldUseAiForNoteStructure(sourceText)
    ? await ai.structureNote(sourceText)
    : structureNoteDeterministically(sourceText);
  const embedding = await ai.embed(`${structured.title}\n${structured.summary}\n${structured.body}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "NOTE");

  return prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        userId,
        publicId,
        title: structured.title,
        body: structured.body,
        summary: structured.summary,
        sourceText,
        tags: structured.tags,
        embedding
      }
    });
    await recordCreateUndo(tx, userId, { kind: "note", id: note.id, publicId: note.publicId, title: note.title });
    return note;
  });
}

export async function listRecentNotes(userId: string) {
  const notes = await prisma.note.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 15
  });

  return sortPinnedFirst(notes);
}

export async function searchNotes(userId: string, query: string) {
  const notes = await prisma.note.findMany({
    where: {
      userId,
      archivedAt: null,
      OR: [
        { publicId: { equals: query.toUpperCase() } },
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { body: { contains: query, mode: "insensitive" } },
        { sourceText: { contains: query, mode: "insensitive" } }
      ]
    },
    orderBy: { createdAt: "desc" },
    take: 15
  });

  return sortPinnedFirst(notes);
}

export async function findNote(userId: string, publicId: string) {
  return prisma.note.findFirstOrThrow({
    where: {
      userId,
      archivedAt: null,
      publicId: publicId.toUpperCase()
    }
  });
}

export async function findAnyNote(userId: string, publicId: string) {
  return prisma.note.findFirstOrThrow({
    where: {
      userId,
      publicId: publicId.toUpperCase()
    }
  });
}

export async function findNoteReference(userId: string, reference: string) {
  const normalized = reference.trim();
  const activeIndex = Number(normalized);
  if (Number.isInteger(activeIndex) && activeIndex > 0) {
    const notes = await listRecentNotes(userId);
    const note = notes[activeIndex - 1];
    if (!note) {
      throw new Error(`No recent note numbered ${activeIndex}. Run /notes to see the current list.`);
    }
    return note;
  }

  return findNote(userId, normalized);
}

export async function renameNoteTitle(userId: string, publicId: string, title: string) {
  const note = await findNote(userId, publicId);
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new Error("Note title cannot be empty.");
  }

  return prisma.$transaction(async (tx) => {
    await recordRenameUndo(tx, userId, { kind: "note", id: note.id, publicId: note.publicId, title: nextTitle }, note.title);
    return tx.note.update({
      where: { id: note.id },
      data: { title: nextTitle }
    });
  });
}

export async function updateNoteBody(userId: string, publicId: string, body: string) {
  const note = await findNote(userId, publicId);
  const nextBody = body.trim();
  if (!nextBody) {
    throw new Error("Note body cannot be empty.");
  }

  return prisma.$transaction(async (tx) => {
    await recordFieldEditUndo(tx, userId, { kind: "note", id: note.id, publicId: note.publicId, title: note.title }, "body", note.body);
    return tx.note.update({
      where: { id: note.id },
      data: {
        body: nextBody,
        summary: summarizeManualText(nextBody),
        embedding: Prisma.JsonNull
      }
    });
  });
}

export async function archiveNote(userId: string, reference: string) {
  const note = await findNoteByRowId(userId, reference) ?? await findNoteReference(userId, reference);
  const archivedAt = new Date();

  return prisma.$transaction(async (tx) => {
    await recordArchiveUndo(tx, userId, {
      kind: "note",
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      archivedAt: note.archivedAt,
      archivedReason: note.archivedReason
    });

    return tx.note.update({
      where: { id: note.id },
      data: {
        archivedAt,
        archivedReason: "removed"
      }
    });
  });
}

async function findNoteByRowId(userId: string, id: string) {
  return prisma.note.findFirst({
    where: {
      userId,
      id,
      archivedAt: null
    }
  });
}

export async function analyzeNoteStyle(userId: string, ai: AiProvider) {
  const notes = await prisma.note.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return ai.analyzeNotes(
    notes.map((note) => ({
      title: note.title,
      body: note.body,
      summary: note.summary,
      tags: note.tags,
      createdAt: note.createdAt.toISOString()
    }))
  );
}

export function formatNoteCreated(note: { publicId: string; title: string; summary: string }): string {
  return [
    `${bold("Saved note")} ${code(note.publicId)} ${h(note.title)}`,
    "",
    h(note.summary)
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRecentNotes(notes: Array<{ publicId: string; title: string; summary: string; pinnedAt?: Date | null }>): string {
  if (notes.length === 0) {
    return "No saved notes yet. Send /note when something is worth keeping.";
  }

  return [
    bold("Recent notes"),
    "",
    ...notes.map((note, index) => {
      const pin = note.pinnedAt ? `${bold("Pinned")} ` : "";
      return `${index + 1}. ${pin}${code(note.publicId)} ${bold(note.title)}\n${h(note.summary)}`;
    })
  ].join("\n\n");
}

export function formatNoteDetail(note: {
  publicId: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  createdAt: Date;
  archivedAt?: Date | null;
  archivedReason?: string | null;
}, timezone = "UTC"): string {
  return [
    `${code(note.publicId)} ${bold(note.title)}`,
    "",
    h(note.body),
    "",
    `${bold("Summary")} ${h(note.summary)}`,
    note.tags.length ? `${bold("Tags")} ${h(note.tags.join(", "))}` : undefined,
    note.archivedAt ? `${bold("Archived")} ${h(formatDateTimeForUser(note.archivedAt, timezone))}${note.archivedReason ? ` (${h(note.archivedReason)})` : ""}` : undefined,
    `${bold("Saved")} ${h(formatDateTimeForUser(note.createdAt, timezone))}`
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatNoteAnalysis(analysis: {
  overview: string;
  whatWorks: string[];
  whatDoesNotWork: string[];
  suggestions: string[];
  experiments: string[];
}): string {
  return [
    bold("Notekeeping analysis"),
    "",
    h(analysis.overview),
    "",
    formatList("What works", analysis.whatWorks),
    formatList("What does not work", analysis.whatDoesNotWork),
    formatList("Suggestions", analysis.suggestions),
    formatList("Experiments", analysis.experiments)
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatList(title: string, items: string[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return [bold(title), ...items.map((item) => `- ${h(item)}`)].join("\n");
}

function sortPinnedFirst<T extends { pinnedAt?: Date | null; createdAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) {
      return b.pinnedAt.getTime() - a.pinnedAt.getTime();
    }

    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;

    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function summarizeManualText(value: string): string {
  return value.length <= 180 ? value : `${value.slice(0, 177).trim()}...`;
}
