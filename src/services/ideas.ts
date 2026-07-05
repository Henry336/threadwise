import { prisma } from "../db/prisma";
import type { AiProvider, IdeaScore } from "../ai/types";
import { bold, code, h } from "../utils/html";
import { truncate } from "../utils/text";
import { nextPublicId } from "./publicIds";
import { recordCreateUndo, recordRenameUndo } from "./undo";

export async function createIdea(userId: string, sourceText: string, ai: AiProvider) {
  const structured = await ai.structureIdea(sourceText);
  const embedding = await ai.embed(`${structured.title}\n${structured.concept}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "IDEA");

  return prisma.$transaction(async (tx) => {
    const idea = await tx.idea.create({
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
    await recordCreateUndo(tx, userId, { kind: "idea", id: idea.id, publicId: idea.publicId, title: idea.title });
    return idea;
  });
}

export async function listRecentIdeas(userId: string, take = 15) {
  const ideas = await prisma.idea.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take
  });

  return sortPinnedFirst(ideas);
}

export async function findIdea(userId: string, publicOrUuid: string) {
  return prisma.idea.findFirstOrThrow({
    where: {
      userId,
      archivedAt: null,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });
}

export async function findIdeaReference(userId: string, reference: string) {
  const normalized = reference.trim();
  const activeIndex = Number(normalized);
  if (Number.isInteger(activeIndex) && activeIndex > 0) {
    const ideas = await listRecentIdeas(userId);
    const idea = ideas[activeIndex - 1];
    if (!idea) {
      throw new Error(`No recent idea numbered ${activeIndex}. Run /ideas to see the current list.`);
    }
    return idea;
  }

  return findIdea(userId, normalized);
}

export async function renameIdeaTitle(userId: string, publicOrUuid: string, title: string) {
  const idea = await findIdea(userId, publicOrUuid);
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new Error("Idea title cannot be empty.");
  }

  return prisma.$transaction(async (tx) => {
    await recordRenameUndo(tx, userId, { kind: "idea", id: idea.id, publicId: idea.publicId, title: nextTitle }, idea.title);
    return tx.idea.update({
      where: { id: idea.id },
      data: { title: nextTitle }
    });
  });
}

export async function scoreIdea(userId: string, publicOrUuid: string, ai: AiProvider): Promise<{ publicId: string; score: IdeaScore }> {
  const idea = await findIdea(userId, publicOrUuid);

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
  const idea = await findIdea(userId, publicOrUuid);

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
    `${bold("Saved idea")} ${code(idea.publicId)} ${h(idea.title)}`,
    "",
    h(idea.concept),
    idea.tags.length ? `${bold("Tags")} ${h(idea.tags.join(", "))}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRecentIdeas(ideas: Array<{ publicId: string; title: string; concept: string; tags: string[]; pinnedAt?: Date | null }>): string {
  if (ideas.length === 0) {
    return "No saved ideas yet. Send /idea when something starts to sparkle.";
  }

  return [
    bold("Recent ideas"),
    "",
    ...ideas.map((idea, index) => {
      const tags = idea.tags.length ? `\n${bold("Tags")} ${h(idea.tags.join(", "))}` : "";
      const pin = idea.pinnedAt ? `${bold("Pinned")} ` : "";
      return `${index + 1}. ${pin}${code(idea.publicId)} ${bold(idea.title)}\n${h(truncate(idea.concept, 220))}${tags}`;
    })
  ].join("\n\n");
}

export function formatIdeaDetail(idea: {
  publicId: string;
  title: string;
  concept: string;
  problem?: string | null;
  targetUser?: string | null;
  type?: string | null;
  tags: string[];
  pinnedAt?: Date | null;
  createdAt: Date;
}): string {
  return [
    `${code(idea.publicId)} ${bold(idea.title)}`,
    "",
    h(idea.concept),
    idea.problem ? `${bold("Problem")} ${h(idea.problem)}` : undefined,
    idea.targetUser ? `${bold("Target user")} ${h(idea.targetUser)}` : undefined,
    idea.type ? `${bold("Type")} ${h(idea.type)}` : undefined,
    idea.tags.length ? `${bold("Tags")} ${h(idea.tags.join(", "))}` : undefined,
    idea.pinnedAt ? `${bold("Pinned")} yes` : undefined,
    `${bold("Saved")} ${h(idea.createdAt.toLocaleString())}`
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
