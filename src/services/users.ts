import type { Context } from "grammy";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { defaultCurrencyForTimezone } from "../utils/currencies";
import { recordGroupWorkspaceAccess } from "./groupWorkspaces";

export async function ensureUser(ctx: Context) {
  const identity = threadwiseUserIdentity(ctx);
  const user = await prisma.user.upsert({
    where: { telegramId: identity.telegramId },
    update: {
      username: identity.username,
      firstName: identity.firstName,
      lastName: identity.lastName
    },
    create: {
      telegramId: identity.telegramId,
      username: identity.username,
      firstName: identity.firstName,
      lastName: identity.lastName,
      settings: {
        create: {
          timezone: identity.defaultTimezone,
          reminderIntervalMinutes: env.DEFAULT_REMINDER_INTERVAL_MINUTES,
          quietHoursStart: env.DEFAULT_QUIET_HOURS_START,
          quietHoursEnd: env.DEFAULT_QUIET_HOURS_END,
          reminderChatId: identity.reminderChatId,
          expenseCurrency: identity.defaultCurrency,
          ocrLanguages: identity.defaultOcrLanguages
        }
      }
    },
    include: { settings: true }
  });

  let readyUser = user;
  if (!user.settings) {
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        timezone: identity.defaultTimezone,
        reminderIntervalMinutes: env.DEFAULT_REMINDER_INTERVAL_MINUTES,
        quietHoursStart: env.DEFAULT_QUIET_HOURS_START,
        quietHoursEnd: env.DEFAULT_QUIET_HOURS_END,
        reminderChatId: identity.reminderChatId,
        expenseCurrency: identity.defaultCurrency,
        ocrLanguages: identity.defaultOcrLanguages
      }
    });

    readyUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { settings: true }
    });
  } else if (identity.isGroup && user.settings.reminderChatId !== identity.reminderChatId) {
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { reminderChatId: identity.reminderChatId }
    });

    readyUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { settings: true }
    });
  }

  if (identity.isGroup) await recordGroupWorkspaceAccess(ctx, readyUser.id);
  return readyUser;
}

type ThreadwiseUserIdentity = {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  defaultTimezone: string;
  reminderChatId: string;
  isGroup: boolean;
  defaultCurrency: string;
  defaultOcrLanguages: string;
};

export function threadwiseUserIdentity(ctx: Context): ThreadwiseUserIdentity {
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    const chatId = String(ctx.chat.id);
    return {
      telegramId: `chat:${chatId}`,
      username: "username" in ctx.chat ? ctx.chat.username : undefined,
      firstName: "title" in ctx.chat ? ctx.chat.title : "Group chat",
      lastName: undefined,
      defaultTimezone: env.DEFAULT_TIMEZONE,
      reminderChatId: chatId,
      isGroup: true,
      defaultCurrency: defaultCurrencyForTimezone(env.DEFAULT_TIMEZONE),
      defaultOcrLanguages: env.DEFAULT_TIMEZONE === "Asia/Yangon" ? "eng+mya" : "eng"
    };
  }

  const from = ctx.from;
  if (!from) {
    throw new Error("Telegram update does not include a user.");
  }

  const telegramId = String(from.id);
  const defaultTimezone = defaultTimezoneForTelegramLanguage(from.language_code) ?? env.DEFAULT_TIMEZONE;
  return {
    telegramId,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
    defaultTimezone,
    reminderChatId: ctx.chat ? String(ctx.chat.id) : telegramId,
    isGroup: false,
    defaultCurrency: defaultCurrencyForTimezone(defaultTimezone),
    defaultOcrLanguages: codeForOcr(from.language_code)
  };
}

function codeForOcr(languageCode?: string): string {
  return languageCode?.toLowerCase().split("-")[0] === "my" ? "eng+mya" : "eng";
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

