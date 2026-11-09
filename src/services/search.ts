import { TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { cosineSimilarity, deterministicEmbedding } from "../utils/vector";

export type SearchResult = {
  kind: "idea" | "task" | "note";
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
  includeDone?: boolean;
  doneOnly?: boolean;
};

const SEARCH_FILTERS: Record<string, SearchKind[]> = {
  idea: ["idea"],
  ideas: ["idea"],
  task: ["task"],
  tasks: ["task"],
  note: ["note"],
  notes: ["note"],
  all: ["idea", "task", "note"]
};

const SEARCH_TTL_MS = 30 * 60_000;

export function parseSearchRequest(input: string): ParsedSearchRequest {
  const trimmed = input.trim();
  const [first = "", ...rest] = trimmed.split(/\s+/);
  const lower = first.toLowerCase();

  if (lower === "done" || lower === "completed") {
    return {
      query: rest.join(" ").trim(),
      kinds: ["task"],
      label: "done tasks",
      includeDone: true,
      doneOnly: true
    };
  }

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

export async function semanticSearch(
  userId: string,
  query: string,
  kinds?: SearchKind[],
  options: { includeDone?: boolean; doneOnly?: boolean; limit?: number } = {}
): Promise<SearchResult[]> {
  const queryEmbedding = deterministicEmbedding(query);
  const shouldSearch = (kind: SearchKind) => !kinds || kinds.includes(kind);
  const [ideas, tasks, notes] = await Promise.all([
    shouldSearch("idea") ? prisma.idea.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    shouldSearch("task")
      ? prisma.task.findMany({
          where: {
            userId,
            archivedAt: null,
            status: options.doneOnly ? TaskStatus.DONE : options.includeDone ? undefined : TaskStatus.OPEN
          },
          orderBy: { createdAt: "desc" },
          take: 100
        })
      : [],
    shouldSearch("note") ? prisma.note.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }) : []
  ]);

  const results: SearchResult[] = [
    ...ideas.map((idea) => ({
      kind: "idea" as const,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      score: scoreResult(query, queryEmbedding, idea.publicId, [idea.title, idea.concept, idea.sourceText])
    })),
    ...tasks.map((task) => ({
      kind: "task" as const,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      score: scoreResult(query, queryEmbedding, task.publicId, [task.title, task.description ?? "", task.sourceText])
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      publicId: note.publicId,
      title: note.title,
      summary: note.summary,
      score: scoreResult(query, queryEmbedding, note.publicId, [note.title, note.summary, note.body, note.sourceText])
    }))
  ];

  return results
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 50);
}

export async function createPendingSearch(userId: string, parsed: ParsedSearchRequest) {
  return prisma.pendingSearch.create({
    data: {
      userId,
      query: parsed.query,
      kinds: parsed.kinds ?? [],
      label: parsed.label,
      includeDone: Boolean(parsed.includeDone),
      doneOnly: Boolean(parsed.doneOnly),
      expiresAt: new Date(Date.now() + SEARCH_TTL_MS)
    }
  });
}

export async function findPendingSearch(userId: string, pendingId: string): Promise<ParsedSearchRequest> {
  const pending = await prisma.pendingSearch.findFirstOrThrow({
    where: {
      id: pendingId,
      userId,
      expiresAt: { gt: new Date() }
    }
  });

  return {
    query: pending.query,
    kinds: pending.kinds.length ? pending.kinds as SearchKind[] : undefined,
    label: pending.label ?? undefined,
    includeDone: pending.includeDone,
    doneOnly: pending.doneOnly
  };
}

/**
 * Scores one item against the query. The word-hash vector is rebuilt from the
 * item text on every search (it is cheap), so edits never leave an item with a
 * stale or missing stored vector.
 */
function scoreResult(query: string, queryEmbedding: number[], publicId: string, textFields: string[]): number {
  const semantic = cosineSimilarity(queryEmbedding, deterministicEmbedding(textFields.join("\n")));
  const lexical = lexicalScore(query, [publicId, ...textFields]);
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
