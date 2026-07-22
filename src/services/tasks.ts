import { Prisma, RecurrenceRule, TaskAssigneeStatus, TaskStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { structureTaskDeterministically } from "../ai/deterministic";
import { prisma } from "../db/prisma";
import { formatDateTimeForUser, formatRecurrenceRule, nextRecurringDueAt, parseDueDate, parseDurationMinutes, parseRecurrencePattern, recurrenceDayOfMonth, stripRecurrenceText } from "../utils/dates";
import { bold, code, h } from "../utils/html";
import { field, fieldHtml, joinBlocks, stableChoice } from "../utils/messageFormat";
import { createGoogleCalendarUrl } from "./calendar";
import { syncTaskCalendarBestEffort } from "./googleCalendar";
import { nextPublicId } from "./publicIds";
import { nextDueReminderAt } from "./reminders";
import { recordArchiveUndo, recordCreateUndo, recordFieldEditUndo, recordRenameUndo, recordRescheduleUndo, recordSnoozeUndo, recordTaskStateUndo } from "./undo";

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
  assignees?: TaskAssigneeInfo[];
  recurrenceRule?: RecurrenceRule | null;
  recurrenceIntervalDays?: number | null;
  recurrenceDayOfMonth?: number | null;
  reminderIntervalMinutes?: number | null;
  nextReminderAt?: Date | null;
  snoozedUntil?: Date | null;
  lastRemindedAt?: Date | null;
  reminderCount: number;
  completedAt?: Date | null;
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskAssigneeInfo = {
  telegramId?: string | null;
  username?: string | null;
  displayName?: string | null;
  status?: TaskAssigneeStatus;
  statusReason?: string | null;
  respondedAt?: Date | null;
  updatedAt?: Date;
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
  const primaryAssignee = prepared.assignees[0];
  const recurrence = parseRecurrencePattern(prepared.text);
  const recurrenceCleanedText = recurrence ? stripRecurrenceText(prepared.text) : prepared.text;
  const structured = structureTaskDeterministically(recurrenceCleanedText);
  const dueAt = parseDueDate(prepared.text, settings.timezone)
    ?? (structured.dueDateText ? parseDueDate(structured.dueDateText, settings.timezone) : undefined)
    ?? parseDueDate(recurrenceCleanedText, settings.timezone);
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

  const created = await prisma.$transaction(async (tx) => {
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
        assignedTelegramId: primaryAssignee?.telegramId,
        assignedUsername: primaryAssignee?.username,
        assignedDisplayName: primaryAssignee?.displayName,
        assignees: prepared.assignees.length ? { create: prepared.assignees.map(assigneeCreateData) } : undefined,
        recurrenceRule: recurrence?.rule,
        recurrenceIntervalDays: recurrence?.intervalDays,
        recurrenceDayOfMonth: recurrenceDayOfMonth(dueAt, recurrence?.rule, settings.timezone)
      },
      include: { assignees: true }
    });
    await recordCreateUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: task.title });
    return task;
  });
  return refreshCalendarState(userId, created);
}

export async function createScheduledReminder(userId: string, sourceText: string, scheduledAt: Date, ai: AiProvider, options: TaskCreationOptions = {}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const settings = user.settings;
  if (!settings) {
    throw new Error("User settings are missing.");
  }

  const prepared = prepareTaskInput(sourceText, options);
  const primaryAssignee = prepared.assignees[0];
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

  const created = await prisma.$transaction(async (tx) => {
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
        assignedTelegramId: primaryAssignee?.telegramId,
        assignedUsername: primaryAssignee?.username,
        assignedDisplayName: primaryAssignee?.displayName,
        assignees: prepared.assignees.length ? { create: prepared.assignees.map(assigneeCreateData) } : undefined,
        recurrenceRule: recurrence?.rule,
        recurrenceIntervalDays: recurrence?.intervalDays,
        recurrenceDayOfMonth: recurrenceDayOfMonth(scheduledAt, recurrence?.rule, settings.timezone)
      },
      include: { assignees: true }
    });
    await recordCreateUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: task.title });
    return task;
  });
  return refreshCalendarState(userId, created);
}

export async function listOpenTasks(userId: string, take?: number): Promise<TaskListItem[]> {
  const tasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN, archivedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take,
    include: { assignees: true }
  });

  return sortTasksForDisplay(tasks);
}

