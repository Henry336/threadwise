import type { Context } from "grammy";
import { replyHtml } from "../utils/html";

const activeCards = new Map<string, number>();

export function rememberCallbackControlCard(ctx: Context): void {
  const message = ctx.callbackQuery?.message;
  const chatId = ctx.chat?.id;
  if (!message || !chatId) return;
  activeCards.set(String(chatId), message.message_id);
}

export async function rememberNewControlCard(ctx: Context, message: unknown): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const chatId = ctx.chat?.id;
  const nextMessageId = messageId(message);
  if (!chatId || !nextMessageId) return;

  const key = String(chatId);
  const previousMessageId = activeCards.get(key);
  activeCards.set(key, nextMessageId);

  if (!previousMessageId || previousMessageId === nextMessageId) return;
  try {
    await ctx.api.editMessageReplyMarkup(chatId, previousMessageId, {
      reply_markup: { inline_keyboard: [] }
    });
  } catch {
    // A card may already be deleted, too old to edit, or manually stripped.
  }
}

export async function replyControlCardHtml(
  ctx: Context,
  content: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  const message = await replyHtml(ctx, content, options);
  await rememberNewControlCard(ctx, message);
  return message;
}

function messageId(message: unknown): number | undefined {
  if (!message || typeof message !== "object" || !("message_id" in message)) return undefined;
  return typeof message.message_id === "number" ? message.message_id : undefined;
}
