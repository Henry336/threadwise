import { DateTime } from "luxon";
import type { IdeaScore } from "../ai/types";
import type { SearchResult } from "../services/search";
import { formatAssigneeHtml, formatRecurrence, hasAssignees, type TaskListItem } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, code, h, italic } from "../utils/html";
import { field, fieldHtml, joinBlocks } from "../utils/messageFormat";
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

  const numbered = tasks.map((task, index) => ({ task, number: (page?.offset ?? 0) + index + 1 }));
  const groups = [
    { title: "⭐ Important", items: numbered.filter(({ task }) => task.pinnedAt) },
    { title: "⚠️ Overdue", items: numbered.filter(({ task }) => !task.pinnedAt && task.dueAt && dueBucket(task.dueAt, task.timezone ?? fallbackTimezone) === "overdue") },
    { title: "📅 Today", items: numbered.filter(({ task }) => !task.pinnedAt && task.dueAt && dueBucket(task.dueAt, task.timezone ?? fallbackTimezone) === "today") },
    { title: "🗓️ Later", items: numbered.filter(({ task }) => !task.pinnedAt && task.dueAt && dueBucket(task.dueAt, task.timezone ?? fallbackTimezone) === "later") },
    { title: "○ No due date", items: numbered.filter(({ task }) => !task.pinnedAt && !task.dueAt) }
  ].filter((group) => group.items.length > 0);

  return [
    page && page.totalPages > 1 ? `${bold("📋 Open tasks")} · Page ${page.page}/${page.totalPages}` : bold("📋 Open tasks"),
    "",
    ...groups.flatMap((group) => [
      bold(group.title),
      ...group.items.map(({ task, number }) => formatTaskListItem(task, number, fallbackTimezone)),
      ""
    ]),
    `${italic("Use")} ${code("/done 1")}, ${code("/snooze 1 1h")}, ${code("/task 1")}, ${code("/pin 1")}, ${italic("or")} ${code("/cancel 1")}.`
  ].join("\n");
}

export type ReminderSettingsView = {
  reminderIntervalMinutes: number;
  maxRemindersPerDay: number;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

export function formatTaskDetail(task: TaskListItem, fallbackTimezone = "UTC", settings?: ReminderSettingsView): string {
  const timezone = task.timezone ?? fallbackTimezone;
  const metadata = [
    fieldHtml("Task ID", code(task.publicId)),
    field("Status", task.status.toLowerCase()),
    field("Due Date", task.dueAt ? formatDateTimeForUser(task.dueAt, timezone) : "None"),
    field("Next Reminder", task.nextReminderAt ? formatDateTimeForUser(task.nextReminderAt, timezone) : "None"),
    hasAssignees(task) ? fieldHtml("Assigned To", formatAssigneeHtml(task)) : undefined,
    task.recurrenceRule ? field("Repeats", formatRecurrence(task.recurrenceRule)) : undefined,
    task.calendarEventId ? field("Google Calendar", task.calendarSyncedAt ? `Synced ${formatDateTimeForUser(task.calendarSyncedAt, timezone)}` : "Synced") : undefined,
    task.pinnedAt ? field("Important", "Yes") : undefined,
    field("Reminders Sent", task.reminderCount)
  ].filter(Boolean).join("\n");

  const reminderSettings = settings
    ? [
        field("Current Interval", `${settings.reminderIntervalMinutes} minutes`),
        task.reminderIntervalMinutes && task.reminderIntervalMinutes !== settings.reminderIntervalMinutes
          ? field("Stored Task Interval", `${task.reminderIntervalMinutes} minutes`)
          : undefined,
        field("Daily Reminder Safety Limit", `${settings.maxRemindersPerDay} reminders/day`),
        field("Quiet Hours", settings.quietHoursStart && settings.quietHoursEnd ? `${settings.quietHoursStart}-${settings.quietHoursEnd}` : "off"),
        settings.reminderIntervalMinutes <= 30 && settings.maxRemindersPerDay <= 10
          ? field("Safety Limit Note", `At this interval, the daily safety limit covers about ${Math.round(((settings.reminderIntervalMinutes * settings.maxRemindersPerDay) / 60) * 10) / 10} hours.`)
          : undefined
      ].filter(Boolean).join("\n")
    : undefined;

  return joinBlocks([
    task.pinnedAt ? bold("Important task") : undefined,
    bold(task.title),
    task.description ? h(task.description) : undefined,
    metadata,
    reminderSettings ? [bold("Reminder Settings"), reminderSettings].join("\n") : undefined,
    [bold("Captured Text"), h(truncate(task.sourceText, 500))].join("\n")
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
    `${code(publicId)} ${bold("score")}`,
    "",
    `${bold("Buildability")} ${score.buildability}/10`,
    `${bold("Usefulness")} ${score.usefulness}/10`,
    `${bold("Novelty")} ${score.novelty}/10`,
    `${bold("Portfolio value")} ${score.portfolioValue}/10`,
    `${bold("Monetization")} ${score.monetization}/10`,
    `${bold("Difficulty")} ${score.difficulty}/10`,
    `${bold("Risk")} ${score.risk}/10`,
    "",
    h(score.summary),
    "",
    `${bold("Market notes")} ${h(score.marketNotes)}`,
    "",
    `${bold("Do")} ${h(score.dos.join("; ") || "None listed.")}`,
    `${bold("Don't")} ${h(score.donts.join("; ") || "None listed.")}`
  ].join("\n");
}

function formatTaskListItem(task: TaskListItem, number: number, fallbackTimezone: string): string {
  const timezone = task.timezone ?? fallbackTimezone;
  const title = task.pinnedAt ? `${task.title} (important)` : task.title;
  const lines = [`${number}. ${bold(title)}`, `   ${fieldHtml("Task ID", code(task.publicId))}`];

  if (task.pinnedAt) {
    lines.push(`   ${bold("Important")} ${italic("starred task")}`);
  }

  if (task.dueAt) {
    lines.push(`   ${field("Due Date", formatDateTimeForUser(task.dueAt, timezone))}`);
  }

  if (hasAssignees(task)) {
    lines.push(`   ${fieldHtml("Assigned To", formatAssigneeHtml(task))}`);
  }

  if (task.recurrenceRule) {
    lines.push(`   ${field("Repeats", formatRecurrence(task.recurrenceRule))}`);
  }

  if (task.reminderCount > 0) {
    lines.push(`   ${field("Reminders Sent", task.reminderCount)}`);
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
