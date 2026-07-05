import { Bot } from "grammy";
import type { AiProvider } from "../ai/types";
import { allowedTelegramIds } from "../config/env";
import { logger } from "../logger";
import { registerCallbacks } from "./callbacks";
import { registerCommands } from "./commands";
import { registerNaturalLanguage } from "./naturalLanguage";

export function createThreadwiseBot(token: string, ai: AiProvider): Bot {
  const bot = new Bot(token);
  const allowlist = allowedTelegramIds();

  bot.use(async (ctx, next) => {
    if (!allowlist || allowlist.size === 0) {
      await next();
      return;
    }

    const telegramId = ctx.from?.id ? String(ctx.from.id) : undefined;
    if (telegramId && allowlist.has(telegramId)) {
      await next();
      return;
    }

    logger.warn("Blocked unauthorized Telegram user.", { telegramId });
    await ctx.reply("This Threadwise bot is private.");
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
