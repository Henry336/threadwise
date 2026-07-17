import type { IdeaScore } from "../ai/types";

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
