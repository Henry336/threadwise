import { ReminderMode } from "@prisma/client";
import { bold, code, h } from "../utils/html";
import { prisma } from "../db/prisma";

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
        "Usage: /settings interval 180, /settings timezone Asia/Singapore, /settings quiet 22:00 08:00, /settings quiet off, /settings max 5, /settings digest on"
    };
  }

  if (setting === "interval") {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 15) {
      return { message: "Reminder interval must be an integer of at least 15 minutes." };
    }

    await prisma.userSettings.update({ where: { userId }, data: { reminderIntervalMinutes: minutes } });
    return { message: `Reminder interval set to ${minutes} minutes.` };
  }

  if (setting === "timezone") {
    if (!value) {
      return { message: "Usage: /settings timezone Asia/Singapore" };
    }

    await prisma.userSettings.update({ where: { userId }, data: { timezone: value } });
    return { message: `Timezone set to ${value}.` };
  }

  if (setting === "quiet") {
    if (value.toLowerCase() === "off") {
      await prisma.userSettings.update({ where: { userId }, data: { quietHoursStart: null, quietHoursEnd: null } });
      return { message: "Quiet hours turned off." };
    }

    const [start, end] = rest;
    if (!start || !end || !isValidClock(start) || !isValidClock(end)) {
      return { message: "Usage: /settings quiet 22:00 08:00 or /settings quiet off" };
    }

    await prisma.userSettings.update({ where: { userId }, data: { quietHoursStart: start, quietHoursEnd: end } });
    return { message: `Quiet hours set to ${start}-${end}.` };
  }

  if (setting === "max") {
    const max = Number(value);
    if (!Number.isInteger(max) || max < 1) {
      return { message: "Max reminders per day must be at least 1." };
    }

    await prisma.userSettings.update({ where: { userId }, data: { maxRemindersPerDay: max } });
    return { message: `Max reminders per day set to ${max}.` };
  }

  if (setting === "digest") {
    const enabled = value.toLowerCase() === "on";
    await prisma.userSettings.update({
      where: { userId },
      data: { reminderMode: enabled ? ReminderMode.DIGEST : ReminderMode.INDIVIDUAL }
    });
    return { message: `Digest reminders ${enabled ? "enabled" : "disabled"}.` };
  }

  return { message: `Unknown setting "${field}". Try /settings for examples.` };
}

export async function formatSettings(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
  return [
    bold("Threadwise settings"),
    `${bold("Reminder interval")} ${settings.reminderIntervalMinutes} minutes`,
    `${bold("Timezone")} ${h(settings.timezone)}`,
    `${bold("Quiet hours")} ${h(settings.quietHoursStart && settings.quietHoursEnd ? `${settings.quietHoursStart}-${settings.quietHoursEnd}` : "off")}`,
    `${bold("Max reminders/day")} ${settings.maxRemindersPerDay}`,
    `${bold("Reminder mode")} ${h(settings.reminderMode.toLowerCase())}`,
    "",
    bold("Examples"),
    code("/settings interval 180"),
    code("/settings timezone Asia/Singapore"),
    code("/settings quiet 22:00 08:00"),
    code("/settings quiet off"),
    code("/settings max 5"),
    code("/settings digest on")
  ].join("\n");
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