export async function completeTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  if (task.status === TaskStatus.DONE) {
    return { task, alreadyCompleted: true as const };
  }
  if (task.recurrenceRule && task.dueAt) {
    const nextDueAt = nextRecurringDueAt(task.dueAt, task.recurrenceRule, task.timezone ?? "UTC", new Date(), task.recurrenceDayOfMonth);
    const updated = await prisma.$transaction(async (tx) => {
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
    return { task: updated, alreadyCompleted: false as const };
  }

  return prisma.$transaction(async (tx) => {
    const changed = await tx.task.updateMany({
      where: { id: task.id, userId, status: { not: TaskStatus.DONE } },
      data: {
        status: TaskStatus.DONE,
        completedAt: new Date(),
        nextReminderAt: null,
        snoozedUntil: null
      }
    });
    const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    if (changed.count === 0) {
      return { task: current, alreadyCompleted: true as const };
    }
    await recordTaskStateUndo(tx, userId, task, "complete-task");
    return { task: current, alreadyCompleted: false as const };
  });
}

export async function restoreCompletedTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  if (task.status !== TaskStatus.DONE) {
    return { task, restored: false as const };
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  if (!user.settings) throw new Error("User settings are missing.");
  const now = new Date();
  const nextReminderAt = task.dueAt && task.dueAt.getTime() > now.getTime()
    ? nextDueReminderAt(task.dueAt, user.settings.dueNudgeMinutes, now)
    : nextIntervalReminderAtForTask(now, task.reminderIntervalMinutes ?? user.settings.reminderIntervalMinutes);

  return prisma.$transaction(async (tx) => {
    const changed = await tx.task.updateMany({
      where: { id: task.id, userId, status: TaskStatus.DONE },
      data: { status: TaskStatus.OPEN, completedAt: null, nextReminderAt, snoozedUntil: null }
    });
    const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    if (changed.count === 0) {
      return { task: current, restored: false as const };
    }
    await recordTaskStateUndo(tx, userId, task, "restore-task");
    return { task: current, restored: true as const };
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

  const updated = await prisma.$transaction(async (tx) => {
    await recordRenameUndo(tx, userId, { kind: "task", id: task.id, publicId: task.publicId, title: nextTitle }, task.title);
    return tx.task.update({
      where: { id: task.id },
      data: {
        title: nextTitle,
        calendarUrl
      }
    });
  });
  return refreshCalendarState(userId, updated);
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

  const updated = await prisma.$transaction(async (tx) => {
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
  return refreshCalendarState(userId, updated);
}

export async function assignTask(userId: string, reference: string, assigneeText: string, options: TaskCreationOptions = {}) {
  const task = await findTaskReference(userId, reference);
  const assignees = parseTaskAssignees(assigneeText, options.mentions, true);
  if (assignees.length === 0) {
    throw new Error("Use one or more Telegram mentions, like @alex and @sam. Plain names can be displayed but cannot receive DMs.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.taskAssignee.findMany({ where: { taskId: task.id } });
    const additions = assignees.filter((assignee) => !existing.some((item) => sameAssignee(item, assignee)));
    if (additions.length) {
      await tx.taskAssignee.createMany({
        data: additions.map((assignee) => ({ taskId: task.id, ...assigneeCreateData(assignee) })),
        skipDuplicates: true
      });
    }
    const allAssignees = await tx.taskAssignee.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    const primary = allAssignees[0];
    return tx.task.update({
      where: { id: task.id },
      data: {
        assignedTelegramId: primary?.telegramId,
        assignedUsername: primary?.username,
        assignedDisplayName: primary?.displayName
      },
      include: { assignees: true }
    });
  });
}

export async function unassignTask(userId: string, reference: string, assigneeText?: string, options: TaskCreationOptions = {}) {
  const task = await findTaskReference(userId, reference);
  const selected = assigneeText ? parseTaskAssignees(assigneeText, options.mentions, true) : [];
  return prisma.$transaction(async (tx) => {
    await tx.taskAssignee.deleteMany({
      where: selected.length
        ? {
            taskId: task.id,
            OR: selected.flatMap((assignee) => [
              { normalizedKey: assigneeKey(assignee) },
              ...(assignee.telegramId ? [{ telegramId: assignee.telegramId }] : []),
              ...(assignee.username ? [{ username: { equals: assignee.username, mode: "insensitive" as const } }] : []),
              ...(assignee.displayName ? [{ displayName: { equals: assignee.displayName, mode: "insensitive" as const } }] : [])
            ])
          }
        : { taskId: task.id }
    });
    const remaining = await tx.taskAssignee.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    const primary = remaining[0];
    return tx.task.update({
      where: { id: task.id },
      data: {
        assignedTelegramId: primary?.telegramId ?? null,
        assignedUsername: primary?.username ?? null,
        assignedDisplayName: primary?.displayName ?? null
      },
      include: { assignees: true }
    });
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

  const updated = await prisma.$transaction(async (tx) => {
    await recordRescheduleUndo(tx, userId, task);
    return tx.task.update({
      where: { id: task.id },
      data: {
        dueAt,
        timezone: dueAt ? settings.timezone : task.timezone,
        calendarUrl,
        nextReminderAt,
        snoozedUntil: null,
        recurrenceDayOfMonth: recurrenceDayOfMonth(dueAt ?? undefined, task.recurrenceRule ?? undefined, settings.timezone) ?? null
      }
    });
  });
  return refreshCalendarState(userId, updated);
}

export async function findTask(userId: string, publicOrUuid: string) {
  return prisma.task.findFirstOrThrow({
    where: {
      userId,
      archivedAt: null,
      OR: [{ id: publicOrUuid }, { publicId: publicOrUuid.toUpperCase() }]
    },
    include: { assignees: true }
  });
}

async function refreshCalendarState(userId: string, task: TaskListItem): Promise<TaskListItem> {
  const outcome = await syncTaskCalendarBestEffort(userId, task);
  if (outcome !== "synced" && outcome !== "removed") return task;
  return prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    include: { assignees: true }
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
    assignees?: TaskAssigneeInfo[];
    recurrenceRule?: RecurrenceRule | null;
  },
  fallbackTimezone = "UTC"
): string {
  const timezone = task.timezone ?? fallbackTimezone;
  return joinBlocks([
    bold("✅ Task saved"),
    h(task.title),
    [
      task.dueAt ? field("Due Date", formatDateTimeForUser(task.dueAt, timezone)) : field("Due Date", "No due date yet"),
      hasAssignees(task) ? fieldHtml("Assigned To", formatAssigneeHtml(task)) : undefined,
      task.recurrenceRule ? field("Repeats", formatRecurrence(task.recurrenceRule)) : undefined
    ].filter(Boolean).join("\n"),
    taskAssistantLine(task.publicId, Boolean(task.dueAt)),
    hasAssignees(task)
      ? "Want private deadline nudges too? Each assignee can open Threadwise privately and send /settings dm on."
      : undefined
  ]);
}

export function formatTaskCompleted(task: { publicId: string; title: string; status: TaskStatus; recurrenceRule?: RecurrenceRule | null; dueAt?: Date | null; timezone?: string | null }, fallbackTimezone = "UTC"): string {
  if (task.recurrenceRule && task.status === TaskStatus.OPEN && task.dueAt) {
    return joinBlocks([
      `${bold("✅ This occurrence is done")} ${h(task.title)}`,
      [
        field("Next Occurrence", formatDateTimeForUser(task.dueAt, task.timezone ?? fallbackTimezone)),
        field("Repeats", formatRecurrence(task.recurrenceRule))
      ].join("\n")
    ]);
  }

  return `${bold("✅ Task complete")} ${h(task.title)}`;
}

export async function archiveTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  const archivedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await recordArchiveUndo(tx, userId, {
      kind: "task",
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      archivedAt: task.archivedAt,
      archivedReason: null
    });
    return tx.task.update({
      where: { id: task.id },
      data: {
        archivedAt,
        archivedReason: "removed"
      }
    });
  });
}

export function formatTaskAlreadyCompleted(task: { publicId: string; title: string }): string {
  return `${bold("Already complete")} ${h(task.title)}\nNeed it back on your list? You can restore it below.`;
}

export function formatAssignee(task: { assignees?: TaskAssigneeInfo[]; assignedUsername?: string | null; assignedDisplayName?: string | null }): string {
  const assignees = task.assignees?.length
    ? task.assignees
    : task.assignedUsername || task.assignedDisplayName
      ? [{ username: task.assignedUsername, displayName: task.assignedDisplayName }]
      : [];
  return assignees.length ? assignees.map(formatOneAssignee).join(", ") : "Unassigned";
}

export function formatAssigneeHtml(task: { assignees?: TaskAssigneeInfo[]; assignedUsername?: string | null; assignedDisplayName?: string | null }): string {
  const assignees = task.assignees?.length
    ? task.assignees
    : task.assignedUsername || task.assignedDisplayName
      ? [{ username: task.assignedUsername, displayName: task.assignedDisplayName }]
      : [];
  return assignees.length ? assignees.map(formatOneAssigneeHtml).join(", ") : "Unassigned";
}

export function formatRecurrence(rule: RecurrenceRule): string {
  return formatRecurrenceRule(rule);
}

export function prepareTaskInput(sourceText: string, options: TaskCreationOptions): { text: string; assignees: ParsedAssignee[] } {
  const assignmentPrefix = sourceText.match(/^(.+?)\s+(?:to|about|for)\s+(.+)$/i);
  const prefix = assignmentPrefix?.[1] ?? "";
  const prefixHasTelegramTarget = /@[A-Za-z0-9_]{3,32}\b/.test(prefix)
    || (options.mentions ?? []).some((mention) => mention.offset >= 0 && mention.offset < prefix.length);
  const assigneeSource = prefixHasTelegramTarget ? prefix : sourceText;
  const assignees = parseTaskAssignees(assigneeSource, options.mentions, prefixHasTelegramTarget);
  if (assignees.length === 0) return { text: sourceText, assignees: [] };
  const text = prefixHasTelegramTarget
    ? assignmentPrefix?.[2]?.trim() ?? sourceText
    : stripLeadingTelegramTargets(sourceText, assignees);
  return { text: text || sourceText, assignees };
}

type ParsedAssignee = {
  telegramId?: string;
  username?: string;
  displayName?: string;
};

export function parseTaskAssignees(sourceText: string, mentions: TaskEntityMention[] = [], allowPlainNames = false): ParsedAssignee[] {
  const assignees: ParsedAssignee[] = [];
  for (const mention of mentions.filter((item) => item.offset >= 0)) {
    addAssignee(assignees, { telegramId: mention.telegramId, username: mention.username, displayName: mention.displayName ?? mention.username });
  }
  for (const match of sourceText.matchAll(/@([A-Za-z0-9_]{3,32})\b/g)) {
    const username = match[1];
    if (!username) continue;
    const entity = mentions.find((mention) => mention.username?.toLowerCase() === username.toLowerCase());
    addAssignee(assignees, { telegramId: entity?.telegramId, username, displayName: entity?.displayName ?? username });
  }
  if (allowPlainNames) {
    for (const part of sourceText.split(/\s*(?:,|&|\band\b)\s*/i)) {
      const displayName = part.replace(/@[A-Za-z0-9_]{3,32}\b/g, "").trim();
      if (displayName && /^(?!me$|us$|everyone$|everybody$)[\p{L}][\p{L}\p{M} .'-]{0,60}$/iu.test(displayName)) {
        addAssignee(assignees, { displayName });
      }
    }
  }
  return assignees;
}

function assigneeCreateData(assignee: ParsedAssignee) {
  return { normalizedKey: assigneeKey(assignee), telegramId: assignee.telegramId, username: assignee.username, displayName: assignee.displayName };
}

function assigneeKey(assignee: ParsedAssignee): string {
  if (assignee.telegramId) return `id:${assignee.telegramId}`;
  if (assignee.username) return `username:${assignee.username.toLowerCase()}`;
  return `name:${(assignee.displayName ?? "unknown").toLowerCase()}`;
}

function addAssignee(assignees: ParsedAssignee[], assignee: ParsedAssignee): void {
  const label = assignee.displayName?.toLowerCase();
  if ((!assignee.telegramId && !assignee.username && !assignee.displayName) || assignees.some((item) =>
    assigneeKey(item) === assigneeKey(assignee)
    || Boolean(assignee.telegramId && item.telegramId === assignee.telegramId)
    || Boolean(assignee.username && item.username?.toLowerCase() === assignee.username.toLowerCase())
    || Boolean(label && item.displayName?.toLowerCase() === label)
  )) return;
  assignees.push(assignee);
}

function sameAssignee(left: TaskAssigneeInfo & { normalizedKey?: string }, right: ParsedAssignee): boolean {
  return left.normalizedKey === assigneeKey(right)
    || Boolean(right.telegramId && left.telegramId === right.telegramId)
    || Boolean(right.username && left.username?.toLowerCase() === right.username.toLowerCase())
    || Boolean(right.displayName && left.displayName?.toLowerCase() === right.displayName.toLowerCase());
}

function formatOneAssignee(assignee: TaskAssigneeInfo): string {
  return assignee.username ? `@${assignee.username}` : assignee.displayName ?? "Unknown";
}

function formatOneAssigneeHtml(assignee: TaskAssigneeInfo): string {
  if (assignee.username) return h(`@${assignee.username}`);
  if (assignee.telegramId && /^\d+$/.test(assignee.telegramId)) {
    return `<a href="tg://user?id=${assignee.telegramId}">${h(assignee.displayName ?? "Assigned user")}</a>`;
  }
  return h(assignee.displayName ?? "Unknown");
}

export function hasAssignees(task: { assignees?: TaskAssigneeInfo[]; assignedUsername?: string | null; assignedDisplayName?: string | null }): boolean {
  return Boolean(task.assignees?.length || task.assignedUsername || task.assignedDisplayName);
}

function stripLeadingTelegramTargets(sourceText: string, assignees: ParsedAssignee[]): string {
  let text = sourceText.trim();
  for (const assignee of assignees) {
    if (!assignee.username) continue;
    text = text.replace(new RegExp(`^\\s*@${escapeRegExp(assignee.username)}\\s*(?:,|&|and)?\\s*`, "i"), "");
  }
  return text.trim();
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
