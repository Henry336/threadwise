import type { Bot } from "grammy";
import { RecurrenceRule, ReminderMode, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { formatDateTimeForUser, formatRecurrenceRule, isWithinQuietHours, nextQuietEnd, startOfUserDay } from "../utils/dates";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { field, fieldHtml, joinBlocks, stableChoice } from "../utils/messageFormat";
import { reminderActionsKeyboard } from "../bot/keyboards";
import type { TaskAssigneeInfo } from "./tasks";

export type ReminderRunSource = "initial" | "loop" | "manual";

export type ReminderDiagnostics = {
  source?: ReminderRunSource;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastError?: string;
  dueTasksFound: number;
  remindersSent: number;
  skippedMissingSettings: number;
  deferredForQuietHours: number;
  cappedByDailyLimit: number;
  failedDeliveries: number;
  directNudgesSent: number;
  directNudgesSkipped: number;
  directNudgeFailures: number;
};

let reminderDiagnostics: ReminderDiagnostics = {
  dueTasksFound: 0,
  remindersSent: 0,
  skippedMissingSettings: 0,
  deferredForQuietHours: 0,
  cappedByDailyLimit: 0,
  failedDeliveries: 0,
  directNudgesSent: 0,
  directNudgesSkipped: 0,
  directNudgeFailures: 0
};
let activeReminderRun: Promise<ReminderDiagnostics> | undefined;

export async function sendDueReminders(bot: Bot): Promise<number> {
  const result = await runReminderPass(bot, "manual");
  return result.remindersSent;
}

export function getReminderDiagnostics(): ReminderDiagnostics {
  return { ...reminderDiagnostics };
}

export async function runReminderPass(bot: Bot, source: ReminderRunSource = "manual"): Promise<ReminderDiagnostics> {
  if (activeReminderRun) {
    return activeReminderRun;
  }

  const run = runReminderPassOnce(bot, source);
  activeReminderRun = run;

  try {
    return await run;
  } finally {
    if (activeReminderRun === run) {
      activeReminderRun = undefined;
    }
  }
}

async function runReminderPassOnce(bot: Bot, source: ReminderRunSource): Promise<ReminderDiagnostics> {
  const now = new Date();
  const startedAt = now.toISOString();
  const run: ReminderDiagnostics = {
    source,
    lastStartedAt: startedAt,
    dueTasksFound: 0,
    remindersSent: 0,
    skippedMissingSettings: 0,
    deferredForQuietHours: 0,
    cappedByDailyLimit: 0,
    failedDeliveries: 0,
    directNudgesSent: 0,
    directNudgesSkipped: 0,
    directNudgeFailures: 0
  };

  try {
    const tasks = await prisma.task.findMany({
      where: {
        status: TaskStatus.OPEN,
        archivedAt: null,
        nextReminderAt: { lte: now },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }]
      },
      include: {
        user: { include: { settings: true } },
        assignees: true
      },
      take: 50,
      orderBy: { nextReminderAt: "asc" }
    });

    run.dueTasksFound = tasks.length;

    for (const task of tasks) {
      const settings = task.user.settings;
      if (!settings) {
        run.skippedMissingSettings += 1;
        logger.warn("Skipping reminder because user settings are missing.", { taskId: task.id });
        continue;
      }

      const isDueNudgeReminder = shouldUseDueNudgePolicy({
        dueAt: task.dueAt,
        nextReminderAt: task.nextReminderAt,
        dueNudgeMinutes: settings.dueNudgeMinutes,
        now
      });

      if (
        !isDueNudgeReminder &&
        isWithinQuietHours(now, { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd })
      ) {
        run.deferredForQuietHours += 1;
        await prisma.task.update({
          where: { id: task.id },
          data: { nextReminderAt: nextQuietEnd(now, { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd }) }
        });
        continue;
      }

      const remindersToday = await prisma.reminderDelivery.count({
        where: {
          userId: task.userId,
          sentAt: { gte: startOfUserDay(now, settings.timezone) }
        }
      });

      if (!isDueNudgeReminder && remindersToday >= settings.maxRemindersPerDay) {
        run.cappedByDailyLimit += 1;
        await prisma.task.update({
          where: { id: task.id },
          data: { nextReminderAt: new Date(now.getTime() + settings.reminderIntervalMinutes * 60_000) }
        });
        continue;
      }

      const chatId = settings.reminderChatId ?? task.user.telegramId;
      const message = formatReminderMessage(task, settings);
      const previousReminder = await prisma.reminderDelivery.findFirst({
        where: {
          taskId: task.id,
          chatId,
          messageId: { not: null }
        },
        orderBy: { sentAt: "desc" },
        select: { chatId: true, messageId: true }
      });

      try {
        const sentMessage = await bot.api.sendMessage(chatId, message, {
          ...HTML_REPLY,
          reply_markup: reminderActionsKeyboard(task)
        });

        const nextSchedule = nextTaskScheduleAfterDelivery({
          now,
          dueAt: task.dueAt,
          dueNudgeMinutes: settings.dueNudgeMinutes,
          intervalMinutes: settings.reminderIntervalMinutes
        });

        await prisma.$transaction([
          prisma.reminderDelivery.create({
            data: {
              userId: task.userId,
              taskId: task.id,
              chatId,
              messageId: String(sentMessage.message_id)
            }
          }),
          prisma.task.update({
            where: { id: task.id },
            data: {
              lastRemindedAt: now,
              reminderCount: { increment: 1 },
              reminderIntervalMinutes: settings.reminderIntervalMinutes,
              ...nextSchedule
            }
          })
        ]);

        run.remindersSent += 1;
        await deleteSupersededReminderMessage(bot, previousReminder, sentMessage.message_id, task.publicId);
        try {
          const direct = await sendDirectAssigneeNudges(bot, task);
          run.directNudgesSent += direct.sent;
          run.directNudgesSkipped += direct.skipped;
          run.directNudgeFailures += direct.failed;
        } catch (error) {
          run.directNudgeFailures += Math.max(1, task.assignees.length);
          logger.warn("Could not finish private assignee nudges after the group reminder was delivered.", { taskId: task.id, error: String(error) });
        }
      } catch (error) {
        run.failedDeliveries += 1;
        logger.error("Failed to send reminder.", { taskId: task.id, error: String(error) });
        await prisma.task.update({
          where: { id: task.id },
          data: { nextReminderAt: new Date(now.getTime() + 15 * 60_000) }
        });
      }
    }

    run.lastFinishedAt = new Date().toISOString();
    reminderDiagnostics = run;
    return run;
  } catch (error) {
    run.lastFinishedAt = new Date().toISOString();
    run.lastError = String(error);
    reminderDiagnostics = run;
    throw error;
  }
}

