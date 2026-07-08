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

  const bot = botInfo(ctx);
  if (bot?.id && ctx.message?.reply_to_message?.from?.id === bot.id) {
    return true;
  }

  if (bot?.username && mentionRegex(bot.username).test(text)) {
    return true;
  }

  if (messageMentionsBot(ctx, text, bot)) {
    return true;
  }

  return startsWithBotName(ctx, text);
}

function stripBotReference(ctx: Context, text: string): string {
  let next = text;
  const bot = botInfo(ctx);
  if (bot?.username) {
    next = next.replace(mentionRegex(bot.username, true), " ");
  } else {
    next = stripLeadingMentionEntity(ctx, next);
  }

  const name = bot?.first_name?.trim();
  if (name) {
    next = next.replace(new RegExp(`^\\s*${escapeRegExp(name)}(?:\\s+|[:,.!?]+\\s*)`, "i"), "");
  }

  return next.replace(/\s+/g, " ").replace(/^(?:hey|hi|hello)\s+/i, "").trim();
}

function startsWithBotName(ctx: Context, text: string): boolean {
  const name = botInfo(ctx)?.first_name?.trim();
  if (!name) {
    return false;
  }

  return new RegExp(`^\\s*${escapeRegExp(name)}(?:\\s+|[:,.!?]|$)`, "i").test(text);
}

function messageMentionsBot(ctx: Context, text: string, bot: BotInfo | undefined): boolean {
  const entities = ctx.message?.entities ?? [];
  for (const entity of entities) {
    if (entity.type === "text_mention" && bot?.id && entity.user.id === bot.id) {
      return true;
    }

    if (entity.type !== "mention") {
      continue;
    }

    const mention = text.slice(entity.offset, entity.offset + entity.length);
    if (bot?.username && sameUsername(mention, bot.username)) {
      return true;
    }

    if (!bot?.username && entity.offset === 0) {
      return true;
    }
  }

  return false;
}

function stripLeadingMentionEntity(ctx: Context, text: string): string {
  const mention = ctx.message?.entities?.find((entity) => entity.type === "mention" && entity.offset === 0);
  if (!mention) {
    return text;
  }

  return `${text.slice(0, mention.offset)} ${text.slice(mention.offset + mention.length)}`;
}

type BotInfo = {
  id: number;
  first_name?: string;
  username?: string;
};

function botInfo(ctx: Context): BotInfo | undefined {
  return (ctx as unknown as { me?: BotInfo }).me;
}

function sameUsername(mention: string, username: string): boolean {
  return mention.replace(/^@/, "").toLowerCase() === username.replace(/^@/, "").toLowerCase();
}

function mentionRegex(username: string, global = false): RegExp {
  return new RegExp(`(^|\\s)@${escapeRegExp(username.replace(/^@/, ""))}(?=$|[\\s,.:;!?])`, global ? "ig" : "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
