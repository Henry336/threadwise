import type { Bot } from "grammy";
import { ReminderMode, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { formatDateTimeForUser, isWithinQuietHours, nextQuietEnd, startOfUserDay } from "../utils/dates";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { taskActionsKeyboard } from "../bot/keyboards";

export async function sendDueReminders(bot: Bot): Promise<number> {
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: {
      status: TaskStatus.OPEN,
      archivedAt: null,
      nextReminderAt: { lte: now },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }]
    },
    include: {
      user: { include: { settings: true } }
    },
    take: 50,
    orderBy: { nextReminderAt: "asc" }
  });

  let sent = 0;

  for (const task of tasks) {
    const settings = task.user.settings;
    if (!settings) {
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
      await prisma.task.update({
        where: { id: task.id },
        data: { nextReminderAt: new Date(now.getTime() + settings.reminderIntervalMinutes * 60_000) }
      });
      continue;
    }

    const chatId = settings.reminderChatId ?? task.user.telegramId;
    const dueLine = task.dueAt ? `\n${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, task.timezone ?? settings.timezone))}` : "";
    const message =
      settings.reminderMode === ReminderMode.DIGEST
        ? `${bold("Threadwise reminder")} ${code(task.publicId)}\n\n${h(task.title)}${dueLine}`
        : `${bold("Still open")} ${code(task.publicId)}\n\n${h(task.title)}${dueLine}\n\nI'll keep this on your radar until it is done.`;

    try {
      const sentMessage = await bot.api.sendMessage(chatId, message, {
        ...HTML_REPLY,
        reply_markup: taskActionsKeyboard(task)
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
            nextReminderAt: nextReminderAtAfterDelivery({
              now,
              dueAt: task.dueAt,
              dueNudgeMinutes: settings.dueNudgeMinutes,
              intervalMinutes: settings.reminderIntervalMinutes
            })
          }
        })
      ]);

      sent += 1;
    } catch (error) {
      logger.error("Failed to send reminder.", { taskId: task.id, error: String(error) });
      await prisma.task.update({
        where: { id: task.id },
        data: { nextReminderAt: new Date(now.getTime() + 15 * 60_000) }
      });
    }
  }

  return sent;
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
    sendDueReminders(bot).catch((error) => logger.error("Reminder loop failed.", { error: String(error) }));
  }, pollMs);

  void sendDueReminders(bot).catch((error) => logger.error("Initial reminder pass failed.", { error: String(error) }));
  return interval;
}