async function deleteSupersededReminderMessage(
  bot: Bot,
  previous: { chatId: string; messageId: string | null } | null,
  currentMessageId: number,
  taskPublicId: string
): Promise<void> {
  const previousMessageId = Number(previous?.messageId);
  if (!previous || !Number.isSafeInteger(previousMessageId) || previousMessageId <= 0 || previousMessageId === currentMessageId) {
    return;
  }

  try {
    await bot.api.deleteMessage(previous.chatId, previousMessageId);
  } catch (error) {
    // Reminder delivery must stay successful even when Telegram no longer allows
    // an older bot message to be removed.
    logger.info("Could not remove the superseded reminder message.", {
      taskId: taskPublicId,
      chatId: previous.chatId,
      messageId: previousMessageId,
      error: String(error)
    });
  }
}

async function sendDirectAssigneeNudges(bot: Bot, task: {
  publicId: string;
  title: string;
  dueAt?: Date | null;
  timezone?: string | null;
  assignees: TaskAssigneeInfo[];
  user: { telegramId: string; firstName?: string | null };
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!task.user.telegramId.startsWith("chat:")) return result;
  const deliveredTo = new Set<string>();
  for (const assignee of task.assignees) {
    const privateUser = await findDirectNudgeUser(assignee);
    if (!privateUser?.settings?.directNudgesEnabled || deliveredTo.has(privateUser.telegramId)) {
      result.skipped += 1;
      continue;
    }
    try {
      await bot.api.sendMessage(privateUser.telegramId, formatDirectAssigneeNudge(task), HTML_REPLY);
      deliveredTo.add(privateUser.telegramId);
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      logger.warn("Could not send an assignee DM nudge.", { taskId: task.publicId, telegramId: privateUser.telegramId, error: String(error) });
    }
  }
  return result;
}

