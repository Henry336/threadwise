import { Prisma, ReminderMode, TaskStatus } from "@prisma/client";
import { bold, code, h } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextReminderAfterSettingChange } from "./reminders";

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
        "Try /settings interval 180, /settings due-nudge 3, /settings timezone Asia/Singapore, /settings quiet 22:00 08:00, /settings quiet off, /settings max 5, or /settings digest on."
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

      const updatedTasks = await rescheduleOpenTasksForInterval(tx, userId, minutes, existing.dueNudgeMinutes);
      return { updatedTasks, raisedMax, maxRemindersPerDay };
    });

    const maxNote = result.raisedMax ? ` Daily cap raised to ${result.maxRemindersPerDay} so the short interval can actually repeat.` : "";
    return { message: `Reminder interval set to ${minutes} minutes. Updated ${result.updatedTasks} open task${result.updatedTasks === 1 ? "" : "s"}.${maxNote}` };
  }

  if (setting === "timezone") {
    if (!value) {
      return { message: "Send it like this: /settings timezone Asia/Singapore" };
    }

    await prisma.userSettings.update({ where: { userId }, data: { timezone: value } });
    return { message: `Timezone set to ${value}.` };
  }

  if (setting === "quiet") {
    if (value.toLowerCase() === "off") {
      const updatedTasks = await prisma.$transaction(async (tx) => {
        const settings = await tx.userSettings.update({ where: { userId }, data: { quietHoursStart: null, quietHoursEnd: null } });
        return rescheduleOpenTasksForInterval(tx, userId, settings.reminderIntervalMinutes, settings.dueNudgeMinutes);
      });

      return { message: `Quiet hours turned off. Rechecked ${updatedTasks} open task${updatedTasks === 1 ? "" : "s"} for reminders.` };
    }

    const [start, end] = rest;
    if (!start || !end || !isValidClock(start) || !isValidClock(end)) {
      return { message: "Send it like this: /settings quiet 22:00 08:00 or /settings quiet off" };
    }

    await prisma.userSettings.update({ where: { userId }, data: { quietHoursStart: start, quietHoursEnd: end } });
    return { message: `Quiet hours set to ${start}-${end}.` };
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
        return rescheduleOpenTasksForInterval(tx, userId, settings.reminderIntervalMinutes, settings.dueNudgeMinutes);
      });

      return { message: `Due nudges turned off. Rechecked ${updatedTasks} open task${updatedTasks === 1 ? "" : "s"}.` };
    }

    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1) {
      return { message: "Pick a whole-number due nudge of at least 1 minute, or use /settings due-nudge off." };
    }

    const updatedTasks = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.update({ where: { userId }, data: { dueNudgeMinutes: minutes } });
      return rescheduleOpenTasksForInterval(tx, userId, settings.reminderIntervalMinutes, settings.dueNudgeMinutes);
    });

    return { message: `Due nudge set to ${minutes} minutes. Dated tasks start nudging ${minutes} minutes before they are due and repeat until done.` };
  }

  if (setting === "digest") {
    const enabled = value.toLowerCase() === "on";
    await prisma.userSettings.update({
      where: { userId },
      data: { reminderMode: enabled ? ReminderMode.DIGEST : ReminderMode.INDIVIDUAL }
    });
    return { message: `Digest reminders ${enabled ? "enabled" : "disabled"}.` };
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
    `${bold("Reminder mode")} ${h(settings.reminderMode.toLowerCase())}`,
    reminderCapacityWarning(settings.reminderIntervalMinutes, settings.maxRemindersPerDay),
    "",
    bold("Examples"),
    code("/settings interval 180"),
    code("/settings timezone Asia/Singapore"),
    code("/settings quiet 22:00 08:00"),
    code("/settings quiet off"),
    code("/settings max 5"),
    code("/settings due-nudge 3"),
    code("/settings digest on")
  ].join("\n");
}

async function rescheduleOpenTasksForInterval(
  tx: Prisma.TransactionClient,
  userId: string,
  intervalMinutes: number,
  dueNudgeMinutes: number
): Promise<number> {
  const now = new Date();
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
        nextReminderAt: nextReminderAfterSettingChange(task, now, intervalMinutes, dueNudgeMinutes)
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
