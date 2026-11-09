/**
 * Idea records: create, list, find, rename, edit, archive, score, and turn into a coding brief.
 * Used by the /ideas, /score and /brief commands, idea callbacks and cards in src/bot, and the
 * dashboard routes. Every write that the user can reverse also records an undo audit entry.
 * The AI provider structures and scores ideas; the deterministic provider handles it when no API key is set.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { completeSearchableContentUpdate } from "../security/contentEncryption";
import type { AiProvider, IdeaScore } from "../ai/types";
import { bold, code, h, italic } from "../utils/html";
import { truncate } from "../utils/text";
import { createWithPublicId } from "./publicIds";
import { recordArchiveUndo, recordCreateUndo, recordFieldEditUndo, recordRenameUndo } from "./undo";
import { fieldHtml, joinBlocks } from "../utils/messageFormat";
import type { ListPageInfo } from "./listPagination";

/**
 * Saves a new idea after the AI adapter splits the text into title, concept, problem, and so on.
 * The public ID (IDEA-n) and the create-undo entry are written in the same transaction.
 */
export async function createIdea(userId: string, sourceText: string, ai: AiProvider) {
  const structured = await ai.structureIdea(sourceText);

  return createWithPublicId(userId, "IDEA", async (tx, publicId) => {
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
        sourceText
      }
    });
    await recordCreateUndo(tx, userId, { kind: "idea", id: idea.id, publicId: idea.publicId, title: idea.title });
    return idea;
  });
}

// Starred items first (newest star first), then the rest newest first. Sorting in the
// query keeps an old starred item from falling off a list cut short by `take`.
const PINNED_FIRST = [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] satisfies Prisma.IdeaOrderByWithRelationInput[];

export async function listRecentIdeas(userId: string, take?: number) {
  return prisma.idea.findMany({
    where: { userId, archivedAt: null },
    orderBy: PINNED_FIRST,
    take
  });
}

/** Finds an active idea by database id or public ID, always within the user's own data. Throws if missing. */
export async function findIdea(userId: string, publicOrUuid: string) {
  return prisma.idea.findFirstOrThrow({
    where: {
      userId,
      archivedAt: null,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });
}

/**
 * Resolves what a user typed: a plain number means "the Nth row of /ideas" (same starred-first order),
 * anything else is treated as an id or public ID.
 */
export async function findIdeaReference(userId: string, reference: string) {
  const normalized = reference.trim();
  const activeIndex = Number(normalized);
  if (Number.isInteger(activeIndex) && activeIndex > 0) {
    // Fetch only the row at that position of the /ideas list, not the whole list.
    const idea = await prisma.idea.findFirst({
      where: { userId, archivedAt: null },
      orderBy: PINNED_FIRST,
      skip: activeIndex - 1
    });
    if (!idea) {
      throw new Error(`No recent idea numbered ${activeIndex}. Run /ideas to see the current list.`);
    }
    return idea;
  }

  return findIdea(userId, normalized);
}

/** Hides an idea with archivedReason "removed" (no hard delete) and records an undo entry in the same transaction. */
export async function archiveIdea(userId: string, reference: string) {
  const idea = await findIdeaReference(userId, reference);
  const archivedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await recordArchiveUndo(tx, userId, {
      kind: "idea",
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      archivedAt: idea.archivedAt,
      archivedReason: idea.archivedReason
    });
    return tx.idea.update({
      where: { id: idea.id },
      data: { archivedAt, archivedReason: "removed" }
    });
  });
}

/**
 * Changes an idea's title and records the old one for Undo.
 * completeSearchableContentUpdate sends every searchable field so the encrypted search tokens
 * are rebuilt from the whole record, not just the changed field.
 */
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
      data: completeSearchableContentUpdate("Idea", idea, { title: nextTitle })
    });
  });
}

/** Replaces the idea's concept (and source text) and records the previous concept for Undo. */
export async function updateIdeaConcept(userId: string, publicOrUuid: string, concept: string) {
  const idea = await findIdea(userId, publicOrUuid);
  const nextConcept = concept.trim();
  if (!nextConcept) {
    throw new Error("Idea concept cannot be empty.");
  }

  return prisma.$transaction(async (tx) => {
    await recordFieldEditUndo(tx, userId, { kind: "idea", id: idea.id, publicId: idea.publicId, title: idea.title }, "concept", idea.concept);
    return tx.idea.update({
      where: { id: idea.id },
      data: completeSearchableContentUpdate("Idea", idea, {
        concept: nextConcept,
        sourceText: nextConcept
      })
    });
  });
}

/** Asks the AI adapter to score an idea and stores the scores and do/don't notes on the row. Not undoable. */
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
    data: completeSearchableContentUpdate("Idea", idea, {
      scores: score,
      marketNotes: score.marketNotes,
      dos: score.dos,
      donts: score.donts
    })
  });

  return { publicId: idea.publicId, score };
}

/**
 * Builds a copy-paste prompt for a coding assistant from the idea and its scores (the /brief command).
 * Pure text building from stored data; no AI call and no writes.
 */
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

export function formatIdeaCreated(idea: { publicId: string; title: string; concept: string }): string {
  return joinBlocks([
    bold("✅ Idea saved"),
    [bold(idea.title), h(idea.concept)].join("\n"),
    fieldHtml("Idea ID", code(idea.publicId))
  ]);
}

export function formatIdeaSavedAcknowledgement(idea: { title: string }): string {
  return `${bold("Idea saved")} · ${h(idea.title)}`;
}

/** Renders the /ideas list. Row numbers continue across pages so they match findIdeaReference. */
export function formatRecentIdeas(ideas: Array<{ publicId: string; title: string; concept: string; pinnedAt?: Date | null }>, page?: ListPageInfo): string {
  if (ideas.length === 0) {
    return "No ideas saved yet—send one over when something starts to take shape.";
  }

  return [
    page && page.totalPages > 1 ? `${bold("💡 Ideas")} · ${page.page}/${page.totalPages}` : bold("💡 Ideas"),
    "",
    ...ideas.map((idea, index) => {
      const pin = idea.pinnedAt ? "⭐ " : "";
      return `${(page?.offset ?? 0) + index + 1} · ${pin}${bold(truncate(idea.title, 72))}\n${h(truncate(idea.concept, 110))}`;
    }),
    "",
    italic("Tap a number to open it.")
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
}, timezone = "UTC"): string {
  void timezone;
  const metadata = [
    idea.type ? `◦ ${h(idea.type)}` : undefined,
    idea.pinnedAt ? "⭐ Starred" : undefined
  ].filter(Boolean).join("\n");

  return joinBlocks([
    bold("💡 Idea"),
    bold(idea.title),
    h(idea.concept),
    idea.problem ? [bold("Problem"), h(idea.problem)].join("\n") : undefined,
    idea.targetUser ? [bold("Target User"), h(idea.targetUser)].join("\n") : undefined,
    metadata
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
