import { DateTime } from "luxon";
import type { IdeaScore } from "../ai/types";
import type { SearchResult } from "../services/search";
import type { TaskListItem } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { truncate } from "../utils/text";

export function formatOpenTasks(
  tasks: TaskListItem[],
  fallbackTimezone = "UTC"
): string {
  if (tasks.length === 0) {
    return "No open tasks. Nice and quiet.";
  }

  const numbered = tasks.map((task, index) => ({ task, number: index + 1 }));
  const groups = [
    { title: "Overdue", items: numbered.filter(({ task }) => task.dueAt && dueBucket(task.dueAt, task.timezone ?? fallbackTimezone) === "overdue") },
    { title: "Today", items: numbered.filter(({ task }) => task.dueAt && dueBucket(task.dueAt, task.timezone ?? fallbackTimezone) === "today") },
    { title: "Later", items: numbered.filter(({ task }) => task.dueAt && dueBucket(task.dueAt, task.timezone ?? fallbackTimezone) === "later") },
    { title: "No due date", items: numbered.filter(({ task }) => !task.dueAt) }
  ].filter((group) => group.items.length > 0);

  return [
    "Open tasks",
    "",
    ...groups.flatMap((group) => [
      group.title,
      ...group.items.map(({ task, number }) => formatTaskListItem(task, number, fallbackTimezone)),
      ""
    ]),
    "Use /done 1, /snooze 1 1h, /task 1, or /cancel 1."
  ].join("\n");
}

export function formatTaskDetail(task: TaskListItem, fallbackTimezone = "UTC"): string {
  const timezone = task.timezone ?? fallbackTimezone;
  return [
    `${task.publicId}: ${task.title}`,
    "",
    task.description ? task.description : undefined,
    `Status: ${task.status.toLowerCase()}`,
    task.dueAt ? `Due: ${formatDateTimeForUser(task.dueAt, timezone)}` : "Due: none",
    `Reminders sent: ${task.reminderCount}`,
    task.calendarUrl ? `Calendar: ${task.calendarUrl}` : undefined,
    "",
    `Captured: ${truncate(task.sourceText, 500)}`
  ]
    .filter(Boolean)
    .join("\n");
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

function formatTaskListItem(task: TaskListItem, number: number, fallbackTimezone: string): string {
  const timezone = task.timezone ?? fallbackTimezone;
  const lines = [`${number}. ${task.title}`, `   ID: ${task.publicId}`];

  if (task.dueAt) {
    lines.push(`   Due: ${formatDateTimeForUser(task.dueAt, timezone)}`);
  }

  if (task.reminderCount > 0) {
    lines.push(`   Reminders sent: ${task.reminderCount}`);
  }

  return lines.join("\n");
}

function dueBucket(dueAt: Date, timezone: string): "overdue" | "today" | "later" {
  const now = DateTime.now().setZone(timezone);
  const due = DateTime.fromJSDate(dueAt).setZone(timezone);

  if (due < now) {
    return "overdue";
  }

  if (due.hasSame(now, "day")) {
    return "today";
  }

  return "later";
}
