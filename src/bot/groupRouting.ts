import type { Context } from "grammy";

export function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

export function isTelegramContextAllowed(ctx: Context, allowlist: Set<string> | undefined): boolean {
  if (!allowlist || allowlist.size === 0) {
    return true;
  }

  return telegramAllowlistKeys(ctx).some((key) => allowlist.has(key));
}

export function telegramAllowlistKeys(ctx: Context): string[] {
  const keys: string[] = [];
  if (ctx.from?.id) {
    keys.push(String(ctx.from.id));
  }

  if (ctx.chat?.id) {
    const chatId = String(ctx.chat.id);
    keys.push(chatId, `chat:${chatId}`);
  }

  return keys;
}

export function prepareNaturalLanguageText(ctx: Context, text: string): string | undefined {
  if (!isGroupChat(ctx)) {
    return text;
  }

  if (!messageTargetsBot(ctx, text)) {
    return undefined;
  }

  const prepared = stripBotReference(ctx, text);
  return prepared.length > 0 ? prepared : undefined;
}

export function messageTargetsBot(ctx: Context, text: string): boolean {
  if (!isGroupChat(ctx)) {
    return true;
  }

  if (ctx.message?.reply_to_message?.from?.id === ctx.me.id) {
    return true;
  }

  if (ctx.me.username && mentionRegex(ctx.me.username).test(text)) {
    return true;
  }

  return startsWithBotName(ctx, text);
}

function stripBotReference(ctx: Context, text: string): string {
  let next = text;
  if (ctx.me.username) {
    next = next.replace(mentionRegex(ctx.me.username, true), " ");
  }

  const name = ctx.me.first_name?.trim();
  if (name) {
    next = next.replace(new RegExp(`^\\s*${escapeRegExp(name)}(?:\\s+|[:,.!?]+\\s*)`, "i"), "");
  }

  return next.replace(/\s+/g, " ").replace(/^(?:hey|hi|hello)\s+/i, "").trim();
}

function startsWithBotName(ctx: Context, text: string): boolean {
  const name = ctx.me.first_name?.trim();
  if (!name) {
    return false;
  }

  return new RegExp(`^\\s*${escapeRegExp(name)}(?:\\s+|[:,.!?]|$)`, "i").test(text);
}

function mentionRegex(username: string, global = false): RegExp {
  return new RegExp(`(^|\\s)@${escapeRegExp(username)}(?=$|[\\s,.:;!?])`, global ? "ig" : "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
