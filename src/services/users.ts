import type { Context } from "grammy";
import { env } from "../config/env";
import { prisma } from "../db/prisma";

export async function ensureUser(ctx: Context) {
  const from = ctx.from;
  if (!from) {
    throw new Error("Telegram update does not include a user.");
  }

  const telegramId = String(from.id);
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
          timezone: env.DEFAULT_TIMEZONE,
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
        timezone: env.DEFAULT_TIMEZONE,
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

