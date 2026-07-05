import { TaskStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { prisma } from "../db/prisma";
import { parseDueDate, parseDurationMinutes } from "../utils/dates";
import { createGoogleCalendarUrl } from "./calendar";
import { nextPublicId } from "./publicIds";

export async function createTask(userId: string, sourceText: string, ai: AiProvider) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const structured = await ai.structureTask(sourceText);
  const dueAt = structured.dueDateText ? parseDueDate(structured.dueDateText, settings.timezone) : parseDueDate(sourceText, settings.timezone);
  const embedding = await ai.embed(`${structured.title}\n${structured.description ?? ""}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "TASK");
  const nextReminderAt = new Date(Date.now() + settings.reminderIntervalMinutes * 60_000);
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

export async function listOpenTasks(userId: string) {
  return prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 20
  });
}

export async function completeTask(userId: string, publicOrUuid: string) {
  const task = await findTask(userId, publicOrUuid);
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

export async function snoozeTask(userId: string, publicOrUuid: string, durationText?: string) {
  const task = await findTask(userId, publicOrUuid);
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

export async function findTask(userId: string, publicOrUuid: string) {
  return prisma.task.findFirstOrThrow({
    where: {
      userId,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });
}

export function formatTaskCreated(task: { publicId: string; title: string; dueAt?: Date | null; calendarUrl?: string | null }): string {
  return [
    `Added ${task.publicId}: ${task.title}`,
    task.dueAt ? `Due: ${task.dueAt.toLocaleString()}` : undefined,
    "I will keep reminding you until this is done.",
    task.calendarUrl ? `Calendar: ${task.calendarUrl}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

