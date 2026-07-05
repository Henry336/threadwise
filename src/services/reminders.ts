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

    const isInitialScheduledReminder = shouldBypassReminderLimits({
      dueAt: task.dueAt,
      lastRemindedAt: task.lastRemindedAt,
      reminderCount: task.reminderCount
    });

    if (
      !isInitialScheduledReminder &&
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

    if (!isInitialScheduledReminder && remindersToday >= settings.maxRemindersPerDay) {
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
        : `${bold("Still open")} ${code(task.publicId)}\n\n${h(task.title)}${dueLine}\n\nI'll keep nudging you until this is done.`;

    try {
      const sentMessage = await bot.api.sendMessage(chatId, message, {
        ...HTML_REPLY,
        reply_markup: taskActionsKeyboard(task.id)
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
            nextReminderAt: new Date(now.getTime() + (task.reminderIntervalMinutes ?? settings.reminderIntervalMinutes) * 60_000)
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

export function startReminderLoop(bot: Bot, pollMs: number): NodeJS.Timeout {
  const interval = setInterval(() => {
    sendDueReminders(bot).catch((error) => logger.error("Reminder loop failed.", { error: String(error) }));
  }, pollMs);

  void sendDueReminders(bot).catch((error) => logger.error("Initial reminder pass failed.", { error: String(error) }));
  return interval;
}
