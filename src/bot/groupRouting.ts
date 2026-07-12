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

  if (botLikeMention(text)) {
    return true;
  }

  return startsWithBotName(ctx, text);
}

function stripBotReference(ctx: Context, text: string): string {
  const bot = botInfo(ctx);
  let next = stripBotMentionEntities(ctx, text, bot);
  if (bot?.username) {
    next = next.replace(mentionRegex(bot.username, true), " ");
  } else {
    next = stripLeadingMentionEntity(ctx, next);
  }

  next = stripBotLikeMentions(next);

  const name = bot?.first_name?.trim();
  if (name) {
    next = next.replace(new RegExp(`^\\s*${escapeRegExp(name)}(?:\\s+|[:,.!?]+\\s*)`, "i"), "");
  }

  return next
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:hey|hi|hello)(?:\s+|\s*[,.:;!?]+\s*|$)/i, "")
    .replace(/^\s*[()[\]{}<>,.:;!?—–-]+\s*/, "")
    .trim();
}

export function shouldHandleGroupUpdate(ctx: Context): boolean {
  if (!isGroupChat(ctx) || !ctx.message) return true;
  if (ctx.message.text?.startsWith("/")) return true;
  return messageTargetsBot(ctx, ctx.message.text ?? ctx.message.caption ?? "");
}

export function telegramGroupPrivacyEnabled(ctx: Context): boolean {
  return botInfo(ctx)?.can_read_all_group_messages !== true;
}

function stripBotMentionEntities(ctx: Context, text: string, bot: BotInfo | undefined): string {
  const botEntities = (ctx.message?.entities ?? [])
    .filter((entity) => {
      if (entity.type === "text_mention") return Boolean(bot?.id && entity.user.id === bot.id);
      if (entity.type !== "mention" || !bot?.username) return false;
      return sameUsername(text.slice(entity.offset, entity.offset + entity.length), bot.username);
    })
    .sort((a, b) => b.offset - a.offset);

  let next = text;
  for (const entity of botEntities) {
    next = `${next.slice(0, entity.offset)} ${next.slice(entity.offset + entity.length)}`;
  }
  return next;
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
  const mention = ctx.message?.entities?.find((entity) => (entity.type === "mention" || entity.type === "text_mention") && entity.offset === 0);
  if (!mention) {
    return text;
  }

  return `${text.slice(0, mention.offset)} ${text.slice(mention.offset + mention.length)}`;
}

type BotInfo = {
  id: number;
  first_name?: string;
  username?: string;
  can_read_all_group_messages?: boolean;
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

function botLikeMention(text: string): boolean {
  return /(^|\s)@[A-Za-z0-9_]*bot\b/i.test(text);
}

function stripBotLikeMentions(text: string): string {
  return text.replace(/(^|\s)@[A-Za-z0-9_]*bot\b(?:\s*[,.:;!?])?/ig, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