async function findDirectNudgeUser(assignee: TaskAssigneeInfo) {
  if (assignee.telegramId) {
    return prisma.user.findUnique({ where: { telegramId: assignee.telegramId }, include: { settings: true } });
  }
  if (!assignee.username) return undefined;
  const matches = await prisma.user.findMany({
    where: { username: { equals: assignee.username, mode: "insensitive" } },
    include: { settings: true },
    take: 5
  });
  return matches.find((user) => /^\d+$/.test(user.telegramId));
}

export function formatDirectAssigneeNudge(task: {
  publicId: string;
  title: string;
  dueAt?: Date | null;
  timezone?: string | null;
  user: { firstName?: string | null };
}): string {
  return joinBlocks([
    bold("Private task nudge"),
    h(task.title),
    [
      task.user.firstName ? field("Group", task.user.firstName) : undefined,
      task.dueAt ? field("Due Date", formatDateTimeForUser(task.dueAt, task.timezone ?? "UTC")) : undefined,
      fieldHtml("Task ID", code(task.publicId))
    ].filter(Boolean).join("\n"),
    "Open the group to complete, snooze, or change this shared task. Send /settings dm off here anytime to stop private nudges."
  ]);
}

export function formatReminderMessage(
  task: {
    publicId: string;
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    pinnedAt?: Date | null;
    assignedUsername?: string | null;
    assignedDisplayName?: string | null;
    assignees?: TaskAssigneeInfo[];
    recurrenceRule?: RecurrenceRule | null;
  },
  settings: {
    timezone: string;
    reminderMode: ReminderMode;
  }
): string {
  const metadata = [
    task.dueAt ? field("Due Date", formatDateTimeForUser(task.dueAt, task.timezone ?? settings.timezone)) : undefined,
    reminderAssignees(task).length > 0 ? fieldHtml("Assigned To", formatReminderAssigneesHtml(task)) : undefined,
    task.recurrenceRule ? field("Repeats", formatRecurrenceRule(task.recurrenceRule)) : undefined,
    fieldHtml("Task ID", code(task.publicId))
  ].filter(Boolean).join("\n");

  if (task.pinnedAt) {
    return joinBlocks([
      bold("Important task"),
      h(task.title),
      metadata,
      bold("Do this now, or snooze it intentionally.")
    ]);
  }

  if (settings.reminderMode === ReminderMode.DIGEST) {
    return joinBlocks([
      h(task.title),
      metadata,
      "Threadwise reminder."
    ]);
  }

  return joinBlocks([
    h(task.title),
    metadata,
    reminderAssistantLine(task.publicId)
  ]);
}

function reminderAssignees(task: {
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  assignees?: TaskAssigneeInfo[];
}): TaskAssigneeInfo[] {
  if (task.assignees?.length) return task.assignees;
  if (!task.assignedUsername && !task.assignedDisplayName) return [];
  return [{ username: task.assignedUsername, displayName: task.assignedDisplayName }];
}

function formatReminderAssigneesHtml(task: {
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  assignees?: TaskAssigneeInfo[];
}): string {
  return reminderAssignees(task).map((assignee) => {
    if (assignee.username) return h(`@${assignee.username}`);
    const label = assignee.displayName || "Telegram user";
    if (assignee.telegramId && /^\d+$/.test(assignee.telegramId)) {
      return `<a href="tg://user?id=${assignee.telegramId}">${h(label)}</a>`;
    }
    return h(label);
  }).join(", ");
}

