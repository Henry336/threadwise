import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { formatDateTimeForUser } from "../utils/dates";
import { truncate } from "../utils/text";
import { listOpenTasks, type TaskListItem } from "./tasks";

export async function buildReview(userId: string, timezone: string): Promise<string> {
  const [tasks, notes, ideas, reflections] = await Promise.all([
    listOpenTasks(userId),
    prisma.note.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.idea.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.reflection.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 2 })
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
    "Threadwise review",
    "",
    "Tasks",
    `Open: ${tasks.length} (${overdue.length} overdue, ${today.length} today, ${noDate.length} no date)`,
    tasks.length ? formatTaskFocus(tasks, timezone) : "No open tasks.",
    "",
    formatRecentNotes(notes),
    "",
    formatRecentIdeas(ideas),
    reflections.length ? ["", formatRecentReflections(reflections)].join("\n") : undefined,
    "",
    "Suggested next step",
    nextStep(tasks)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTaskFocus(tasks: TaskListItem[], timezone: string): string {
  return tasks
    .slice(0, 5)
    .map((task, index) => {
      const due = task.dueAt ? ` due ${formatDateTimeForUser(task.dueAt, task.timezone ?? timezone)}` : "";
      return `${index + 1}. ${task.title} (${task.publicId})${due}`;
    })
    .join("\n");
}

function formatRecentNotes(notes: Array<{ publicId: string; title: string; summary: string }>): string {
  if (notes.length === 0) {
    return ["Recent notes", "None yet."].join("\n");
  }

  return ["Recent notes", ...notes.map((note) => `${note.publicId}: ${note.title} - ${truncate(note.summary, 120)}`)].join("\n");
}

function formatRecentIdeas(ideas: Array<{ publicId: string; title: string; concept: string }>): string {
  if (ideas.length === 0) {
    return ["Recent ideas", "None yet."].join("\n");
  }

  return ["Recent ideas", ...ideas.map((idea) => `${idea.publicId}: ${idea.title} - ${truncate(idea.concept, 120)}`)].join("\n");
}

function formatRecentReflections(reflections: Array<{ publicId: string; immediateAction: string }>): string {
  return ["Recent reflections", ...reflections.map((reflection) => `${reflection.publicId}: ${truncate(reflection.immediateAction, 120)}`)].join("\n");
}

function nextStep(tasks: TaskListItem[]): string {
  if (tasks.length === 0) {
    return "Capture one thing worth remembering, or add the next concrete task.";
  }

  return `Handle task 1 now, or use /snooze 1 1h if it needs a later nudge.`;
}
