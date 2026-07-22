import { Bot } from "grammy";
import type { AiProvider } from "../ai/types";
import { allowedTelegramIds } from "../config/env";
import { logger } from "../logger";
import { claimTelegramUpdate } from "../services/telegramUpdates";
import { registerCallbacks } from "./callbacks";
import { registerCommands } from "./commands";
import { isGroupChat, isTelegramContextAllowed, shouldHandleGroupUpdate } from "./groupRouting";
import { registerNaturalLanguage } from "./naturalLanguage";
import { registerImageMessages } from "./imageMessages";
import { updateGroupBotStatus, updateGroupMemberFromTelegram } from "../services/groupWorkspaces";
import { errorLogMetadata, respondToUnhandledBotError } from "./errorResponses";
import { registerGroupScheduling } from "./scheduling";

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

    await ctx.reply("This Threadwise bot is private, so I can’t respond from this account.");
  });

  bot.use(async (ctx, next) => {
    if (!shouldHandleGroupUpdate(ctx)) {
      return;
    }

    const shouldProcess = await claimTelegramUpdate(ctx.update.update_id);
    if (!shouldProcess) {
      logger.warn("Skipping duplicate Telegram update.", { updateId: ctx.update.update_id });
      return;
    }

    await next();
  });

  registerCommands(bot, ai);
  registerGroupScheduling(bot);
  registerCallbacks(bot, ai);
  registerImageMessages(bot, ai, token);
  registerNaturalLanguage(bot, ai);
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    await updateGroupMemberFromTelegram(String(update.chat.id), update.new_chat_member.user, update.new_chat_member.status);
  });
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    await updateGroupBotStatus(String(update.chat.id), update.new_chat_member.status);
  });

  bot.catch(async (error) => {
    logger.error("Bot update failed.", {
      ...errorLogMetadata(error.error),
      updateId: error.ctx.update.update_id
    });
    await respondToUnhandledBotError(error.ctx, error.error);
  });

  return bot;
}
