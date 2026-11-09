/**
 * Short "Saved" style replies that delete themselves after a few seconds. This keeps routine
 * capture quiet in the chat, a design rule from docs/ARCHITECTURE.md. Errors and cards with
 * useful buttons use the normal reply helpers and stay visible.
 */
import type { Context } from "grammy";
import { editOrReplyHtml, replyHtml } from "../utils/html";
import { deleteEphemeralMessage, ephemeralDeletionTarget } from "./ephemeral";

export const QUIET_ACKNOWLEDGEMENT_TTL_MS = 3_500;

type TelegramMessageResult = {
  message_id?: unknown;
  chat?: { id?: unknown };
};

/** Works out which chat and message to delete: the sent message, or the tapped card after an edit. */
function messageTarget(ctx: Context, result: unknown): { chatId: number | string; messageId: number } | undefined {
  const response = result && typeof result === "object" ? result as TelegramMessageResult : undefined;
  const responseChatId = response?.chat?.id;
  const responseMessageId = response?.message_id;
  const callbackMessage = ctx.callbackQuery?.message;
  const chatId = typeof responseChatId === "number" || typeof responseChatId === "string"
    ? responseChatId
    : ctx.chat?.id ?? callbackMessage?.chat.id;
  const messageId = typeof responseMessageId === "number"
    ? responseMessageId
    : callbackMessage?.message_id;

  return chatId !== undefined && messageId !== undefined ? { chatId, messageId } : undefined;
}

/**
 * Schedules deletion of the acknowledgement. Receiver-bound ephemeral messages need their own
 * delete call. The timer is unref'd so it never keeps the process alive, and failures are ignored
 * (the message may already be gone). A restart before the timer fires leaves the message in place.
 */
function removeSoon(ctx: Context, result: unknown, ttlMs: number): void {
  const ephemeral = ephemeralDeletionTarget(ctx, result);
  if (ephemeral) {
    const timer = setTimeout(() => {
      void deleteEphemeralMessage(
        ephemeral.chatId,
        ephemeral.receiverUserId,
        ephemeral.ephemeralMessageId
      ).catch(() => undefined);
    }, ttlMs);
    timer.unref?.();
    return;
  }

  const target = messageTarget(ctx, result);
  if (!target) return;

  const timer = setTimeout(() => {
    void ctx.api.deleteMessage(target.chatId, target.messageId).catch(() => undefined);
  }, ttlMs);
  timer.unref?.();
}

/**
 * Sends a terse success acknowledgement and removes only that acknowledgement.
 * Errors, item detail cards, and interactive control messages deliberately use
 * the normal reply helpers and therefore remain visible.
 */
export async function replyQuietAcknowledgementHtml(
  ctx: Context,
  content: string,
  ttlMs = QUIET_ACKNOWLEDGEMENT_TTL_MS,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  const message = await replyHtml(ctx, content, options);
  removeSoon(ctx, message, ttlMs);
  return message;
}

/**
 * Completes a one-shot callback flow in place, then removes the completed flow.
 * Use this only when the callback card has no remaining useful controls.
 */
export async function editOrReplyQuietAcknowledgementHtml(
  ctx: Context,
  content: string,
  ttlMs = QUIET_ACKNOWLEDGEMENT_TTL_MS
): Promise<unknown> {
  const message = await editOrReplyHtml(ctx, content);
  removeSoon(ctx, message, ttlMs);
  return message;
}
