import type { AiProvider } from "../ai/types";
import { prisma } from "../db/prisma";
import { nextPublicId } from "./publicIds";

export async function createNote(userId: string, sourceText: string, ai: AiProvider) {
  const structured = await ai.structureNote(sourceText);
  const embedding = await ai.embed(`${structured.title}\n${structured.summary}\n${structured.body}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "NOTE");

  return prisma.note.create({
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
}

export async function listRecentNotes(userId: string) {
  return prisma.note.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 15
  });
}

export async function searchNotes(userId: string, query: string) {
  return prisma.note.findMany({
    where: {
      userId,
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
}

export async function findNote(userId: string, publicId: string) {
  return prisma.note.findFirstOrThrow({
    where: {
      userId,
      publicId: publicId.toUpperCase()
    }
  });
}

export async function analyzeNoteStyle(userId: string, ai: AiProvider) {
  const notes = await prisma.note.findMany({
    where: { userId },
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
    `Saved ${note.publicId}: ${note.title}`,
    "",
    note.summary,
    note.tags.length ? `Tags: ${note.tags.join(", ")}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRecentNotes(notes: Array<{ publicId: string; title: string; summary: string; tags: string[] }>): string {
  if (notes.length === 0) {
    return "No saved notes yet.";
  }

  return [
    "Recent notes",
    "",
    ...notes.map((note) => {
      const tags = note.tags.length ? ` [${note.tags.join(", ")}]` : "";
      return `${note.publicId}: ${note.title}${tags}\n${note.summary}`;
    })
  ].join("\n\n");
}

export function formatNoteDetail(note: { publicId: string; title: string; body: string; summary: string; tags: string[]; createdAt: Date }): string {
  return [
    `${note.publicId}: ${note.title}`,
    "",
    note.body,
    "",
    `Summary: ${note.summary}`,
    note.tags.length ? `Tags: ${note.tags.join(", ")}` : undefined,
    `Saved: ${note.createdAt.toLocaleString()}`
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
    "Notekeeping analysis",
    "",
    analysis.overview,
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

  return [title, ...items.map((item) => `- ${item}`)].join("\n");
}
