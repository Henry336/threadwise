import { Bot } from "grammy";
import type { AiProvider } from "../ai/types";
import { logger } from "../logger";
import { registerCallbacks } from "./callbacks";
import { registerCommands } from "./commands";
import { registerNaturalLanguage } from "./naturalLanguage";

export function createThreadwiseBot(token: string, ai: AiProvider): Bot {
  const bot = new Bot(token);

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

