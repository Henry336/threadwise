import type { Bot } from "grammy";
import { ReminderMode, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { formatDateTimeForUser, isWithinQuietHours, nextQuietEnd, startOfUserDay } from "../utils/dates";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { taskActionsKeyboard } from "../bot/keyboards";

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
};

let reminderDiagnostics: ReminderDiagnostics = {
  dueTasksFound: 0,
  remindersSent: 0,
  skippedMissingSettings: 0,
  deferredForQuietHours: 0,
  cappedByDailyLimit: 0,
  failedDeliveries: 0
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
    failedDeliveries: 0
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
        user: { include: { settings: true } }
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

        run.remindersSent += 1;
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

export function formatReminderMessage(
  task: {
    publicId: string;
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    pinnedAt?: Date | null;
  },
  settings: {
    timezone: string;
    reminderMode: ReminderMode;
  }
): string {
  const dueLine = task.dueAt ? `${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, task.timezone ?? settings.timezone))}` : undefined;

  if (task.pinnedAt) {
    return [
      bold("❗ IMPORTANT TASK ❗"),
      `${code(task.publicId)} ${bold(task.title)}`,
      dueLine,
      bold("Do this now, or snooze it intentionally."),
      "❗ ❗ ❗"
    ].filter(Boolean).join("\n\n");
  }

  if (settings.reminderMode === ReminderMode.DIGEST) {
    return [`${bold("Threadwise reminder")} ${code(task.publicId)}`, h(task.title), dueLine].filter(Boolean).join("\n\n");
  }

  return [`${bold("Still open")} ${code(task.publicId)}`, h(task.title), dueLine, "I'll keep this on your radar until it is done."].filter(Boolean).join("\n\n");
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
    runReminderPass(bot, "loop").catch((error) => logger.error("Reminder loop failed.", { error: String(error) }));
  }, pollMs);

  void runReminderPass(bot, "initial").catch((error) => logger.error("Initial reminder pass failed.", { error: String(error) }));
  return interval;
}
