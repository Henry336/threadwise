import { DateTime } from "luxon";
import { bold, code, h, italic } from "../utils/html";
import { prisma } from "../db/prisma";
import { formatDateTimeForUser } from "../utils/dates";
import { field, fieldHtml } from "../utils/messageFormat";
import { truncate } from "../utils/text";
import { listOpenTasks, type TaskListItem } from "./tasks";

export async function buildReview(userId: string, timezone: string): Promise<string> {
  const [tasks, notes, ideas] = await Promise.all([
    listOpenTasks(userId),
    prisma.note.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.idea.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 3 })
  ]);

  const now = DateTime.now().setZone(timezone);
  const overdue = tasks.filter((task) => task.dueAt && DateTime.fromJSDate(task.dueAt).setZone(timezone) < now);
  const today = tasks.filter((task) => {
    if (!task.dueAt) return false;
    const due = DateTime.fromJSDate(task.dueAt).setZone(timezone);
    return due >= now && due.hasSame(now, "day");
  });
  const noDate = tasks.filter((task) => !task.dueAt);

  return [
    bold("Threadwise review"),
    "",
    bold("Tasks"),
    `${bold("Open")} ${tasks.length} ${italic(`${overdue.length} overdue, ${today.length} today, ${noDate.length} no date`)}`,
    tasks.length ? formatTaskFocus(tasks, timezone) : "No open tasks.",
    "",
    formatRecentNotes(notes),
    "",
    formatRecentIdeas(ideas),
    "",
    bold("Suggested next step"),
    nextStep(tasks)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTaskFocus(tasks: TaskListItem[], timezone: string): string {
  return tasks
    .slice(0, 5)
    .map((task, index) => {
      return [
        `${index + 1}. ${bold(task.title)}`,
        `   ${fieldHtml("Task ID", code(task.publicId))}`,
        task.dueAt ? `   ${field("Due Date", formatDateTimeForUser(task.dueAt, task.timezone ?? timezone))}` : undefined
      ].filter(Boolean).join("\n");
    })
    .join("\n");
}

function formatRecentNotes(notes: Array<{ publicId: string; title: string; summary: string }>): string {
  if (notes.length === 0) {
    return [bold("Recent notes"), "None yet."].join("\n");
  }

  return [bold("Recent notes"), ...notes.map((note) => [
    bold(note.title),
    fieldHtml("Note ID", code(note.publicId)),
    h(truncate(note.summary, 120))
  ].join("\n"))].join("\n\n");
}

function formatRecentIdeas(ideas: Array<{ publicId: string; title: string; concept: string }>): string {
  if (ideas.length === 0) {
    return [bold("Recent ideas"), "None yet."].join("\n");
  }

  return [bold("Recent ideas"), ...ideas.map((idea) => [
    bold(idea.title),
    fieldHtml("Idea ID", code(idea.publicId)),
    h(truncate(idea.concept, 120))
  ].join("\n"))].join("\n\n");
}

function nextStep(tasks: TaskListItem[]): string {
  if (tasks.length === 0) {
    return "Capture one thing worth remembering, or add the next concrete task.";
  }

  return `Handle ${code("task 1")} now, or use ${code("/snooze 1 1h")} if it needs a later nudge.`;
}
