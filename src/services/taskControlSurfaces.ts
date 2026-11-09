/**
 * Keeps one live task-list message ("control surface") per owner and chat.
 * Called from src/bot/callbacks.ts after a task button press redraws the list,
 * so older lists with stale buttons do not pile up in the chat.
 */
import type { Context } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { HTML_REPLY } from "../utils/html";

/**
 * Stores the current message as the owner's control surface for this chat and
 * retires the previous one. It tries to delete the old message first; if
 * Telegram refuses (for example the message is too old), it edits it to a short
 * notice with no buttons. Failures are logged and never block the user.
 */
export async function convergeTaskControlSurface(ctx: Context, userId: string, currentMessageId?: number): Promise<void> {
  const chatId = ctx.chat?.id;
  const messageId = currentMessageId ?? ctx.callbackQuery?.message?.message_id;
  if (!chatId || !messageId) return;

  const chatKey = String(chatId);
  const previous = await prisma.taskControlSurface.findUnique({
    where: { userId_chatId: { userId, chatId: chatKey } },
  });
  await prisma.taskControlSurface.upsert({
    where: { userId_chatId: { userId, chatId: chatKey } },
    update: { messageId: String(messageId) },
    create: { userId, chatId: chatKey, messageId: String(messageId) },
  });

  const previousMessageId = Number(previous?.messageId);
  if (!previous || !Number.isSafeInteger(previousMessageId) || previousMessageId <= 0 || previousMessageId === messageId) return;

  try {
    await ctx.api.deleteMessage(chatId, previousMessageId);
  } catch (deleteError) {
    try {
      await ctx.api.editMessageText(
        chatId,
        previousMessageId,
        "<b>Task controls moved</b>\nUse the newest task list below.",
        { ...HTML_REPLY, reply_markup: { inline_keyboard: [] } },
      );
    } catch (editError) {
      logger.info("Could not retire an older task control surface.", {
        userId,
        chatId: chatKey,
        messageId: previousMessageId,
        deleteError: String(deleteError),
        editError: String(editError),
      });
    }
  }
}
