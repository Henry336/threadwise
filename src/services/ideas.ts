import { prisma } from "../db/prisma";
import type { AiProvider, IdeaScore } from "../ai/types";
import { bold, code, h } from "../utils/html";
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

export async function createImplementationBrief(userId: string, publicOrUuid: string): Promise<{ publicId: string; prompt: string }> {
  const idea = await prisma.idea.findFirstOrThrow({
    where: {
      userId,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });

  const scores = asRecord(idea.scores);
  const scoreLines = scores
    ? [
        `- Buildability: ${scores.buildability ?? "unknown"}/10`,
        `- Usefulness: ${scores.usefulness ?? "unknown"}/10`,
        `- Novelty: ${scores.novelty ?? "unknown"}/10`,
        `- Portfolio value: ${scores.portfolioValue ?? "unknown"}/10`,
        `- Monetization: ${scores.monetization ?? "unknown"}/10`,
        `- Difficulty: ${scores.difficulty ?? "unknown"}/10`,
        `- Risk: ${scores.risk ?? "unknown"}/10`
      ].join("\n")
    : "- Not scored yet. If helpful, ask me to infer sensible priorities from the idea text.";

  const prompt = [
    `You are a senior software engineer implementing ${idea.publicId}: ${idea.title}.`,
    "",
    "Goal:",
    idea.concept,
    "",
    "Original idea text:",
    idea.sourceText,
    "",
    "Known context:",
    `- Problem: ${idea.problem ?? "Not specified; infer from the idea and ask only if blocking."}`,
    `- Target user: ${idea.targetUser ?? "Not specified; infer a practical first user."}`,
    `- Type: ${idea.type ?? "Not specified"}`,
    `- Tags: ${idea.tags.length ? idea.tags.join(", ") : "none"}`,
    "",
    "Idea score context:",
    scoreLines,
    idea.marketNotes ? ["", "Market / competition notes:", idea.marketNotes].join("\n") : undefined,
    idea.dos.length ? ["", "Do:", ...idea.dos.map((item) => `- ${item}`)].join("\n") : undefined,
    idea.donts.length ? ["", "Do not:", ...idea.donts.map((item) => `- ${item}`)].join("\n") : undefined,
    "",
    "Implementation request:",
    "- Inspect the existing repository before editing.",
    "- Propose a concise plan, then implement the feature end to end.",
    "- Keep the code readable for future collaborators.",
    "- Follow existing architecture, naming, formatting, and test patterns.",
    "- Add or update tests for the important behavior.",
    "- Update docs or README if user-facing behavior changes.",
    "- Avoid unrelated refactors.",
    "- Do not commit secrets, local .env files, generated credentials, or private tokens.",
    "- Run the relevant validation commands and report the results.",
    "",
    "Expected final response:",
    "- Summarize what changed.",
    "- List validation performed.",
    "- Call out any manual setup or unresolved risk.",
    "",
    "If the repo/location is missing, ask me for the target repository before implementing."
  ]
    .filter(Boolean)
    .join("\n");

  return { publicId: idea.publicId, prompt };
}

export function formatIdeaCreated(idea: { publicId: string; title: string; concept: string; tags: string[] }): string {
  return [
    `${bold("Saved")} ${code(idea.publicId)} ${h(idea.title)}`,
    "",
    h(idea.concept),
    idea.tags.length ? `${bold("Tags")} ${h(idea.tags.join(", "))}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
