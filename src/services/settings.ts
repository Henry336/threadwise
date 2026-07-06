import { Prisma, TaskStatus } from "@prisma/client";
import { bold, code, h } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextReminderAfterSettingChange } from "./reminders";
import { formatTimezoneExamples, parseTimezone } from "../utils/timezones";

export type SettingsUpdateResult = {
  message: string;
};

export async function updateSetting(userId: string, args: string[]): Promise<SettingsUpdateResult> {
  const [field, ...rest] = args;
  const setting = field?.toLowerCase();
  const value = rest.join(" ").trim();

  if (!setting) {
    return {
      message:
        "Try /settings interval 180, /settings due-nudge 3, /settings timezone Asia/Singapore, /settings quiet 22:00 08:00, /settings quiet off, or /settings max 5."
    };
  }

  if (setting === "interval") {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 15) {
      return { message: "Pick a whole-number reminder interval of at least 15 minutes." };
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.userSettings.findUniqueOrThrow({ where: { userId } });
      const recommendedMax = recommendedMaxForInterval(minutes);
      const raisedMax = Boolean(recommendedMax && existing.maxRemindersPerDay < recommendedMax);
      const maxRemindersPerDay = raisedMax && recommendedMax ? recommendedMax : existing.maxRemindersPerDay;

      await tx.userSettings.update({
        where: { userId },
        data: {
          reminderIntervalMinutes: minutes,
          maxRemindersPerDay
        }
      });

      const updatedTasks = await rescheduleOpenTasksForSettings(tx, userId, {
        intervalMinutes: minutes,
        dueNudgeMinutes: existing.dueNudgeMinutes
      });
      return { updatedTasks, raisedMax, maxRemindersPerDay };
    });

    const maxNote = result.raisedMax ? ` Daily cap raised to ${result.maxRemindersPerDay} so the short interval can actually repeat.` : "";
    return { message: `Reminder interval set to ${minutes} minutes. Updated ${result.updatedTasks} open task${result.updatedTasks === 1 ? "" : "s"}.${maxNote}` };
  }

  if (setting === "timezone") {
    if (!value) {
      return { message: `Send it like this: /settings timezone Asia/Singapore\nExamples: ${formatTimezoneExamples()}` };
    }

    const parsed = parseTimezone(value);
    if (!parsed.ok) {
      const suggestion = parsed.suggestion ? ` Did you mean ${parsed.suggestion}?` : "";
      return { message: `I don't recognize that timezone.${suggestion}\nUse an IANA timezone like ${formatTimezoneExamples()}.` };
    }

    const result = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.update({ where: { userId }, data: { timezone: parsed.timezone } });
      return rescheduleOpenTasksForSettings(tx, userId, {
        intervalMinutes: settings.reminderIntervalMinutes,
        dueNudgeMinutes: settings.dueNudgeMinutes,
        timezone: settings.timezone
      });
    });

    const aliasNote = parsed.wasAlias ? ` (${value} -> ${parsed.timezone})` : "";
    return { message: `Timezone set to ${parsed.timezone}${aliasNote}. Rechecked ${result} open task${result === 1 ? "" : "s"} for reminders.` };
  }

  if (setting === "quiet") {
    if (value.toLowerCase() === "off") {
      const updatedTasks = await prisma.$transaction(async (tx) => {
        const settings = await tx.userSettings.update({ where: { userId }, data: { quietHoursStart: null, quietHoursEnd: null } });
        return rescheduleOpenTasksForSettings(tx, userId, settings);
      });

      return { message: `Quiet hours turned off. Rechecked ${updatedTasks} open task${updatedTasks === 1 ? "" : "s"} for reminders.` };
    }

    const [start, end] = rest;
    if (!start || !end || !isValidClock(start) || !isValidClock(end)) {
      return { message: "Send it like this: /settings quiet 22:00 08:00 or /settings quiet off" };
    }

    const updatedTasks = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.update({ where: { userId }, data: { quietHoursStart: start, quietHoursEnd: end } });
      return rescheduleOpenTasksForSettings(tx, userId, settings);
    });
    return { message: `Quiet hours set to ${start}-${end}. Rechecked ${updatedTasks} open task${updatedTasks === 1 ? "" : "s"} for reminders.` };
  }

  if (setting === "max") {
    const max = Number(value);
    if (!Number.isInteger(max) || max < 1) {
      return { message: "Pick at least 1 reminder per day." };
    }

    await prisma.userSettings.update({ where: { userId }, data: { maxRemindersPerDay: max } });
    return { message: `Max reminders per day set to ${max}.` };
  }

  if (setting === "due-nudge" || setting === "duenudge" || setting === "nudge") {
    if (value.toLowerCase() === "off") {
      const updatedTasks = await prisma.$transaction(async (tx) => {
        const settings = await tx.userSettings.update({ where: { userId }, data: { dueNudgeMinutes: 0 } });
        return rescheduleOpenTasksForSettings(tx, userId, settings);
      });

      return { message: `Due nudges turned off. Rechecked ${updatedTasks} open task${updatedTasks === 1 ? "" : "s"}.` };
    }

    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1) {
      return { message: "Pick a whole-number due nudge of at least 1 minute, or use /settings due-nudge off." };
    }

    const updatedTasks = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.update({ where: { userId }, data: { dueNudgeMinutes: minutes } });
      return rescheduleOpenTasksForSettings(tx, userId, settings);
    });

    return { message: `Due nudge set to ${minutes} minutes. Dated tasks start nudging ${minutes} minutes before they are due and repeat until done.` };
  }

  if (setting === "digest" || setting === "compact") {
    return { message: "That reminder display setting is not exposed right now. Use /settings interval, /settings due-nudge, /settings quiet, or /settings timezone." };
  }

  return { message: `I don't know the setting "${field}" yet. Try /settings for examples.` };
}

