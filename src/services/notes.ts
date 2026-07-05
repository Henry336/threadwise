import type { AiProvider } from "../ai/types";
import { bold, code, h, italic } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextPublicId } from "./publicIds";
import { recordCreateUndo, recordRenameUndo } from "./undo";

export async function createNote(userId: string, sourceText: string, ai: AiProvider) {
  const structured = await ai.structureNote(sourceText);
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

export function formatNoteCreated(note: { publicId: string; title: string; summary: string; tags: string[] }): string {
  return [
    `${bold("Saved note")} ${code(note.publicId)} ${h(note.title)}`,
    "",
    h(note.summary),
    note.tags.length ? `${bold("Tags")} ${h(note.tags.join(", "))}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRecentNotes(notes: Array<{ publicId: string; title: string; summary: string; tags: string[]; pinnedAt?: Date | null }>): string {
  if (notes.length === 0) {
    return "No saved notes yet. Send /note when something is worth keeping.";
  }

  return [
    bold("Recent notes"),
    "",
    ...notes.map((note) => {
      const tags = note.tags.length ? ` ${italic(note.tags.join(", "))}` : "";
      const pin = note.pinnedAt ? `${bold("Pinned")} ` : "";
      return `${pin}${code(note.publicId)} ${bold(note.title)}${tags}\n${h(note.summary)}`;
    })
  ].join("\n\n");
}

export function formatNoteDetail(note: { publicId: string; title: string; body: string; summary: string; tags: string[]; createdAt: Date }): string {
  return [
    `${code(note.publicId)} ${bold(note.title)}`,
    "",
    h(note.body),
    "",
    `${bold("Summary")} ${h(note.summary)}`,
    note.tags.length ? `${bold("Tags")} ${h(note.tags.join(", "))}` : undefined,
    `${bold("Saved")} ${h(note.createdAt.toLocaleString())}`
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
