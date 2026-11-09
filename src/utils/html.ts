/**
 * Telegram HTML helpers: escaping user text, simple tags, and reply/edit functions.
 * The reply helpers first try the receiver-bound (ephemeral) delivery in bot/ephemeral.ts, so a
 * private group menu stays private, and only then fall back to a normal message.
 */

import type { Context } from "grammy";
import { editOrSendEphemeral, replyToIncomingEphemeral } from "../bot/ephemeral";

export const HTML_REPLY = { parse_mode: "HTML" as const };

/**
 * Escapes text for Telegram HTML parse mode. Every piece of user text must pass through this
 * (or bold/italic/code) before going into an HTML message.
 */
export function h(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function bold(value: unknown): string {
  return `<b>${h(value)}</b>`;
}

export function italic(value: unknown): string {
  return `<i>${h(value)}</i>`;
}

export function code(value: unknown): string {
  return `<code>${h(value)}</code>`;
}

/**
 * Replies with HTML. If the incoming update belongs to a receiver-bound (ephemeral) group menu,
 * the reply goes to that member only; otherwise it is a normal chat reply.
 */
export async function replyHtml(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  const ephemeral = await replyToIncomingEphemeral(ctx, text, { ...options, ...HTML_REPLY });
  if (ephemeral !== undefined) return ephemeral;
  return ctx.reply(text, { ...options, ...HTML_REPLY });
}

/** Sends long plain text as several messages, since Telegram rejects messages over 4096 characters. */
export async function replyInChunks(ctx: Context, text: string): Promise<void> {
  const maxLength = 3800;
  for (let start = 0; start < text.length; start += maxLength) {
    await ctx.reply(text.slice(start, start + maxLength));
  }
}

/**
 * For button presses: edits the message the button was on, or sends a new reply if it cannot.
 */
export async function editOrReplyHtml(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  return editCallbackMessageOrReply(ctx, text, options, true);
}

/**
 * Plain-text version of `editOrReplyHtml`.
 */
export async function editOrReplyText(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  return editCallbackMessageOrReply(ctx, text, options, false);
}

/**
 * Edit-in-place logic shared by the two functions above. Text messages are edited; media
 * messages have their caption edited (Telegram caps captions at 1024 characters). "Message is not
 * modified" counts as success. Any other failure falls back to sending a new message.
 */
async function editCallbackMessageOrReply(
  ctx: Context,
  text: string,
  options: Record<string, unknown>,
  html: boolean
): Promise<unknown> {
  const message = ctx.callbackQuery?.message;
  const format = html ? HTML_REPLY : {};
  const ephemeral = await editOrSendEphemeral(ctx, text, { ...options, ...format });
  if (ephemeral !== undefined) return ephemeral;

  if (message) {
    try {
      if ("text" in message) {
        return await ctx.editMessageText(text, { ...options, ...format });
      }

      if (isCaptionableMessage(message) && text.length <= 1024) {
        return await ctx.editMessageCaption({ caption: text, ...options, ...format });
      }
    } catch (error) {
      if (String(error).toLowerCase().includes("message is not modified")) {
        return true;
      }
    }
  }

  return ctx.reply(text, { ...options, ...format });
}

/**
 * True for message types whose caption Telegram lets a bot edit.
 */
function isCaptionableMessage(message: object): boolean {
  return "caption" in message
    || "photo" in message
    || "document" in message
    || "video" in message
    || "animation" in message
    || "audio" in message;
}