export async function formatSettings(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
  return [
    bold("Threadwise settings"),
    `${bold("Reminder interval")} ${settings.reminderIntervalMinutes} minutes`,
    `${bold("Timezone")} ${h(settings.timezone)}`,
    `${bold("Quiet hours")} ${h(settings.quietHoursStart && settings.quietHoursEnd ? `${settings.quietHoursStart}-${settings.quietHoursEnd}` : "off")}`,
    `${bold("Max reminders/day")} ${settings.maxRemindersPerDay}`,
    `${bold("Due nudge")} ${settings.dueNudgeMinutes > 0 ? `${settings.dueNudgeMinutes} minutes` : "off"}`,
    reminderCapacityWarning(settings.reminderIntervalMinutes, settings.maxRemindersPerDay),
    "",
    bold("Examples"),
    code("/settings interval 180"),
    code("/settings timezone Asia/Singapore"),
    code("/settings timezone Asia/Yangon"),
    code("/settings timezone America/New_York"),
    code("/settings quiet 22:00 08:00"),
    code("/settings quiet off"),
    code("/settings max 5"),
    code("/settings due-nudge 3")
  ].join("\n");
}

async function rescheduleOpenTasksForSettings(
  tx: Prisma.TransactionClient,
  userId: string,
  settings: {
    reminderIntervalMinutes?: number;
    intervalMinutes?: number;
    dueNudgeMinutes: number;
    timezone?: string;
  }
): Promise<number> {
  const now = new Date();
  const intervalMinutes = settings.intervalMinutes ?? settings.reminderIntervalMinutes;
  if (!intervalMinutes) {
    throw new Error("Missing reminder interval.");
  }

  const tasks = await tx.task.findMany({
    where: { userId, status: TaskStatus.OPEN, archivedAt: null },
    select: {
      id: true,
      dueAt: true,
      nextReminderAt: true,
      lastRemindedAt: true,
      reminderCount: true
    }
  });

  for (const task of tasks) {
    await tx.task.update({
      where: { id: task.id },
      data: {
        reminderIntervalMinutes: intervalMinutes,
        timezone: settings.timezone,
        nextReminderAt: nextReminderAfterSettingChange(task, now, intervalMinutes, settings.dueNudgeMinutes)
      }
    });
  }

  return tasks.length;
}

function reminderCapacityWarning(intervalMinutes: number, maxRemindersPerDay: number): string | undefined {
  if (intervalMinutes > 30 || maxRemindersPerDay > 10) {
    return undefined;
  }

  const coveredMinutes = intervalMinutes * maxRemindersPerDay;
  const coveredHours = Math.round((coveredMinutes / 60) * 10) / 10;
  return `${bold("Reminder cap note")} ${h(`${maxRemindersPerDay} reminders at ${intervalMinutes} minutes covers about ${coveredHours} hours/day.`)}`;
}

function recommendedMaxForInterval(intervalMinutes: number): number | undefined {
  if (intervalMinutes > 30) {
    return undefined;
  }

  return Math.ceil((12 * 60) / intervalMinutes);
}

function isValidClock(value: string): boolean {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match?.[1] || !match[2]) {
    return false;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
