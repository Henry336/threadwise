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

export function configureEphemeralTransport(token: string): void {
  configuredToken = token;
}

export function preferEphemeralInteraction(ctx: Context): void {
  preferredContexts.add(ctx);
}

export function callbackMatchesEphemeralReceiver(ctx: Context): boolean {
  const receiverId = ephemeralMessage(ctx.callbackQuery?.message)?.receiver_user?.id;
  return receiverId === undefined || receiverId === ctx.from?.id;
}

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
