import { Prisma, RecurrenceRule, TaskStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { structureTaskDeterministically } from "../ai/deterministic";
import { prisma } from "../db/prisma";
import { formatDateTimeForUser, nextRecurringDueAt, parseDueDate, parseDurationMinutes, parseRecurrencePattern, stripRecurrenceText } from "../utils/dates";
import { bold, code, h } from "../utils/html";
import { field, fieldHtml, joinBlocks, stableChoice } from "../utils/messageFormat";
import { createGoogleCalendarUrl } from "./calendar";
import { nextPublicId } from "./publicIds";
import { nextDueReminderAt } from "./reminders";
import { recordCreateUndo, recordFieldEditUndo, recordRenameUndo, recordRescheduleUndo, recordSnoozeUndo, recordTaskStateUndo } from "./undo";

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
  calendarEventId?: string | null;
  calendarEventUrl?: string | null;
  calendarSyncedAt?: Date | null;
  assignedTelegramId?: string | null;
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceIntervalDays?: number | null;
  reminderIntervalMinutes?: number | null;
  nextReminderAt?: Date | null;
  snoozedUntil?: Date | null;
  lastRemindedAt?: Date | null;
  reminderCount: number;
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskEntityMention = {
  offset: number;
  length: number;
  username?: string;
  telegramId?: string;
  displayName?: string;
};

export type TaskCreationOptions = {
  mentions?: TaskEntityMention[];
};

export async function createTask(userId: string, sourceText: string, ai: AiProvider, options: TaskCreationOptions = {}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const prepared = prepareTaskInput(sourceText, options);
  const recurrence = parseRecurrencePattern(prepared.text);
  const recurrenceCleanedText = recurrence ? stripRecurrenceText(prepared.text) : prepared.text;
  const structured = structureTaskDeterministically(recurrenceCleanedText);
  const dueAt = structured.dueDateText
    ? parseDueDate(structured.dueDateText, settings.timezone) ?? parseDueDate(recurrenceCleanedText, settings.timezone)
    : parseDueDate(recurrenceCleanedText, settings.timezone);
  const embedding = await ai.embed(`${structured.title}\n${structured.description ?? ""}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "TASK");
  const intervalReminderAt = new Date(Date.now() + settings.reminderIntervalMinutes * 60_000);
  const now = new Date();
  const nextReminderAt = dueAt && dueAt.getTime() > now.getTime() ? nextDueReminderAt(dueAt, settings.dueNudgeMinutes, now) : intervalReminderAt;
  const calendarUrl = dueAt
    ? createGoogleCalendarUrl({
        title: structured.title,
        details: structured.description ?? sourceText,
        dueAt,
        timezone: settings.timezone
      })
    : undefined;

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
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
        calendarUrl,
        assignedTelegramId: prepared.assignee?.telegramId,
        assignedUsername: prepared.assignee?.username,
        assignedDisplayName: prepared.assignee?.displayName,
        recurrenceRule: recurrence?.rule,
        recurrenceIntervalDays: recurrence?.intervalDays
      }
    });
    await recordCreateUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: task.title });
    return task;
  });
}

export async function createScheduledReminder(userId: string, sourceText: string, scheduledAt: Date, ai: AiProvider, options: TaskCreationOptions = {}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const prepared = prepareTaskInput(sourceText, options);
  const recurrence = parseRecurrencePattern(prepared.text);
  const recurrenceCleanedText = recurrence ? stripRecurrenceText(prepared.text) : prepared.text;
  const structured = structureTaskDeterministically(recurrenceCleanedText);
  const embedding = await ai.embed(`${structured.title}\n${structured.description ?? ""}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "TASK");
  const calendarUrl = createGoogleCalendarUrl({
    title: structured.title,
    details: structured.description ?? sourceText,
    dueAt: scheduledAt,
    timezone: settings.timezone
  });

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        userId,
        publicId,
        title: structured.title,
        description: structured.description,
        sourceText,
        dueAt: scheduledAt,
        timezone: settings.timezone,
        reminderIntervalMinutes: settings.reminderIntervalMinutes,
        nextReminderAt: nextDueReminderAt(scheduledAt, settings.dueNudgeMinutes, new Date()),
        embedding,
        calendarUrl,
        assignedTelegramId: prepared.assignee?.telegramId,
        assignedUsername: prepared.assignee?.username,
        assignedDisplayName: prepared.assignee?.displayName,
        recurrenceRule: recurrence?.rule,
        recurrenceIntervalDays: recurrence?.intervalDays
      }
    });
    await recordCreateUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: task.title });
    return task;
  });
}

export async function listOpenTasks(userId: string, take = 50): Promise<TaskListItem[]> {
  const tasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN, archivedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take
  });

  return sortTasksForDisplay(tasks);
}

