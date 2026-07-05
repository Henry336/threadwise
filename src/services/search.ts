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

export async function semanticSearch(userId: string, query: string, ai: AiProvider): Promise<SearchResult[]> {
  const queryEmbedding = await ai.embed(query);
  const [ideas, tasks, notes, reflections] = await Promise.all([
    prisma.idea.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.task.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.note.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.reflection.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 })
  ]);

  const results: SearchResult[] = [
    ...ideas.map((idea) => ({
      kind: "idea" as const,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      score: cosineSimilarity(queryEmbedding, asVector(idea.embedding))
    })),
    ...tasks.map((task) => ({
      kind: "task" as const,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      score: cosineSimilarity(queryEmbedding, asVector(task.embedding))
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      publicId: note.publicId,
      title: note.title,
      summary: note.summary,
      score: cosineSimilarity(queryEmbedding, asVector(note.embedding))
    })),
    ...reflections.map((reflection) => ({
      kind: "reflection" as const,
      publicId: reflection.publicId,
      title: reflection.situation.slice(0, 80),
      summary: reflection.immediateAction,
      score: cosineSimilarity(queryEmbedding, asVector(reflection.embedding))
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
