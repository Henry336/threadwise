import type { Context } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { HTML_REPLY } from "../utils/html";

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
