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
