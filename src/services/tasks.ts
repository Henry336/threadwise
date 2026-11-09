/**
 * Core task domain: create, list, complete, snooze, cancel, rename, reschedule,
 * assign and archive tasks, plus the Telegram card text for them. Every lookup is
 * scoped by the owner's userId. State changes that /undo can reverse write an
 * undo audit row in the same transaction. Called by most src/bot task handlers,
 * taskCommands.ts, bulkActions.ts and the dashboard data layer.
 */
import { RecurrenceRule, TaskAssigneeStatus, TaskAudience, TaskStatus } from "@prisma/client";
import { structureTaskDeterministically } from "../ai/deterministic";
import { prisma } from "../db/prisma";
import { formatDateTimeForUser, formatRecurrenceRule, nextRecurringDueAt, parseDueDate, parseDurationMinutes, parseRecurrencePattern, recurrenceDayOfMonth, stripRecurrenceText } from "../utils/dates";
import { bold, h } from "../utils/html";
import { field, fieldHtml, joinBlocks, stableChoice } from "../utils/messageFormat";
import { createGoogleCalendarUrl } from "./calendar";
import { removeTaskFromGoogleCalendar, syncTaskCalendarBestEffort } from "./googleCalendar";
import { createWithPublicId } from "./publicIds";
import { initialTaskReminderAt } from "./reminders";
import { cancelPendingTaskReminderSchedules, restoreFutureTaskReminderSchedules } from "./taskReminderSchedules";
import { recordArchiveUndo, recordCreateUndo, recordFieldEditUndo, recordRenameUndo, recordRescheduleUndo, recordSnoozeUndo, recordTaskStateUndo } from "./undo";
import { completeSearchableContentUpdate } from "../security/contentEncryption";

