import type { IdeaScore } from "../ai/types";
import type { SearchResult } from "../services/search";
import { formatDateTimeForUser } from "../utils/dates";
import { truncate } from "../utils/text";

export function formatOpenTasks(
  tasks: Array<{ publicId: string; title: string; dueAt?: Date | null; timezone?: string | null; reminderCount: number }>,
  fallbackTimezone = "UTC"
): string {
  if (tasks.length === 0) {
    return "No open tasks. Nice and quiet.";
  }

  return [
    "Open tasks",
    "",
    ...tasks.map((task) => {
      const due = task.dueAt ? ` due ${formatDateTimeForUser(task.dueAt, task.timezone ?? fallbackTimezone)}` : "";
      const count = task.reminderCount > 0 ? ` (${task.reminderCount} reminders sent)` : "";
      return `${task.publicId}: ${task.title}${due}${count}`;
    })
  ].join("\n");
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No close matches yet.";
  }

  return [
    "Search results",
    "",
    ...results.map((result) => {
      const percent = Math.round(result.score * 100);
      return `${result.publicId} [${result.kind}, ${percent}%]: ${result.title}\n${truncate(result.summary, 160)}`;
    })
  ].join("\n\n");
}

export function formatIdeaScore(publicId: string, score: IdeaScore): string {
  return [
    `${publicId} score`,
    "",
    `Buildability: ${score.buildability}/10`,
    `Usefulness: ${score.usefulness}/10`,
    `Novelty: ${score.novelty}/10`,
    `Portfolio value: ${score.portfolioValue}/10`,
    `Monetization: ${score.monetization}/10`,
    `Difficulty: ${score.difficulty}/10`,
    `Risk: ${score.risk}/10`,
    "",
    score.summary,
    "",
    `Market notes: ${score.marketNotes}`,
    "",
    `Do: ${score.dos.join("; ") || "None listed."}`,
    `Don't: ${score.donts.join("; ") || "None listed."}`
  ].join("\n");
}
