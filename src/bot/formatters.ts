import { DateTime } from "luxon";
import type { IdeaScore } from "../ai/types";
import type { SearchResult } from "../services/search";
import type { TaskListItem } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { truncate } from "../utils/text";
import { bold, code, h, italic } from "../utils/html";

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
    bold("Open tasks"),
    "",
    ...groups.flatMap((group) => [
      bold(group.title),
      ...group.items.map(({ task, number }) => formatTaskListItem(task, number, fallbackTimezone)),
      ""
    ]),
    `${italic("Use")} ${code("/done 1")}, ${code("/snooze 1 1h")}, ${code("/task 1")}, ${italic("or")} ${code("/cancel 1")}.`
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
  return [
    `${code(task.publicId)} ${bold(task.title)}`,
    "",
    task.description ? h(task.description) : undefined,
    `${bold("Status")} ${h(task.status.toLowerCase())}`,
    task.dueAt ? `${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, timezone))}` : `${bold("Due")} none`,
    task.nextReminderAt ? `${bold("Next reminder")} ${h(formatDateTimeForUser(task.nextReminderAt, timezone))}` : `${bold("Next reminder")} none`,
    settings ? `${bold("Current interval")} ${settings.reminderIntervalMinutes} minutes` : undefined,
    task.reminderIntervalMinutes && settings && task.reminderIntervalMinutes !== settings.reminderIntervalMinutes
      ? `${bold("Stored task interval")} ${task.reminderIntervalMinutes} minutes`
      : undefined,
    settings ? `${bold("Daily cap")} ${settings.maxRemindersPerDay} reminders/day` : undefined,
    settings
      ? `${bold("Quiet hours")} ${h(settings.quietHoursStart && settings.quietHoursEnd ? `${settings.quietHoursStart}-${settings.quietHoursEnd}` : "off")}`
      : undefined,
    settings && settings.reminderIntervalMinutes <= 30 && settings.maxRemindersPerDay <= 10
      ? `${bold("Cap note")} ${h(`At this interval, the daily cap covers about ${Math.round(((settings.reminderIntervalMinutes * settings.maxRemindersPerDay) / 60) * 10) / 10} hours.`)}`
      : undefined,
    `${bold("Reminders sent")} ${task.reminderCount}`,
    task.calendarUrl ? `${bold("Calendar")} ${h(task.calendarUrl)}` : undefined,
    "",
    `${bold("Captured")} ${h(truncate(task.sourceText, 500))}`
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No close matches yet.";
  }

  return [
    bold("Search results"),
    "",
    ...results.map((result) => {
      const percent = Math.round(result.score * 100);
      return `${code(result.publicId)} ${bold(result.title)}\n${italic(`${result.kind}, ${percent}% match`)}\n${h(truncate(result.summary, 160))}`;
    })
  ].join("\n\n");
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
  const lines = [`${number}. ${bold(task.title)}`, `   ${code(task.publicId)}`];

  if (task.dueAt) {
    lines.push(`   ${italic(formatDateTimeForUser(task.dueAt, timezone))}`);
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
