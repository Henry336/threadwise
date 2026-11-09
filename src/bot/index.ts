/**
 * Entry point of the Telegram bot layer. main.ts calls createThreadwiseBot once; the result
 * receives webhook updates from server.ts. This file only wires shared gates (group migration,
 * allowlist, addressing, duplicate updates, ephemeral ownership, undo actor) and then registers
 * each feature's handlers, which call into src/services for the actual work.
 */
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
import { callbackMatchesEphemeralReceiver, configureEphemeralTransport } from "./ephemeral";
import { registerNoteSessions } from "./noteSessions";
import { privateCodexScopeForContext, registerCodexMode } from "./codex";
import { registerGeminiIdeas } from "./geminiIdeas";
import { registerFileCourier } from "./files";
import { registerVoiceCapture } from "./voiceCapture";
import { registerTaskImports } from "./taskImports";
import { registerGroupTopics } from "./groupTopics";
import { registerStudyMode } from "./study";
import { shouldHandleStudyUpdate } from "../services/study";
import { handleTelegramGroupMigrationUpdate } from "../services/telegramChatMigrations";
import { hasOpenGroupImageUploadBatch } from "../services/imageUploadBatches";
import { registerTodayInteractions } from "./today";
import { withUndoActor } from "../services/undo";

/**
 * Builds the grammY bot. Middleware order is deliberate: gates run first, then feature handlers
 * in registration order. Earlier registrations (Today, note sessions, Study, commands) get the
 * first chance at a message, and natural language is last so it only sees what nothing else claimed.
 */
export function createThreadwiseBot(token: string, ai: AiProvider): Bot {
  const bot = new Bot(token);
  configureEphemeralTransport(token);
  const allowlist = allowedTelegramIds();

  // Telegram emits this service update when a basic group becomes a
  // supergroup. Process it before allowlisting/routing so stored reminders and
  // workspace identity do not remain attached to the retired chat ID.
  bot.use(async (ctx, next) => {
    if (await handleTelegramGroupMigrationUpdate(ctx)) return;
    await next();
  });

  // Optional private-bot allowlist (BOT_ALLOWED_TELEGRAM_IDS). Blocked groups are ignored silently
  // so the bot does not reveal itself in unrelated group chats.
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

  // Drop group messages not addressed to the bot (unless they are the Codex group, the Study group,
  // or later photos of an album already being captured), then claim the update id in the database
  // so a Telegram redelivery is processed only once.
  bot.use(async (ctx, next) => {
    if (!privateCodexScopeForContext(ctx) && !(await shouldHandleStudyUpdate(ctx)) && !shouldHandleGroupUpdate(ctx)) {
      const message = ctx.message;
      const mediaGroupId = message?.media_group_id;
      const isImage = Boolean(message && (
        "photo" in message
        || ("document" in message && message.document?.mime_type?.startsWith("image/"))
      ));
      const continuesOpenGroupAlbum = isGroupChat(ctx)
        && isImage
        && Boolean(mediaGroupId)
        && Boolean(ctx.chat?.id)
        && await hasOpenGroupImageUploadBatch(String(ctx.chat!.id), mediaGroupId!);
      if (!continuesOpenGroupAlbum) return;
    }

    const shouldProcess = await claimTelegramUpdate(ctx.update.update_id);
    if (!shouldProcess) {
      logger.warn("Skipping duplicate Telegram update.", { updateId: ctx.update.update_id });
      return;
    }

    await next();
  });

  // A private (receiver-bound) group menu may only be tapped by the member it was sent to.
  bot.use(async (ctx, next) => {
    if (!callbackMatchesEphemeralReceiver(ctx)) {
      await ctx.answerCallbackQuery({
        text: "This private Threadwise view belongs to someone else.",
        show_alert: true
      });
      return;
    }
    await next();
  });

  // Undo entries recorded while handling this update remember which member made the change.
  bot.use((ctx, next) => withUndoActor(ctx.from ? String(ctx.from.id) : undefined, next));

  registerTodayInteractions(bot);
  registerNoteSessions(bot);
  registerStudyMode(bot);
  registerCommands(bot, ai);
  registerFileCourier(bot);
  registerVoiceCapture(bot, token);
  registerCodexMode(bot);
  registerGeminiIdeas(bot);
  registerGroupScheduling(bot);
  registerGroupTopics(bot);
  registerTaskImports(bot);
  registerCallbacks(bot, ai);
  registerImageMessages(bot, ai, token);
  registerNaturalLanguage(bot, ai);
  // Keep stored group membership and the bot's own group role in sync with Telegram.
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    await updateGroupMemberFromTelegram(String(update.chat.id), update.new_chat_member.user, update.new_chat_member.status);
  });
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    await updateGroupBotStatus(String(update.chat.id), update.new_chat_member.status);
  });

  // Last-resort handler: log safe metadata only and send the user a friendly error.
  bot.catch(async (error) => {
    logger.error("Bot update failed.", {
      ...errorLogMetadata(error.error),
      updateId: error.ctx.update.update_id
    });
    await respondToUnhandledBotError(error.ctx, error.error);
  });

  return bot;
}
