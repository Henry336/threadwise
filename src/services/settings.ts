import { Prisma, ReminderMode, TaskStatus } from "@prisma/client";
import { bold, h } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextReminderAfterSettingChange } from "./reminders";
import { formatTimezoneExamples, parseTimezone } from "../utils/timezones";
import { COMMON_CURRENCIES, defaultCurrencyForTimezone, normalizeCurrency } from "../utils/currencies";
import { formatOcrLanguages, normalizeOcrLanguages } from "../utils/ocrLanguages";

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
        "Try: set my expense currency to MMK, read images in Burmese, change timezone to Myanmar, remind me again every 3 hours, or quiet hours off."
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

    const maxNote = result.raisedMax ? ` Daily reminder safety limit raised to ${result.maxRemindersPerDay} so frequent reminders can actually repeat.` : "";
    return { message: `Open tasks will remind you again every ${minutes} minutes until they are done. Updated ${result.updatedTasks} open task${result.updatedTasks === 1 ? "" : "s"}.${maxNote}` };
  }

  if (setting === "timezone") {
    if (!value) {
      return { message: `Send it like this: change timezone to Singapore, change timezone to Myanmar, or /settings timezone Asia/Singapore\nExamples: ${formatTimezoneExamples()}` };
    }

    const parsed = parseTimezone(value);
    if (!parsed.ok) {
      const suggestion = parsed.suggestion ? ` Did you mean ${parsed.suggestion}?` : "";
      return { message: `I don't recognize that timezone.${suggestion}\nTry a country/city name like Myanmar, Yangon, Singapore, or Malaysia. IANA names like ${formatTimezoneExamples()} also work.` };
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.userSettings.findUniqueOrThrow({ where: { userId } });
      const followsRegionalDefault = existing.expenseCurrency === defaultCurrencyForTimezone(existing.timezone);
      const settings = await tx.userSettings.update({
        where: { userId },
        data: {
          timezone: parsed.timezone,
          expenseCurrency: followsRegionalDefault ? defaultCurrencyForTimezone(parsed.timezone) : existing.expenseCurrency
        }
      });
      return rescheduleOpenTasksForSettings(tx, userId, {
        intervalMinutes: settings.reminderIntervalMinutes,
        dueNudgeMinutes: settings.dueNudgeMinutes,
        timezone: settings.timezone
      });
    });

    const aliasNote = parsed.wasAlias ? ` (${value} -> ${parsed.timezone})` : "";
    return { message: `Timezone set to ${parsed.timezone}${aliasNote}. Rechecked ${result} open task${result === 1 ? "" : "s"} for reminders. Your expense currency follows the new region unless you previously chose a custom currency.` };
  }

  if (setting === "currency" || setting === "expense-currency") {
    const currency = normalizeCurrency(value);
    if (!currency) {
      return { message: `I don't recognize that currency. Try an ISO code or name such as SGD, USD, MMK/kyat, MYR/ringgit, THB/baht, EUR, GBP, JPY, or INR. Common codes: ${COMMON_CURRENCIES.join(", ")}.` };
    }
    await prisma.userSettings.update({ where: { userId }, data: { expenseCurrency: currency } });
    return { message: `Default expense currency set to ${currency}. You can still specify a different currency in any expense or receipt correction.` };
  }

  if (setting === "ocr" || setting === "ocr-language" || setting === "image-language") {
    const languages = normalizeOcrLanguages(value);
    if (!languages) {
      return { message: "Choose English, Burmese, or English + Burmese. Try: /settings ocr Burmese" };
    }
    await prisma.userSettings.update({ where: { userId }, data: { ocrLanguages: languages } });
    return { message: `Image text extraction set to ${formatOcrLanguages(languages)}. This uses bundled local OCR and no API key.` };
  }

  if (setting === "dm" || setting === "direct-nudges" || setting === "private-nudges") {
    const enabled = /^(?:on|yes|enable|enabled|true)$/i.test(value)
      ? true
      : /^(?:off|no|disable|disabled|false)$/i.test(value)
        ? false
        : undefined;
    if (enabled === undefined) {
      return { message: "Choose on or off. Try: /settings dm on" };
    }
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (owner.telegramId.startsWith("chat:")) {
      return { message: "Private nudges are a personal setting. Open Threadwise in a private chat and send /settings dm on." };
    }
    await prisma.userSettings.update({ where: { userId }, data: { directNudgesEnabled: enabled } });
    return { message: enabled
      ? "Private assignee nudges are on. When a group task assigned to you is due, Threadwise will also DM you."
      : "Private assignee nudges are off. Group reminders will continue normally." };
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
    return { message: `Daily reminder safety limit set to ${max}. This only caps reminder messages; normal commands and saved items still work.` };
  }

  if (setting === "due-nudge" || setting === "duenudge" || setting === "nudge") {
    if (value.toLowerCase() === "off") {
      const updatedTasks = await prisma.$transaction(async (tx) => {
        const settings = await tx.userSettings.update({ where: { userId }, data: { dueNudgeMinutes: 0 } });
        return rescheduleOpenTasksForSettings(tx, userId, settings);
      });

      return { message: `Early warnings for exact-time reminders are off. Rechecked ${updatedTasks} open task${updatedTasks === 1 ? "" : "s"}.` };
    }

    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1) {
      return { message: "Pick a whole number of minutes for early warnings, or say: turn due nudge off." };
    }

    const updatedTasks = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.update({ where: { userId }, data: { dueNudgeMinutes: minutes } });
      return rescheduleOpenTasksForSettings(tx, userId, settings);
    });

    return { message: `Exact-time reminders will start warning you ${minutes} minutes before they are due, then keep reminding until done.` };
  }

  if (setting === "mode" || setting === "digest" || setting === "compact") {
    const requested = setting === "digest" || setting === "compact" ? setting : value.toLowerCase();
    const reminderMode = ["digest", "compact"].includes(requested)
      ? ReminderMode.DIGEST
      : ["individual", "normal", "full", "detailed"].includes(requested)
        ? ReminderMode.INDIVIDUAL
        : undefined;
    if (!reminderMode) {
      return { message: "Choose compact or detailed reminders. Try: use compact reminders, or /settings mode detailed" };
    }
    await prisma.userSettings.update({ where: { userId }, data: { reminderMode } });
    return { message: reminderMode === ReminderMode.DIGEST ? "Reminder messages set to compact mode." : "Reminder messages set to detailed mode." };
  }

  return { message: `I don't know the setting "${field}" yet. Try /settings for examples.` };
}