export async function completeTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  if (task.recurrenceRule && task.recurrenceIntervalDays && task.dueAt) {
    const nextDueAt = nextRecurringDueAt(task.dueAt, task.recurrenceIntervalDays, task.timezone ?? "UTC");
    return prisma.$transaction(async (tx) => {
      await recordTaskStateUndo(tx, userId, task, "complete-task");
      return tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.OPEN,
          completedAt: new Date(),
          dueAt: nextDueAt,
          nextReminderAt: nextDueAt,
          snoozedUntil: null,
          calendarUrl: createGoogleCalendarUrl({
            title: task.title,
            details: task.description ?? task.sourceText,
            dueAt: nextDueAt,
            timezone: task.timezone ?? "UTC"
          })
        }
      });
    });
  }

  return prisma.$transaction(async (tx) => {
    await recordTaskStateUndo(tx, userId, task, "complete-task");
    return tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.DONE,
        completedAt: new Date(),
        nextReminderAt: null,
        snoozedUntil: null
      }
    });
  });
}

export async function snoozeTask(userId: string, reference: string, durationText?: string) {
  const task = await findTaskReference(userId, reference);
  const minutes = parseDurationMinutes(durationText ?? "", 60);
  const until = new Date(Date.now() + minutes * 60_000);

  return prisma.$transaction(async (tx) => {
    await recordSnoozeUndo(tx, userId, task);
    return tx.task.update({
      where: { id: task.id },
      data: {
        snoozedUntil: until,
        nextReminderAt: until
      }
    });
  });
}

export async function cancelTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  return prisma.$transaction(async (tx) => {
    await recordTaskStateUndo(tx, userId, task, "cancel-task");
    return tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.CANCELED,
        nextReminderAt: null,
        snoozedUntil: null
      }
    });
  });
}

export async function renameTaskTitle(userId: string, reference: string, title: string) {
  const task = await findTaskReference(userId, reference);
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new Error("Task title cannot be empty.");
  }

  const calendarUrl = task.dueAt
    ? createGoogleCalendarUrl({
        title: nextTitle,
        details: task.description ?? task.sourceText,
        dueAt: task.dueAt,
        timezone: task.timezone ?? "UTC"
      })
    : task.calendarUrl;

  return prisma.$transaction(async (tx) => {
    await recordRenameUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: nextTitle }, task.title);
    return tx.task.update({
      where: { id: task.id },
      data: {
        title: nextTitle,
        calendarUrl
      }
    });
  });
}

export async function updateTaskDescription(userId: string, reference: string, description: string) {
  const task = await findTaskReference(userId, reference);
  const nextDescription = description.trim();
  if (!nextDescription) {
    throw new Error("Task details cannot be empty.");
  }

  const calendarUrl = task.dueAt
    ? createGoogleCalendarUrl({
        title: task.title,
        details: nextDescription,
        dueAt: task.dueAt,
        timezone: task.timezone ?? "UTC"
      })
    : task.calendarUrl;

  return prisma.$transaction(async (tx) => {
    await recordFieldEditUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: task.title }, "description", task.description ?? null);
    return tx.task.update({
      where: { id: task.id },
      data: {
        description: nextDescription,
        calendarUrl,
        embedding: Prisma.JsonNull
      }
    });
  });
}

export async function assignTask(userId: string, reference: string, assigneeText: string) {
  const task = await findTaskReference(userId, reference);
  const assignee = parseAssignee(assigneeText);
  if (!assignee?.username && !assignee?.displayName) {
    throw new Error("Use a Telegram mention like @henry_derek so I know who to assign it to.");
  }

  return prisma.task.update({
    where: { id: task.id },
    data: {
      assignedTelegramId: assignee.telegramId,
      assignedUsername: assignee.username,
      assignedDisplayName: assignee.displayName
    }
  });
}

export async function unassignTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  return prisma.task.update({
    where: { id: task.id },
    data: {
      assignedTelegramId: null,
      assignedUsername: null,
      assignedDisplayName: null
    }
  });
}

export async function rescheduleTask(userId: string, reference: string, dueDateText: string) {
  const task = await findTaskReference(userId, reference);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const clearDueDate = /^(none|no date|clear|remove)$/i.test(dueDateText.trim());
  const dueAt = clearDueDate ? null : parseDueDate(dueDateText, settings.timezone);
  if (!clearDueDate && !dueAt) {
    throw new Error("I couldn't find a new reminder time in that.");
  }

  const now = new Date();
  const nextReminderAt = dueAt
    ? nextDueReminderAt(dueAt, settings.dueNudgeMinutes, now)
    : nextIntervalReminderAtForTask(now, settings.reminderIntervalMinutes);
  const calendarUrl = dueAt
    ? createGoogleCalendarUrl({
        title: task.title,
        details: task.description ?? task.sourceText,
        dueAt,
        timezone: settings.timezone
      })
    : null;

  return prisma.$transaction(async (tx) => {
    await recordRescheduleUndo(tx, userId, task);
    return tx.task.update({
      where: { id: task.id },
      data: {
        dueAt,
        timezone: dueAt ? settings.timezone : task.timezone,
        calendarUrl,
        nextReminderAt,
        snoozedUntil: null
      }
    });
  });
}

