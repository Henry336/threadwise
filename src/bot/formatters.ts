import { DateTime } from "luxon";
import type { IdeaScore } from "../ai/types";
import type { SearchResult } from "../services/search";
import { formatAssigneeHtml, formatRecurrence, hasAssignees, type TaskListItem } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, code, h, italic } from "../utils/html";
import { joinBlocks } from "../utils/messageFormat";
import { truncate } from "../utils/text";
import type { ListPageInfo } from "../services/listPagination";

export function formatOpenTasks(
  tasks: TaskListItem[],
  fallbackTimezone = "UTC",
  page?: ListPageInfo
): string {
  if (tasks.length === 0) {
    return "Nothing needs doing right now. Nice and quiet.";
  }

  return [
    page && page.totalPages > 1 ? `${bold("📋 Tasks")} · ${page.page}/${page.totalPages}` : bold("📋 Tasks"),
    "",
    ...tasks.map((task, index) => formatTaskListItem(task, (page?.offset ?? 0) + index + 1, fallbackTimezone)),
    "",
    italic("Tap a number to open it.")
  ].join("\n\n");
}

export type ReminderSettingsView = {
  reminderIntervalMinutes: number;
  maxRemindersPerDay: number;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

export function formatTaskDetail(task: TaskListItem, fallbackTimezone = "UTC", settings?: ReminderSettingsView): string {
  const timezone = task.timezone ?? fallbackTimezone;
  void settings;
  const description = withoutRepeatedTitle(task.title, task.description || task.sourceText);
  const metadata = [
    task.status === "DONE" ? "✅ Completed" : task.status === "CANCELED" ? "🗑 Cancelled" : undefined,
    task.dueAt ? `⏰ ${h(formatDateTimeForUser(task.dueAt, timezone))}` : "○ No due date",
    task.recurrenceRule ? `↻ ${h(formatRecurrence(task.recurrenceRule))}` : undefined,
    hasAssignees(task) ? `👤 ${formatAssigneeHtml(task)}` : undefined,
    task.calendarEventId ? "☁️ In Google Calendar" : undefined,
    task.pinnedAt ? "⭐ Important" : undefined
  ].filter(Boolean).join("\n");

  return joinBlocks([
    bold("📋 Task"),
    bold(task.title),
    description ? h(truncate(description, 700)) : undefined,
    metadata
  ]);
}

export function formatSearchResults(results: SearchResult[], label?: string): string {
  if (results.length === 0) {
    return label ? `Nothing close in ${label} yet—try another phrase.` : "Nothing close yet—try another phrase.";
  }

  return [
    bold(label ? `🔎 Search results: ${label}` : "🔎 Search results"),
    "",
    ...results.map((result) => {
      const percent = Math.round(result.score * 100);
      return `${code(result.publicId)} ${bold(result.title)}\n${italic(`${result.kind}, ${percent}% match`)}\n${h(truncate(result.summary, 160))}`;
    })
  ].join("\n\n");
}

export function formatSearchResultsPage(results: SearchResult[], page: number, pageSize: number, label?: string): string {
  if (results.length === 0) {
    return label ? `Nothing close in ${label} yet—try another phrase.` : "Nothing close yet—try another phrase.";
  }

  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const visible = results.slice(start, start + pageSize);

  return [
    bold(label ? `🔎 Search results: ${label}` : "🔎 Search results"),
    totalPages > 1 ? italic(`Page ${currentPage}/${totalPages}`) : undefined,
    "",
    ...visible.map((result) => {
      const percent = Math.round(result.score * 100);
      return `${code(result.publicId)} ${bold(result.title)}\n${italic(`${result.kind}, ${percent}% match`)}\n${h(truncate(result.summary, 160))}`;
    })
  ].filter(Boolean).join("\n\n");
}

export function formatIdeaScore(publicId: string, score: IdeaScore): string {
  return [
    `${bold("✨ Idea brief")} · ${code(publicId)}`,
    "",
    h(score.summary),
    "",
    `${bold("Strength")} usefulness ${score.usefulness}/10 · buildability ${score.buildability}/10 · novelty ${score.novelty}/10`,
    `${bold("Potential")} portfolio ${score.portfolioValue}/10 · monetization ${score.monetization}/10`,
    `${bold("Trade-offs")} difficulty ${score.difficulty}/10 · risk ${score.risk}/10`,
    "",
    `${bold("Market read")}`,
    h(score.marketNotes),
    "",
    `${bold("Do next")} ${h(score.dos.join(" · ") || "Validate the smallest useful version.")}`,
    `${bold("Avoid")} ${h(score.donts.join(" · ") || "Expanding the scope before validation.")}`,
    "",
    "AI assessment from the saved idea—not live market research."
  ].join("\n");
}

function formatTaskListItem(task: TaskListItem, number: number, fallbackTimezone: string): string {
  const timezone = task.timezone ?? fallbackTimezone;
  const marker = task.pinnedAt ? "⭐" : task.dueAt && dueBucket(task.dueAt, timezone) === "overdue" ? "⚠️" : "·";
  const context = [
    task.dueAt ? formatCompactDue(task.dueAt, timezone) : "No due date",
    task.recurrenceRule ? `↻ ${formatRecurrence(task.recurrenceRule)}` : undefined,
    hasAssignees(task) ? `👤 ${formatAssigneeHtml(task)}` : undefined
  ].filter(Boolean).join(" · ");
  return `${number} ${marker} ${bold(truncate(task.title, 72))}\n${context}`;
}

function formatCompactDue(dueAt: Date, timezone: string): string {
  const due = DateTime.fromJSDate(dueAt).setZone(timezone);
  const bucket = dueBucket(dueAt, timezone);
  if (bucket === "overdue") return `Overdue · ${due.toFormat("d LLL, h:mm a")}`;
  if (bucket === "today") return `Today · ${due.toFormat("h:mm a")}`;
  const tomorrow = DateTime.now().setZone(timezone).plus({ days: 1 });
  if (due.hasSame(tomorrow, "day")) return `Tomorrow · ${due.toFormat("h:mm a")}`;
  return due.toFormat("d LLL · h:mm a");
}

function withoutRepeatedTitle(title: string, body?: string | null): string | undefined {
  if (!body?.trim()) return undefined;
  const clean = body.trim();
  const normalizedTitle = title.trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedBody = clean.replace(/\s+/g, " ").toLowerCase();
  if (normalizedBody === normalizedTitle) return undefined;
  if (normalizedBody.startsWith(normalizedTitle)) {
    const remainder = clean.slice(title.trim().length).replace(/^[\s:–—|,.\-]+/, "").trim();
    return remainder || undefined;
  }
  return clean;
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
