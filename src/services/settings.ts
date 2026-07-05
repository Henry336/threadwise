import { ReminderMode } from "@prisma/client";
import { prisma } from "../db/prisma";

export type SettingsUpdateResult = {
  message: string;
};

export async function updateSetting(userId: string, args: string[]): Promise<SettingsUpdateResult> {
  const [field, ...rest] = args;
  const value = rest.join(" ").trim();

  if (!field) {
    return { message: "Usage: /settings interval 180, /settings timezone Asia/Singapore, /settings quiet 22:00 08:00, /settings max 5, /settings digest on" };
  }

  if (field === "interval") {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 15) {
      return { message: "Reminder interval must be an integer of at least 15 minutes." };
    }

    await prisma.userSettings.update({ where: { userId }, data: { reminderIntervalMinutes: minutes } });
    return { message: `Reminder interval set to ${minutes} minutes.` };
  }

  if (field === "timezone") {
    if (!value) {
      return { message: "Usage: /settings timezone Asia/Singapore" };
    }

    await prisma.userSettings.update({ where: { userId }, data: { timezone: value } });
    return { message: `Timezone set to ${value}.` };
  }

  if (field === "quiet") {
    const [start, end] = rest;
    if (!start || !end || !/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
      return { message: "Usage: /settings quiet 22:00 08:00" };
    }

    await prisma.userSettings.update({ where: { userId }, data: { quietHoursStart: start, quietHoursEnd: end } });
    return { message: `Quiet hours set to ${start}-${end}.` };
  }

  if (field === "max") {
    const max = Number(value);
    if (!Number.isInteger(max) || max < 1) {
      return { message: "Max reminders per day must be at least 1." };
    }

    await prisma.userSettings.update({ where: { userId }, data: { maxRemindersPerDay: max } });
    return { message: `Max reminders per day set to ${max}.` };
  }

  if (field === "digest") {
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
    "Threadwise settings",
    `Reminder interval: ${settings.reminderIntervalMinutes} minutes`,
    `Timezone: ${settings.timezone}`,
    `Quiet hours: ${settings.quietHoursStart ?? "off"}-${settings.quietHoursEnd ?? "off"}`,
    `Max reminders/day: ${settings.maxRemindersPerDay}`,
    `Reminder mode: ${settings.reminderMode.toLowerCase()}`,
    "",
    "Examples:",
    "/settings interval 180",
    "/settings timezone Asia/Singapore",
    "/settings quiet 22:00 08:00",
    "/settings max 5",
    "/settings digest on"
  ].join("\n");
}