export async function findTask(userId: string, publicOrUuid: string) {
  return prisma.task.findFirstOrThrow({
    where: {
      userId,
      archivedAt: null,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    }
  });
}

function nextIntervalReminderAtForTask(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() + intervalMinutes * 60_000);
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

export function sortTasksForDisplay<T extends { dueAt?: Date | null; createdAt: Date; pinnedAt?: Date | null }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) {
      return b.pinnedAt.getTime() - a.pinnedAt.getTime();
    }

    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;

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
  task: {
    publicId: string;
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    assignedUsername?: string | null;
    assignedDisplayName?: string | null;
    recurrenceRule?: RecurrenceRule | null;
  },
  fallbackTimezone = "UTC"
): string {
  const timezone = task.timezone ?? fallbackTimezone;
  return joinBlocks([
    h(task.title),
    [
      task.dueAt ? field("Due Date", formatDateTimeForUser(task.dueAt, timezone)) : field("Due Date", "No due date yet"),
      task.assignedUsername || task.assignedDisplayName ? field("Assigned To", formatAssignee(task)) : undefined,
      task.recurrenceRule ? field("Repeats", formatRecurrence(task.recurrenceRule)) : undefined,
      fieldHtml("Task ID", code(task.publicId))
    ].filter(Boolean).join("\n"),
    taskAssistantLine(task.publicId, Boolean(task.dueAt))
  ]);
}

export function formatTaskCompleted(task: { publicId: string; title: string; status: TaskStatus; recurrenceRule?: RecurrenceRule | null; dueAt?: Date | null; timezone?: string | null }, fallbackTimezone = "UTC"): string {
  if (task.recurrenceRule && task.status === TaskStatus.OPEN && task.dueAt) {
    return joinBlocks([
      `${bold("Completed this occurrence")} ${code(task.publicId)} ${h(task.title)}`,
      [
        field("Next Occurrence", formatDateTimeForUser(task.dueAt, task.timezone ?? fallbackTimezone)),
        field("Repeats", formatRecurrence(task.recurrenceRule))
      ].join("\n")
    ]);
  }

  return `${bold("Completed task")} ${code(task.publicId)} ${h(task.title)}`;
}

export function formatAssignee(task: { assignedUsername?: string | null; assignedDisplayName?: string | null }): string {
  if (task.assignedUsername) {
    return `@${task.assignedUsername}`;
  }

  return task.assignedDisplayName ?? "Unassigned";
}

export function formatRecurrence(rule: RecurrenceRule): string {
  return rule === RecurrenceRule.WEEKLY ? "Weekly" : "Daily";
}

function prepareTaskInput(sourceText: string, options: TaskCreationOptions): { text: string; assignee?: ParsedAssignee } {
  const assignee = parseAssignee(sourceText, options.mentions);
  if (!assignee) {
    return { text: sourceText };
  }

  const text = assignee.username
    ? sourceText.replace(new RegExp(`^\\s*@${escapeRegExp(assignee.username)}\\s+`, "i"), "").trim()
    : sourceText;
  return { text: text || sourceText, assignee };
}

type ParsedAssignee = {
  telegramId?: string;
  username?: string;
  displayName?: string;
};

function parseAssignee(sourceText: string, mentions: TaskEntityMention[] = []): ParsedAssignee | undefined {
  const leadingMention = sourceText.match(/^\s*@([A-Za-z0-9_]{3,32})\b/);
  if (leadingMention?.[1]) {
    const username = leadingMention[1];
    const entity = mentions.find((mention) => mention.username?.toLowerCase() === username.toLowerCase() || mention.offset === sourceText.indexOf(`@${username}`));
    return {
      telegramId: entity?.telegramId,
      username,
      displayName: entity?.displayName ?? username
    };
  }

  const textMention = mentions.find((mention) => mention.telegramId);
  if (textMention) {
    return {
      telegramId: textMention.telegramId,
      username: textMention.username,
      displayName: textMention.displayName
    };
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function taskAssistantLine(publicId: string, hasDueDate: boolean): string {
  const choices = hasDueDate
    ? [
        "I'll remind you when the time comes.",
        "I'll keep watch and bring this back at the right time.",
        "I'll make sure this comes back onto your radar."
      ]
    : [
        "I'll keep this on your radar until it is done.",
        "I'll keep nudging this until you complete it.",
        "I'll make sure this does not quietly disappear."
      ];

  return stableChoice(publicId, choices);
}