function reminderAssistantLine(publicId: string): string {
  return stableChoice(publicId, [
    "I'll remind you when the time comes.",
    "I'll keep this on your radar until it is done.",
    "I'll make sure this stays visible until you complete it.",
    "I'll bring this back so it does not get buried."
  ]);
}

export function shouldBypassReminderLimits(task: { dueAt?: Date | null; lastRemindedAt?: Date | null; reminderCount: number }): boolean {
  return Boolean(task.dueAt && !task.lastRemindedAt && task.reminderCount === 0);
}

export function shouldUseDueNudgePolicy(task: {
  dueAt?: Date | null;
  nextReminderAt?: Date | null;
  dueNudgeMinutes: number;
  now: Date;
}): boolean {
  if (!task.dueAt || task.dueNudgeMinutes <= 0) {
    return false;
  }

  const nudgeStart = dueNudgeStartAt(task.dueAt, task.dueNudgeMinutes);
  return task.now >= nudgeStart;
}

export function nextIntervalReminderAt(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() + intervalMinutes * 60_000);
}

export function dueNudgeStartAt(dueAt: Date, dueNudgeMinutes: number): Date {
  return new Date(dueAt.getTime() - Math.max(0, dueNudgeMinutes) * 60_000);
}

export function nextDueReminderAt(dueAt: Date, dueNudgeMinutes: number, now: Date): Date {
  if (dueNudgeMinutes <= 0) {
    return dueAt;
  }

  const startAt = dueNudgeStartAt(dueAt, dueNudgeMinutes);
  return startAt.getTime() <= now.getTime() ? now : startAt;
}

export function nextReminderAtAfterDelivery(input: {
  now: Date;
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  intervalMinutes: number;
}): Date {
  if (input.dueAt && input.dueNudgeMinutes > 0 && input.now >= dueNudgeStartAt(input.dueAt, input.dueNudgeMinutes)) {
    return nextIntervalReminderAt(input.now, input.dueNudgeMinutes);
  }

  return nextIntervalReminderAt(input.now, input.intervalMinutes);
}

export function nextTaskScheduleAfterDelivery(input: {
  now: Date;
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  intervalMinutes: number;
}): { nextReminderAt: Date } {
  return {
    nextReminderAt: nextReminderAtAfterDelivery(input)
  };
}

export function nextReminderAfterSettingChange(task: {
  dueAt?: Date | null;
  nextReminderAt?: Date | null;
  lastRemindedAt?: Date | null;
  reminderCount: number;
}, now: Date, intervalMinutes: number, dueNudgeMinutes = 0): Date {
  const nextInterval = nextIntervalReminderAt(now, intervalMinutes);

  if (shouldBypassReminderLimits(task) && task.dueAt && task.dueAt.getTime() > now.getTime()) {
    return nextDueReminderAt(task.dueAt, dueNudgeMinutes, now);
  }

  if (task.dueAt && dueNudgeMinutes > 0 && task.dueAt.getTime() > now.getTime()) {
    const dueNudge = nextDueReminderAt(task.dueAt, dueNudgeMinutes, now);
    if (!task.nextReminderAt || task.nextReminderAt.getTime() > dueNudge.getTime()) {
      return dueNudge;
    }
  }

  if (task.dueAt && dueNudgeMinutes > 0 && now >= dueNudgeStartAt(task.dueAt, dueNudgeMinutes)) {
    const nextDueNudge = nextIntervalReminderAt(now, dueNudgeMinutes);
    if (!task.nextReminderAt || task.nextReminderAt.getTime() > nextDueNudge.getTime()) {
      return nextDueNudge;
    }
  }

  if (!task.nextReminderAt || task.nextReminderAt.getTime() > nextInterval.getTime()) {
    return nextInterval;
  }

  return task.nextReminderAt;
}

export function startReminderLoop(bot: Bot, pollMs: number): NodeJS.Timeout {
  const interval = setInterval(() => {
    runReminderPass(bot, "loop").catch((error) => logger.error("Reminder loop failed.", { error: String(error) }));
  }, pollMs);

  void runReminderPass(bot, "initial").catch((error) => logger.error("Initial reminder pass failed.", { error: String(error) }));
  return interval;
}
