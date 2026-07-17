import type { Context } from "grammy";

export const HTML_REPLY = { parse_mode: "HTML" as const };

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

export async function replyHtml(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  return ctx.reply(text, { ...options, ...HTML_REPLY });
}

export async function editOrReplyHtml(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  return editCallbackMessageOrReply(ctx, text, options, true);
}

export async function editOrReplyText(ctx: Context, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  return editCallbackMessageOrReply(ctx, text, options, false);
}

async function editCallbackMessageOrReply(
  ctx: Context,
  text: string,
  options: Record<string, unknown>,
  html: boolean
): Promise<unknown> {
  const message = ctx.callbackQuery?.message;
  const format = html ? HTML_REPLY : {};

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

function isCaptionableMessage(message: object): boolean {
  return "caption" in message
    || "photo" in message
    || "document" in message
    || "video" in message
    || "animation" in message
    || "audio" in message;
}
