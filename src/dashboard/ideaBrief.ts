/**
 * Reads the AI-generated idea brief stored as JSON on an Idea row (idea.scores).
 * Used by data.ts when building idea responses for the dashboard.
 */
import type { IdeaScore } from "../ai/types";

/**
 * Returns the stored brief only if every field has the expected shape (scores 0 to 10, string lists).
 * The column is untyped JSON, so anything malformed or from an older format is dropped instead of sent.
 */
export function storedIdeaBrief(value: unknown): IdeaScore | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const score = value as Record<string, unknown>;
  const metrics = ["buildability", "usefulness", "novelty", "portfolioValue", "monetization", "difficulty", "risk"] as const;
  if (metrics.some((key) => typeof score[key] !== "number" || !Number.isFinite(score[key]) || Number(score[key]) < 0 || Number(score[key]) > 10)) return undefined;
  if (typeof score.summary !== "string" || typeof score.marketNotes !== "string") return undefined;
  if (!Array.isArray(score.dos) || !score.dos.every((item) => typeof item === "string")) return undefined;
  if (!Array.isArray(score.donts) || !score.donts.every((item) => typeof item === "string")) return undefined;
  return score as IdeaScore;
}