export type TaskListItem = {
  id: string;
  publicId: string;
  title: string;
  description?: string | null;
  sourceText: string;
  status: TaskStatus;
  audience?: TaskAudience;
  dueAt?: Date | null;
  timezone?: string | null;
  calendarUrl?: string | null;
  calendarEventId?: string | null;
  calendarEventUrl?: string | null;
  calendarSyncedAt?: Date | null;
  assignedTelegramId?: string | null;
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  teamOwnerLabel?: string | null;
  assignees?: TaskAssigneeInfo[];
  recurrenceRule?: RecurrenceRule | null;
  recurrenceIntervalDays?: number | null;
  recurrenceDayOfMonth?: number | null;
  reminderIntervalMinutes?: number | null;
  nextReminderAt?: Date | null;
  snoozedUntil?: Date | null;
  lastRemindedAt?: Date | null;
  reminderCount: number;
  automaticReminderCount?: number;
  automaticReminderBudget?: number;
  remindersDismissedAt?: Date | null;
  undatedNudgeCount?: number;
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

export type TaskCreationAssignee = {
  telegramId?: string;
  username?: string;
  displayName?: string;
};

/**
 * Extra inputs for createTask from the caller: Telegram mention entities,
 * explicit assignees, a fixed due time, the import row that produced the task,
 * or a title chosen on a review card.
 */
export type TaskCreationOptions = {
  mentions?: TaskEntityMention[];
  assignees?: TaskCreationAssignee[];
  dueAt?: Date;
  importItemId?: string;
  teamOwnerLabel?: string;
  initialStatus?: TaskStatus;
  titleOverride?: string;
};

/**
 * Creates a task from free text using deterministic parsing only (no AI):
 * assignees, recurrence, due date and title come from the text unless options
 * override them. Sets the first automatic reminder time and a Google Calendar
 * link. The public id and an undo record are written in one transaction; Google
 * Calendar sync then runs best effort.
 */
export async function createTask(userId: string, sourceText: string, options: TaskCreationOptions = {}) {
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
  const dueAt = options.dueAt ?? parseDueDate(prepared.text, settings.timezone)
    ?? (structured.dueDateText ? parseDueDate(structured.dueDateText, settings.timezone) : undefined)
    ?? parseDueDate(recurrenceCleanedText, settings.timezone);
  const title = options.titleOverride?.trim() || structured.title;
  const initialStatus = options.initialStatus ?? TaskStatus.OPEN;
  const now = new Date();
  const nextReminderAt = initialStatus === TaskStatus.OPEN
    ? initialTaskReminderAt({ now, dueAt, dueNudgeMinutes: settings.dueNudgeMinutes, intervalMinutes: settings.reminderIntervalMinutes })
    : null;
  const calendarUrl = dueAt
    ? createGoogleCalendarUrl({
        title,
        details: structured.description ?? sourceText,
        dueAt,
        timezone: settings.timezone
      })
    : undefined;

  const created = await createWithPublicId(userId, "TASK", async (tx, publicId) => {
    const task = await tx.task.create({
      data: {
        userId,
        publicId,
        title,
        description: structured.description,
        status: initialStatus,
        audience: prepared.assignees.length ? TaskAudience.ASSIGNEES : TaskAudience.UNASSIGNED,
        sourceText,
        dueAt,
        timezone: settings.timezone,
        reminderIntervalMinutes: settings.reminderIntervalMinutes,
        nextReminderAt,
        completedAt: initialStatus === TaskStatus.DONE ? now : null,
        calendarUrl,
        assignedTelegramId: primaryAssignee?.telegramId,
        assignedUsername: primaryAssignee?.username,
        assignedDisplayName: primaryAssignee?.displayName,
        teamOwnerLabel: options.teamOwnerLabel?.trim() || null,
        importSourceItemId: options.importItemId,
        importItem: options.importItemId ? { connect: { id: options.importItemId } } : undefined,
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

/**
 * A reminder is a task with a fixed due time. It delegates to createTask so the
 * two cannot drift: same parsing, assignees, recurrence, calendar link and
 * first reminder time.
 */
export async function createScheduledReminder(userId: string, sourceText: string, scheduledAt: Date, options: TaskCreationOptions = {}) {
  return createTask(userId, sourceText, { ...options, dueAt: scheduledAt });
}

/**
 * Open, unarchived tasks in display order (pinned first, then by due date).
 * Numbered list references like "done 2" index into this order.
 */
export async function listOpenTasks(userId: string, take?: number): Promise<TaskListItem[]> {
  const tasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN, archivedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take,
    include: { assignees: true }
  });

  return sortTasksForDisplay(tasks);
}

/**
 * Marks a task done. Returns `alreadyCompleted: true` when nothing changed.
 *
 * One-off tasks become DONE. Recurring tasks stay OPEN and move to their next occurrence.
 * `expectedDueAt` is the due time the user saw (from a Done button). If the task has
 * already moved past it, the tap is stale and nothing changes. Text commands and older
 * buttons pass nothing and complete whatever occurrence is current.
 */
export async function completeTask(userId: string, reference: string, expectedDueAt?: Date) {
  const task = await findTaskReference(userId, reference);
  if (task.status === TaskStatus.DONE) {
    return { task, alreadyCompleted: true as const };
  }
  if (task.recurrenceRule && task.dueAt) {
    const dueAt = task.dueAt;
    if (expectedDueAt && dueAt.getTime() !== expectedDueAt.getTime()) {
      return { task, alreadyCompleted: true as const };
    }

    const nextDueAt = nextRecurringDueAt(dueAt, task.recurrenceRule, task.timezone ?? "UTC", new Date(), task.recurrenceDayOfMonth);
    return prisma.$transaction(async (tx) => {
      // Matching on dueAt makes a simultaneous double tap advance only once.
      const changed = await tx.task.updateMany({
        where: { id: task.id, userId, dueAt },
        data: {
          status: TaskStatus.OPEN,
          completedAt: new Date(),
          dueAt: nextDueAt,
          nextReminderAt: nextDueAt,
          snoozedUntil: null,
          undatedNudgeCount: 0,
          automaticReminderCount: 0,
          remindersDismissedAt: null,
          calendarUrl: createGoogleCalendarUrl({
            title: task.title,
            details: task.description ?? task.sourceText,
            dueAt: nextDueAt,
            timezone: task.timezone ?? "UTC"
          })
        }
      });

      const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
      if (changed.count === 0) {
        return { task: current, alreadyCompleted: true as const };
      }
      await recordTaskStateUndo(tx, userId, task, "complete-task");
      await cancelPendingTaskReminderSchedules(tx, task.id);
      return { task: current, alreadyCompleted: false as const };
    });
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
    await cancelPendingTaskReminderSchedules(tx, task.id);
    return { task: current, alreadyCompleted: false as const };
  });
}

/**
 * Reopens a DONE task and restarts its reminder timing. Future custom reminders
 * that were cancelled by the completion come back. The conditional update makes
 * a repeated tap a no-op, and an undo record is written.
 */
export async function restoreCompletedTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  if (task.status !== TaskStatus.DONE) {
    return { task, restored: false as const };
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  if (!user.settings) throw new Error("User settings are missing.");
  const now = new Date();
  const nextReminderAt = initialTaskReminderAt({
    now,
    dueAt: task.dueAt,
    dueNudgeMinutes: user.settings.dueNudgeMinutes,
    intervalMinutes: task.reminderIntervalMinutes ?? user.settings.reminderIntervalMinutes,
  });

  return prisma.$transaction(async (tx) => {
    const changed = await tx.task.updateMany({
      where: { id: task.id, userId, status: TaskStatus.DONE },
      data: { status: TaskStatus.OPEN, completedAt: null, nextReminderAt, snoozedUntil: null, undatedNudgeCount: 0, automaticReminderCount: 0, remindersDismissedAt: null }
    });
    const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    if (changed.count === 0) {
      return { task: current, restored: false as const };
    }
    await restoreFutureTaskReminderSchedules(tx, task.id, now);
    await recordTaskStateUndo(tx, userId, task, "restore-task");
    return { task: current, restored: true as const };
  });
}

/**
 * Pushes the next reminder back by the given duration (default 60 minutes) and
 * records an undo entry.
 */
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
        nextReminderAt: until,
        undatedNudgeCount: 0
      }
    });
  });
}