export async function formatSettings(_userId: string): Promise<string> {
  return [
    bold("⚙️ Settings"),
    "Choose a section below. Changes apply immediately."
  ].join("\n");
}

export async function formatReminderSettings(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
  return [
    bold("⏰ Reminder settings"),
    `Repeat ${bold(formatMinutes(settings.reminderIntervalMinutes))} · ${settings.reminderMode === ReminderMode.DIGEST ? "compact" : "detailed"} messages`,
    `Quiet ${h(settings.quietHoursStart && settings.quietHoursEnd ? `${settings.quietHoursStart}–${settings.quietHoursEnd}` : "off")} · early warning ${settings.dueNudgeMinutes > 0 ? formatMinutes(settings.dueNudgeMinutes) : "off"}`,
    `Safety limit ${settings.maxRemindersPerDay}/day`,
    "Repeat controls how often unfinished tasks nudge you again."
  ].join("\n");
}

export async function formatRegionSettings(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
  return [
    bold("🌍 Region & language"),
    `${h(settings.timezone)} · ${bold(h(settings.expenseCurrency))}`,
    `Image text: ${h(formatOcrLanguages(settings.ocrLanguages))}`,
    `Private assignee nudges: ${settings.directNudgesEnabled ? "on" : "off"}`,
    "Timezone controls how Threadwise reads dates and reminder times."
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

function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}h`;
  }
  return `${minutes}m`;
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
