/**
 * Receiver-bound ("ephemeral") messages in groups: a message only one member can see. Group menus,
 * lists, and prompts use them so each member gets a private view while the group keeps one public
 * anchor. These Bot API methods are called directly with fetch through callTelegram below rather
 * than through grammY's api object. If private delivery fails, nothing falls back to a public message.
 */
import type { Context } from "grammy";
import { logger } from "../logger";

type TelegramUser = { id?: number };
type TelegramEphemeralMessage = {
  chat?: { id?: number | string };
  receiver_user?: TelegramUser;
  ephemeral_message_id?: number;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const preferredContexts = new WeakSet<Context>();
let configuredToken: string | undefined;

/** Stores the bot token for the direct Bot API calls. Called once from createThreadwiseBot. */
export function configureEphemeralTransport(token: string): void {
  configuredToken = token;
}

/**
 * Marks this update so a reply to a tap on a public group card opens a private view for the tapper
 * instead of editing the shared card. A WeakSet keeps it tied to this one update.
 */
export function preferEphemeralInteraction(ctx: Context): void {
  preferredContexts.add(ctx);
}

/** False when someone taps a button on a private view that was sent to a different member. */
export function callbackMatchesEphemeralReceiver(ctx: Context): boolean {
  const receiverId = ephemeralMessage(ctx.callbackQuery?.message)?.receiver_user?.id;
  return receiverId === undefined || receiverId === ctx.from?.id;
}

/** Answers a member's reply to a private message privately too. Returns undefined if the message was not ephemeral. */
export async function replyToIncomingEphemeral(
  ctx: Context,
  text: string,
  options: Record<string, unknown>
): Promise<unknown | undefined> {
  const target = ephemeralMessage(ctx.message);
  if (!target?.ephemeral_message_id || !ctx.from?.id || !ctx.chat) return undefined;

  return callTelegram("sendMessage", {
    chat_id: ctx.chat.id,
    receiver_user_id: ctx.from.id,
    reply_parameters: { ephemeral_message_id: target.ephemeral_message_id },
    text,
    ...options
  });
}

/**
 * Shows the result of a button tap privately: edits the tapped private message, or opens a new
 * private one when the tap came from a public card marked with preferEphemeralInteraction.
 * A force-reply prompt cannot be an edit, so it is sent new and the old private message deleted.
 * Returns undefined when the caller should use a normal edit, and true after a delivery failure so
 * the caller does not edit the shared group message instead.
 */
export async function editOrSendEphemeral(
  ctx: Context,
  text: string,
  options: Record<string, unknown>
): Promise<unknown | undefined> {
  if (!ctx.callbackQuery || !ctx.from?.id || !ctx.chat) return undefined;
  const target = ephemeralMessage(ctx.callbackQuery.message);
  const shouldUse = Boolean(target?.ephemeral_message_id) || preferredContexts.has(ctx);
  if (!shouldUse) return undefined;

  try {
    if (target?.ephemeral_message_id) {
      if (isForceReply(options.reply_markup)) {
        const message = await callTelegram("sendMessage", {
          chat_id: ctx.chat.id,
          receiver_user_id: ctx.from.id,
          reply_parameters: { ephemeral_message_id: target.ephemeral_message_id },
          text,
          ...options
        });
        await callTelegram("deleteEphemeralMessage", {
          chat_id: ctx.chat.id,
          receiver_user_id: ctx.from.id,
          ephemeral_message_id: target.ephemeral_message_id
        }).catch(() => undefined);
        return message;
      }

      return await callTelegram("editEphemeralMessageText", {
        chat_id: ctx.chat.id,
        receiver_user_id: ctx.from.id,
        ephemeral_message_id: target.ephemeral_message_id,
        text,
        ...options
      });
    }

    return await callTelegram("sendMessage", {
      chat_id: ctx.chat.id,
      receiver_user_id: ctx.from.id,
      callback_query_id: ctx.callbackQuery.id,
      text,
      ...options
    });
  } catch (error) {
    logger.warn("Telegram ephemeral delivery failed; leaving the shared group message unchanged.", {
      chatId: String(ctx.chat.id),
      receiverUserId: String(ctx.from.id),
      error: String(error)
    });
    // Never turn a private per-user journey back into a public group edit.
    return true;
  }
}

export async function deleteEphemeralMessage(
  chatId: number | string,
  receiverUserId: number,
  ephemeralMessageId: number
): Promise<void> {
  await callTelegram("deleteEphemeralMessage", {
    chat_id: chatId,
    receiver_user_id: receiverUserId,
    ephemeral_message_id: ephemeralMessageId
  });
}

export async function editEphemeralMessageText(
  chatId: number | string,
  receiverUserId: number,
  ephemeralMessageId: number,
  text: string,
  options: Record<string, unknown> = {}
): Promise<void> {
  await callTelegram("editEphemeralMessageText", {
    chat_id: chatId,
    receiver_user_id: receiverUserId,
    ephemeral_message_id: ephemeralMessageId,
    text,
    ...options
  });
}

/** Identifies the private message to delete later (used by quiet acknowledgements), or undefined if it is not ephemeral. */
export function ephemeralDeletionTarget(
  ctx: Context,
  result: unknown
): { chatId: number | string; receiverUserId: number; ephemeralMessageId: number } | undefined {
  const response = ephemeralMessage(result);
  const contextMessage = ephemeralMessage(ctx.callbackQuery?.message ?? ctx.message);
  const message = response?.ephemeral_message_id ? response : contextMessage;
  const chatId = response?.chat?.id ?? contextMessage?.chat?.id ?? ctx.chat?.id;
  const receiverUserId = response?.receiver_user?.id ?? contextMessage?.receiver_user?.id ?? ctx.from?.id;
  if (chatId === undefined || receiverUserId === undefined || message?.ephemeral_message_id === undefined) {
    return undefined;
  }
  return {
    chatId,
    receiverUserId,
    ephemeralMessageId: message.ephemeral_message_id
  };
}

/** True when this update belongs to a private per-member flow, so errors should also be private. */
export function isEphemeralInteractionContext(ctx: Context): boolean {
  return Boolean(
    ephemeralMessage(ctx.callbackQuery?.message)?.ephemeral_message_id
    || ephemeralMessage(ctx.message)?.ephemeral_message_id
    || preferredContexts.has(ctx)
  );
}

function ephemeralMessage(value: unknown): TelegramEphemeralMessage | undefined {
  return value && typeof value === "object" ? value as TelegramEphemeralMessage : undefined;
}

function isForceReply(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "force_reply" in value);
}

/** POSTs one Bot API method and throws Telegram's description on failure. The token never appears in the error. */
async function callTelegram<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  if (!configuredToken) throw new Error("Telegram ephemeral transport is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${configuredToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json() as TelegramApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error(body.description || `Telegram ${method} failed with HTTP ${response.status}.`);
  }
  return body.result as T;
}