/** Marks the task CANCELED, stops its reminders and records an undo entry. */
export async function cancelTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  return prisma.$transaction(async (tx) => {
    await recordTaskStateUndo(tx, userId, task, "cancel-task");
    await cancelPendingTaskReminderSchedules(tx, task.id);
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

/**
 * Changes the title and rebuilds the calendar link. completeSearchableContentUpdate
 * passes every searchable field so the encryption layer can rebuild the search
 * tokens for the whole record. Records an undo entry.
 */
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
      data: completeSearchableContentUpdate("Task", task as unknown as Record<string, unknown>, {
        title: nextTitle,
        calendarUrl,
        undatedNudgeCount: 0
      })
    });
  });
  return refreshCalendarState(userId, updated);
}

/**
 * Replaces the task details, with the same calendar link, search token and undo
 * handling as renameTaskTitle.
 */
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
      data: completeSearchableContentUpdate("Task", task as unknown as Record<string, unknown>, {
        description: nextDescription,
        calendarUrl,
        undatedNudgeCount: 0
      })
    });
  });
  return refreshCalendarState(userId, updated);
}

/**
 * Adds assignees parsed from @mentions or names, keeping existing ones. The first
 * assignee is mirrored into the single-assignee assigned* columns, which other code still reads.
 */
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
        assignedDisplayName: primary?.displayName,
        audience: TaskAudience.ASSIGNEES,
        undatedNudgeCount: 0
      },
      include: { assignees: true }
    });
  });
}

/**
 * Removes the named assignees, or all of them when none are named. The task
 * becomes UNASSIGNED (claimable in a group) once nobody is left.
 */
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
        assignedDisplayName: primary?.displayName ?? null,
        audience: primary ? TaskAudience.ASSIGNEES : TaskAudience.UNASSIGNED,
        undatedNudgeCount: 0
      },
      include: { assignees: true }
    });
  });
}

/**
 * Sets a new due time from text, or clears it for "none" / "clear". Resets
 * reminder counters so the new deadline gets a fresh reminder sequence, and
 * records an undo entry.
 */
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
  const nextReminderAt = initialTaskReminderAt({
    now,
    dueAt,
    dueNudgeMinutes: settings.dueNudgeMinutes,
    intervalMinutes: settings.reminderIntervalMinutes,
  });
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
        undatedNudgeCount: 0,
        automaticReminderCount: 0,
        remindersDismissedAt: null,
        recurrenceDayOfMonth: recurrenceDayOfMonth(dueAt ?? undefined, task.recurrenceRule ?? undefined, settings.timezone) ?? null
      }
    });
  });
  return refreshCalendarState(userId, updated);
}

/**
 * Silences all further reminders for a task without completing it ("stop
 * reminding me"). Pending custom reminders are cancelled too.
 */
