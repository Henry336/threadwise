import { TaskStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { prisma } from "../db/prisma";
import { formatDateTimeForUser, parseDueDate, parseDurationMinutes } from "../utils/dates";
import { createGoogleCalendarUrl } from "./calendar";
import { nextPublicId } from "./publicIds";

export type TaskListItem = {
  id: string;
  publicId: string;
  title: string;
  description?: string | null;
  sourceText: string;
  status: TaskStatus;
  dueAt?: Date | null;
  timezone?: string | null;
  calendarUrl?: string | null;
  reminderCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function createTask(userId: string, sourceText: string, ai: AiProvider) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const structured = await ai.structureTask(sourceText);
  const dueAt = structured.dueDateText
    ? parseDueDate(structured.dueDateText, settings.timezone) ?? parseDueDate(sourceText, settings.timezone)
    : parseDueDate(sourceText, settings.timezone);
  const embedding = await ai.embed(`${structured.title}\n${structured.description ?? ""}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "TASK");
  const intervalReminderAt = new Date(Date.now() + settings.reminderIntervalMinutes * 60_000);
  const nextReminderAt = dueAt && dueAt.getTime() > Date.now() ? dueAt : intervalReminderAt;
  const calendarUrl = dueAt
    ? createGoogleCalendarUrl({
        title: structured.title,
        details: structured.description ?? sourceText,
        dueAt,
        timezone: settings.timezone
      })
    : undefined;

  return prisma.task.create({
    data: {
      userId,
      publicId,
      title: structured.title,
      description: structured.description,
      sourceText,
      dueAt,
      timezone: settings.timezone,
      reminderIntervalMinutes: settings.reminderIntervalMinutes,
      nextReminderAt,
      embedding,
      calendarUrl
    }
  });
}

export async function createScheduledReminder(userId: string, sourceText: string, scheduledAt: Date, ai: AiProvider) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const structured = await ai.structureTask(sourceText);
  const embedding = await ai.embed(`${structured.title}\n${structured.description ?? ""}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "TASK");
  const calendarUrl = createGoogleCalendarUrl({
    title: structured.title,
    details: structured.description ?? sourceText,
    dueAt: scheduledAt,
    timezone: settings.timezone
  });

  return prisma.task.create({
    data: {
      userId,
      publicId,
      title: structured.title,
      description: structured.description,
      sourceText,
      dueAt: scheduledAt,
      timezone: settings.timezone,
      reminderIntervalMinutes: settings.reminderIntervalMinutes,
      nextReminderAt: scheduledAt,
      embedding,
      calendarUrl
    }
  });
}

export async function listOpenTasks(userId: string, take = 50): Promise<TaskListItem[]> {
  const tasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take
  });

  return sortTasksForDisplay(tasks);
}

export async function completeTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  return prisma.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.DONE,
      completedAt: new Date(),
      nextReminderAt: null,
      snoozedUntil: null
    }
  });
}

export async function snoozeTask(userId: string, reference: string, durationText?: string) {
  const task = await findTaskReference(userId, reference);
  const minutes = parseDurationMinutes(durationText ?? "", 60);
  const until = new Date(Date.now() + minutes * 60_000);

  return prisma.task.update({
    where: { id: task.id },
    data: {
      snoozedUntil: until,
      nextReminderAt: until
    }
  });
}

export async function cancelTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  return prisma.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.CANCELED,
      nextReminderAt: null,
      snoozedUntil: null
    }
  });
}

export async function findTask(userId: string, publicOrUuid: string) {
  return prisma.task.findFirstOrThrow({
    where: {
      userId,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });
}

export async function findTaskReference(userId: string, reference: string): Promise<TaskListItem> {
  const normalized = reference.trim();
  const activeIndex = Number(normalized);
  if (Number.isInteger(activeIndex) && activeIndex > 0) {
    const tasks = await listOpenTasks(userId);
    const task = tasks[activeIndex - 1];
    if (!task) {
      throw new Error(`No open task numbered ${activeIndex}. Run /tasks to see the current list.`);
    }
    return task;
  }

  return findTask(userId, normalized);
}

export function sortTasksForDisplay<T extends { dueAt?: Date | null; createdAt: Date }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      const dueDiff = a.dueAt.getTime() - b.dueAt.getTime();
      if (dueDiff !== 0) return dueDiff;
    }

    if (a.dueAt && !b.dueAt) return -1;
    if (!a.dueAt && b.dueAt) return 1;

    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function formatTaskCreated(
  task: { publicId: string; title: string; dueAt?: Date | null; timezone?: string | null; calendarUrl?: string | null },
  fallbackTimezone = "UTC"
): string {
  const timezone = task.timezone ?? fallbackTimezone;
  return [
    `Added ${task.publicId}: ${task.title}`,
    task.dueAt ? `Due: ${formatDateTimeForUser(task.dueAt, timezone)}` : undefined,
    "I will keep reminding you until this is done.",
    task.calendarUrl ? `Calendar: ${task.calendarUrl}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
