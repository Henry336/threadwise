import type { AiProvider } from "../ai/types";
import { prisma } from "../db/prisma";
import { cosineSimilarity } from "../utils/vector";

export type SearchResult = {
  kind: "idea" | "task" | "note" | "reflection";
  publicId: string;
  title: string;
  summary: string;
  score: number;
};

export type SearchKind = SearchResult["kind"];

export type ParsedSearchRequest = {
  query: string;
  kinds?: SearchKind[];
  label?: string;
};

const SEARCH_FILTERS: Record<string, SearchKind[]> = {
  idea: ["idea"],
  ideas: ["idea"],
  task: ["task"],
  tasks: ["task"],
  note: ["note"],
  notes: ["note"],
  reflection: ["reflection"],
  reflections: ["reflection"],
  reflect: ["reflection"],
  all: ["idea", "task", "note", "reflection"]
};

export function parseSearchRequest(input: string): ParsedSearchRequest {
  const trimmed = input.trim();
  const [first = "", ...rest] = trimmed.split(/\s+/);
  const kinds = SEARCH_FILTERS[first.toLowerCase()];

  if (!kinds) {
    return { query: trimmed };
  }

  return {
    query: rest.join(" ").trim(),
    kinds: first.toLowerCase() === "all" ? undefined : kinds,
    label: first.toLowerCase() === "all" ? undefined : kinds.join(", ")
  };
}

export async function semanticSearch(userId: string, query: string, ai: AiProvider, kinds?: SearchKind[]): Promise<SearchResult[]> {
  const queryEmbedding = await ai.embed(query);
  const shouldSearch = (kind: SearchKind) => !kinds || kinds.includes(kind);
  const [ideas, tasks, notes, reflections] = await Promise.all([
    shouldSearch("idea") ? prisma.idea.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    shouldSearch("task") ? prisma.task.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    shouldSearch("note") ? prisma.note.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    shouldSearch("reflection")
      ? prisma.reflection.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 })
      : []
  ]);

  const results: SearchResult[] = [
    ...ideas.map((idea) => ({
      kind: "idea" as const,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      score: scoreResult(query, queryEmbedding, asVector(idea.embedding), [idea.publicId, idea.title, idea.concept, idea.sourceText])
    })),
    ...tasks.map((task) => ({
      kind: "task" as const,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      score: scoreResult(query, queryEmbedding, asVector(task.embedding), [task.publicId, task.title, task.description ?? "", task.sourceText])
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      publicId: note.publicId,
      title: note.title,
      summary: note.summary,
      score: scoreResult(query, queryEmbedding, asVector(note.embedding), [note.publicId, note.title, note.summary, note.body, note.sourceText])
    })),
    ...reflections.map((reflection) => ({
      kind: "reflection" as const,
      publicId: reflection.publicId,
      title: reflection.situation.slice(0, 80),
      summary: reflection.immediateAction,
      score: scoreResult(query, queryEmbedding, asVector(reflection.embedding), [
        reflection.publicId,
        reflection.situation,
        reflection.balancedView,
        reflection.immediateAction,
        reflection.sourceText
      ])
    }))
  ];

  return results
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function asVector(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is number => typeof item === "number");
}

function scoreResult(query: string, queryEmbedding: number[], embedding: number[], fields: string[]): number {
  const semantic = cosineSimilarity(queryEmbedding, embedding);
  const lexical = lexicalScore(query, fields);
  return Math.max(semantic, lexical);
}

function lexicalScore(query: string, fields: string[]): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = fields.join(" ").toLowerCase();
  if (haystack.includes(normalizedQuery)) {
    return 0.92;
  }

  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  if (terms.length === 0) {
    return 0;
  }

  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched === 0 ? 0 : Math.min(0.85, 0.35 + matched / terms.length / 2);
}
