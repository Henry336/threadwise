import { Bot } from "grammy";
import type { AiProvider } from "../ai/types";
import { allowedTelegramIds } from "../config/env";
import { logger } from "../logger";
import { claimTelegramUpdate } from "../services/telegramUpdates";
import { registerCallbacks } from "./callbacks";
import { registerCommands } from "./commands";
import { isGroupChat, isTelegramContextAllowed } from "./groupRouting";
import { registerNaturalLanguage } from "./naturalLanguage";

export function createThreadwiseBot(token: string, ai: AiProvider): Bot {
  const bot = new Bot(token);
  const allowlist = allowedTelegramIds();

  bot.use(async (ctx, next) => {
    if (!allowlist || allowlist.size === 0) {
      await next();
      return;
    }

    if (isTelegramContextAllowed(ctx, allowlist)) {
      await next();
      return;
    }

    const telegramId = ctx.from?.id ? String(ctx.from.id) : undefined;
    const chatId = ctx.chat?.id ? String(ctx.chat.id) : undefined;
    logger.warn("Blocked unauthorized Telegram context.", { telegramId, chatId });
    if (isGroupChat(ctx)) {
      return;
    }

    await ctx.reply("This Threadwise bot is private.");
  });

  bot.use(async (ctx, next) => {
    const shouldProcess = await claimTelegramUpdate(ctx.update.update_id);
    if (!shouldProcess) {
      logger.warn("Skipping duplicate Telegram update.", { updateId: ctx.update.update_id });
      return;
    }

    await next();
  });

  registerCommands(bot, ai);
  registerCallbacks(bot, ai);
  registerNaturalLanguage(bot, ai);

  bot.catch((error) => {
    logger.error("Bot update failed.", {
      error: String(error.error),
      updateId: error.ctx.update.update_id
    });
  });

  return bot;
}