export async function dismissTaskReminders(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  const dismissedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await cancelPendingTaskReminderSchedules(tx, task.id);
    return tx.task.update({
      where: { id: task.id },
      data: { nextReminderAt: null, snoozedUntil: null, remindersDismissedAt: dismissedAt },
    });
  });
}

/**
 * Finds an unarchived task by row id or public id within this owner's data.
 * Throws when not found.
 */
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

/**
 * Runs Google Calendar sync best effort and re-reads the task only when the sync
 * changed the stored event fields.
 */
async function refreshCalendarState(userId: string, task: TaskListItem): Promise<TaskListItem> {
  const outcome = await syncTaskCalendarBestEffort(userId, task);
  if (outcome !== "synced" && outcome !== "removed") return task;
  return prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    include: { assignees: true }
  });
}

/**
 * Resolves what a user typed or a button carried: a positive number is the
 * position in the current open list, anything else is a public id or row id.
 */
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

/**
 * Display order for task lists: pinned (newest pin first), then tasks with a due
 * date (soonest first), then undated tasks by creation time.
 */
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

/** Full Telegram HTML confirmation card for a newly saved task. */
export function formatTaskCreated(
  task: {
    publicId: string;
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    assignedUsername?: string | null;
    assignedDisplayName?: string | null;
    teamOwnerLabel?: string | null;
    assignees?: TaskAssigneeInfo[];
    audience?: TaskAudience;
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
      task.audience === TaskAudience.EVERYONE ? field("For", "Everyone") : hasAssignees(task) ? fieldHtml("Assigned To", formatAssigneeHtml(task)) : undefined,
      task.teamOwnerLabel ? field("Team Owner", task.teamOwnerLabel) : undefined,
      task.recurrenceRule ? field("Repeats", formatRecurrence(task.recurrenceRule)) : undefined
    ].filter(Boolean).join("\n"),
    taskAssistantLine(task.publicId, Boolean(task.dueAt)),
    hasAssignees(task)
      ? "Want private deadline nudges too? Each assignee can open Threadwise privately and send /settings dm on."
      : undefined
  ]);
}

/**
 * Short "Saved" reply that only shows what was understood (time, repeat,
 * assignees), for flows where a full card would be noise.
 */
export function formatTaskSavedAcknowledgement(
  task: {
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    assignedUsername?: string | null;
    assignedDisplayName?: string | null;
    teamOwnerLabel?: string | null;
    assignees?: TaskAssigneeInfo[];
    audience?: TaskAudience;
    recurrenceRule?: RecurrenceRule | null;
  },
  fallbackTimezone = "UTC"
): string {
  const timezone = task.timezone ?? fallbackTimezone;
  const interpretation = [
    task.dueAt ? field("When", formatDateTimeForUser(task.dueAt, timezone)) : undefined,
    task.recurrenceRule ? field("Repeats", formatRecurrence(task.recurrenceRule)) : undefined,
    task.audience === TaskAudience.EVERYONE ? field("For", "Everyone") : hasAssignees(task) ? fieldHtml("For", formatAssigneeHtml(task)) : undefined,
    task.teamOwnerLabel ? field("Team Owner", task.teamOwnerLabel) : undefined
  ].filter(Boolean).join("\n");

  return joinBlocks([
    `${bold("Saved")} · ${h(task.title)}`,
    interpretation || undefined
  ]);
}

/**
 * Completion reply. Recurring tasks say which occurrence was done and when the
 * next one is due.
 */
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

/**
 * Soft-deletes a task (archivedAt) instead of removing the row, so public ids
 * are never reused and /undo can restore it. Removes the Google Calendar event
 * first and cancels pending reminders.
 */
