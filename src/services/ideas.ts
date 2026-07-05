import { prisma } from "../db/prisma";
import type { AiProvider, IdeaScore } from "../ai/types";
import { nextPublicId } from "./publicIds";

export async function createIdea(userId: string, sourceText: string, ai: AiProvider) {
  const structured = await ai.structureIdea(sourceText);
  const embedding = await ai.embed(`${structured.title}\n${structured.concept}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "IDEA");

  return prisma.idea.create({
    data: {
      userId,
      publicId,
      title: structured.title,
      concept: structured.concept,
      problem: structured.problem,
      targetUser: structured.targetUser,
      type: structured.type,
      tags: structured.tags,
      sourceText,
      embedding
    }
  });
}

export async function scoreIdea(userId: string, publicOrUuid: string, ai: AiProvider): Promise<{ publicId: string; score: IdeaScore }> {
  const idea = await prisma.idea.findFirstOrThrow({
    where: {
      userId,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });

  const score = await ai.scoreIdea({
    title: idea.title,
    concept: idea.concept,
    problem: idea.problem ?? undefined,
    targetUser: idea.targetUser ?? undefined,
    type: idea.type ?? undefined,
    tags: idea.tags,
    sourceText: idea.sourceText
  });

  await prisma.idea.update({
    where: { id: idea.id },
    data: {
      scores: score,
      marketNotes: score.marketNotes,
      dos: score.dos,
      donts: score.donts
    }
  });

  return { publicId: idea.publicId, score };
}

export function formatIdeaCreated(idea: { publicId: string; title: string; concept: string; tags: string[] }): string {
  return [
    `Saved ${idea.publicId}: ${idea.title}`,
    "",
    idea.concept,
    idea.tags.length ? `Tags: ${idea.tags.join(", ")}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

