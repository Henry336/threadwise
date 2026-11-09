/**
 * Ordinary (Personal/Group) notes: create, list, search, find, rename, edit, archive, and analyze.
 * Used by note commands, callbacks, and cards in src/bot, the dashboard routes, and by
 * noteMerges/captureReclassification/itemEdits. All lookups are scoped by the owner's userId,
 * and user-reversible writes record an undo audit entry in the same transaction.
 */
import type { Prisma } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { shouldUseAiForNoteStructure, structureNoteDeterministically } from "../ai/deterministic";
import { bold, code, h, italic } from "../utils/html";
import { truncate } from "../utils/text";
import { prisma } from "../db/prisma";
import { createWithPublicId } from "./publicIds";
import { recordArchiveUndo, recordCreateUndo, recordFieldEditUndo, recordRenameUndo } from "./undo";
import { fieldHtml, joinBlocks } from "../utils/messageFormat";
import type { ListPageInfo } from "./listPagination";
import { completeSearchableContentUpdate, contentMatchesQuery, encryptedSearchClause } from "../security/contentEncryption";

/**
 * Saves a note. Short text is structured by local rules; only long or "clean this up" style text
 * goes to the AI adapter, so normal capture never waits on an AI call.
 */
export async function createNote(userId: string, sourceText: string, ai: AiProvider) {
  const structured = shouldUseAiForNoteStructure(sourceText)
    ? await ai.structureNote(sourceText)
    : structureNoteDeterministically(sourceText);

  return createWithPublicId(userId, "NOTE", async (tx, publicId) => {
    const note = await tx.note.create({
      data: {
        userId,
        publicId,
        title: structured.title,
        body: structured.body,
        summary: structured.summary,
        sourceText,
        tags: structured.tags
      }
    });
    await recordCreateUndo(tx, userId, { kind: "note", id: note.id, publicId: note.publicId, title: note.title });
    return note;
  });
}

// Starred items first (newest star first), then the rest newest first. Sorting in the
// query keeps an old starred item from falling off a list cut short by `take`.
const PINNED_FIRST = [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] satisfies Prisma.NoteOrderByWithRelationInput[];

export async function listRecentNotes(userId: string, take?: number) {
  return prisma.note.findMany({
    where: { userId, archivedAt: null },
    orderBy: PINNED_FIRST,
    take
  });
}

/**
 * Searches active notes. The query matches both plaintext rows and encrypted rows (through blind
 * search tokens), then each hit is checked again on the decrypted text to drop token false positives.
 */
export async function searchNotes(userId: string, query: string) {
  const encrypted = encryptedSearchClause("Note", query);
  const notes = await prisma.note.findMany({
    where: {
      userId,
      archivedAt: null,
      OR: [
        { publicId: { equals: query.toUpperCase() } },
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { body: { contains: query, mode: "insensitive" } },
        { sourceText: { contains: query, mode: "insensitive" } },
        ...(encrypted ? [encrypted] : [])
      ]
    },
    orderBy: PINNED_FIRST,
    take: 15
  });

  return notes.filter((note) =>
    note.publicId.toUpperCase() === query.toUpperCase() || contentMatchesQuery("Note", note, query)
  );
}

export async function findNote(userId: string, publicOrUuid: string) {
  return prisma.note.findFirstOrThrow({
    where: {
      userId,
      archivedAt: null,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });
}

/** Like findNote but also returns archived notes, for opening an archived or merged note by ID. */
export async function findAnyNote(userId: string, publicId: string) {
  return prisma.note.findFirstOrThrow({
    where: {
      userId,
      publicId: publicId.toUpperCase()
    }
  });
}

/** A plain number means "the Nth row of /notes" (starred-first order); otherwise an id or public ID. */
export async function findNoteReference(userId: string, reference: string) {
  const normalized = reference.trim();
  const activeIndex = Number(normalized);
  if (Number.isInteger(activeIndex) && activeIndex > 0) {
    // Fetch only the row at that position of the /notes list, not the whole list.
    const note = await prisma.note.findFirst({
      where: { userId, archivedAt: null },
      orderBy: PINNED_FIRST,
      skip: activeIndex - 1
    });
    if (!note) {
      throw new Error(`No recent note numbered ${activeIndex}. Run /notes to see the current list.`);
    }
    return note;
  }

  return findNote(userId, normalized);
}

/**
 * Renames a note and records the old title for Undo. completeSearchableContentUpdate includes every
 * searchable field so encrypted search tokens are rebuilt from the whole record.
 */
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
      data: completeSearchableContentUpdate("Note", note, { title: nextTitle })
    });
  });
}

/** Replaces the body (and its summary/source text) and records the previous body for Undo. */
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
      data: completeSearchableContentUpdate("Note", note, {
        body: nextBody,
        summary: summarizeManualText(nextBody),
        sourceText: nextBody
      })
    });
  });
}

/**
 * Archives a note with archivedReason "removed" (no hard delete) and records an undo entry.
 * Accepts a database row id (from buttons) as well as a typed reference.
 */
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

/** Sends the latest 100 active notes to the AI adapter for feedback on the user's note-keeping habits. Read only. */
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
  return joinBlocks([
    bold("✅ Note saved"),
    [bold(note.title), h(note.summary)].join("\n"),
    fieldHtml("Note ID", code(note.publicId))
  ]);
}

export function formatNoteSavedAcknowledgement(note: { title: string }): string {
  return `${bold("Note saved")} · ${h(note.title)}`;
}

/** Renders the /notes list. Row numbers continue across pages so they match findNoteReference. */
export function formatRecentNotes(notes: Array<{ publicId: string; title: string; summary: string; pinnedAt?: Date | null }>, page?: ListPageInfo): string {
  if (notes.length === 0) {
    return "Nothing saved here yet—send a note when something is worth keeping.";
  }

  return [
    page && page.totalPages > 1 ? `${bold("📝 Notes")} · ${page.page}/${page.totalPages}` : bold("📝 Notes"),
    "",
    ...notes.map((note, index) => {
      const pin = note.pinnedAt ? "⭐ " : "";
      return `${(page?.offset ?? 0) + index + 1} · ${pin}${bold(truncate(note.title, 72))}\n${h(truncate(note.summary, 110))}`;
    }),
    "",
    italic("Tap a number to open it.")
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
  void timezone;
  const metadata = note.archivedAt ? "🗃 Archived" : "";

  return joinBlocks([
    bold("📝 Note"),
    bold(note.title),
    h(note.body),
    metadata
  ]);
}

export function formatNoteAnalysis(analysis: {
  overview: string;
  whatWorks: string[];
  whatDoesNotWork: string[];
  suggestions: string[];
  experiments: string[];
}): string {
  return [
    bold("📝 Your notekeeping patterns"),
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

function summarizeManualText(value: string): string {
  return value.length <= 180 ? value : `${value.slice(0, 177).trim()}...`;
}
