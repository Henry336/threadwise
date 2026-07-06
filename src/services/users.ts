import type { Context } from "grammy";
import { env } from "../config/env";
import { prisma } from "../db/prisma";

export async function ensureUser(ctx: Context) {
  const from = ctx.from;
  if (!from) {
    throw new Error("Telegram update does not include a user.");
  }

  const telegramId = String(from.id);
  const defaultTimezone = defaultTimezoneForTelegramLanguage(from.language_code) ?? env.DEFAULT_TIMEZONE;
  const user = await prisma.user.upsert({
    where: { telegramId },
    update: {
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name
    },
    create: {
      telegramId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      settings: {
        create: {
          timezone: defaultTimezone,
          reminderIntervalMinutes: env.DEFAULT_REMINDER_INTERVAL_MINUTES,
          quietHoursStart: env.DEFAULT_QUIET_HOURS_START,
          quietHoursEnd: env.DEFAULT_QUIET_HOURS_END,
          reminderChatId: ctx.chat ? String(ctx.chat.id) : telegramId
        }
      }
    },
    include: { settings: true }
  });

  if (!user.settings) {
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        timezone: defaultTimezone,
        reminderIntervalMinutes: env.DEFAULT_REMINDER_INTERVAL_MINUTES,
        quietHoursStart: env.DEFAULT_QUIET_HOURS_START,
        quietHoursEnd: env.DEFAULT_QUIET_HOURS_END,
        reminderChatId: ctx.chat ? String(ctx.chat.id) : telegramId
      }
    });

    return prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { settings: true }
    });
  }

  return user;
}

export function defaultTimezoneForTelegramLanguage(languageCode?: string): string | undefined {
  const code = languageCode?.toLowerCase().split("-")[0];
  if (code === "my") {
    return "Asia/Yangon";
  }

  if (code === "ms") {
    return "Asia/Kuala_Lumpur";
  }

  return undefined;
}