export async function archiveTask(userId: string, reference: string) {
  const task = await findTaskReference(userId, reference);
  if (task.calendarEventId) await removeTaskFromGoogleCalendar(userId, task);
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
    await cancelPendingTaskReminderSchedules(tx, task.id);
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

/** Plain-text assignee list, falling back to the legacy single-assignee columns. */
export function formatAssignee(task: { audience?: TaskAudience; assignees?: TaskAssigneeInfo[]; assignedUsername?: string | null; assignedDisplayName?: string | null }): string {
  if (task.audience === TaskAudience.EVERYONE) return "Everyone";
  const assignees = task.assignees?.length
    ? task.assignees
    : task.assignedUsername || task.assignedDisplayName
      ? [{ username: task.assignedUsername, displayName: task.assignedDisplayName }]
      : [];
  return assignees.length ? assignees.map(formatOneAssignee).join(", ") : "Unassigned";
}

/**
 * HTML assignee list. People without a username get a tg://user link when their
 * Telegram id is known.
 */
export function formatAssigneeHtml(task: { audience?: TaskAudience; assignees?: TaskAssigneeInfo[]; assignedUsername?: string | null; assignedDisplayName?: string | null }): string {
  if (task.audience === TaskAudience.EVERYONE) return "Everyone";
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

/**
 * Separates assignees from the task text. Explicit options.assignees win.
 * Otherwise "@alex to buy milk" style prefixes become assignees, and leading
 * @mentions are stripped from the title.
 */
export function prepareTaskInput(sourceText: string, options: TaskCreationOptions): { text: string; assignees: ParsedAssignee[] } {
  if (options.assignees !== undefined) {
    const assignees: ParsedAssignee[] = [];
    for (const assignee of options.assignees) addAssignee(assignees, assignee);
    return { text: sourceText, assignees };
  }
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

type ParsedAssignee = TaskCreationAssignee;

/**
 * Collects assignees from Telegram mention entities and @usernames in the text.
 * With allowPlainNames, plain names separated by commas or "and" also count
 * (words like "me" and "everyone" are excluded).
 */
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

/**
 * Row data for a new TaskAssignee. Assignment is immediate, so the status starts
 * as ACCEPTED.
 */
function assigneeCreateData(assignee: ParsedAssignee) {
  return {
    normalizedKey: assigneeKey(assignee),
    telegramId: assignee.telegramId,
    username: assignee.username,
    displayName: assignee.displayName,
    status: TaskAssigneeStatus.ACCEPTED,
    respondedAt: new Date(),
  };
}

/**
 * The one rule for TaskAssignee.normalizedKey, which the (taskId,
 * normalizedKey) unique index and every assignee match compare against:
 * Telegram id first, then lower-cased username, then lower-cased name.
 */
export function assigneeKey(assignee: TaskCreationAssignee): string {
  if (assignee.telegramId) return `id:${assignee.telegramId}`;
  if (assignee.username) return `username:${assignee.username.toLowerCase()}`;
  return `name:${(assignee.displayName ?? "unknown").toLowerCase()}`;
}

/**
 * Adds an assignee unless the same person is already in the list (by id,
 * username, or by name when neither is known).
 */
function addAssignee(assignees: ParsedAssignee[], assignee: ParsedAssignee): void {
  const label = assignee.displayName?.toLowerCase();
  const hasStableIdentity = Boolean(assignee.telegramId || assignee.username);
  if ((!assignee.telegramId && !assignee.username && !assignee.displayName) || assignees.some((item) =>
    assigneeKey(item) === assigneeKey(assignee)
    || Boolean(assignee.telegramId && item.telegramId === assignee.telegramId)
    || Boolean(assignee.username && item.username?.toLowerCase() === assignee.username.toLowerCase())
    || Boolean(!hasStableIdentity && !item.telegramId && !item.username && label && item.displayName?.toLowerCase() === label)
  )) return;
  assignees.push(assignee);
}

/**
 * True when a stored assignee row and a parsed assignee are the same person,
 * using the same matching order as addAssignee.
 */
function sameAssignee(left: TaskAssigneeInfo & { normalizedKey?: string }, right: ParsedAssignee): boolean {
  return left.normalizedKey === assigneeKey(right)
    || Boolean(right.telegramId && left.telegramId === right.telegramId)
    || Boolean(right.username && left.username?.toLowerCase() === right.username.toLowerCase())
    || Boolean(
      !left.telegramId
      && !left.username
      && !right.telegramId
      && !right.username
      && right.displayName
      && left.displayName?.toLowerCase() === right.displayName.toLowerCase()
    );
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

/** True when the task has any assignee in either the new or the legacy columns. */
export function hasAssignees(task: { assignees?: TaskAssigneeInfo[]; assignedUsername?: string | null; assignedDisplayName?: string | null }): boolean {
  return Boolean(task.assignees?.length || task.assignedUsername || task.assignedDisplayName);
}

/** Removes leading "@user," mentions from the task text once they are parsed as assignees. */
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

/**
 * Picks one closing line for the saved-task card. stableChoice keys on the public
 * id, so the same task always shows the same line.
 */
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
