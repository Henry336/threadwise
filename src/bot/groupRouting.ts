/**
 * Decides whether a group message is meant for Threadwise. Groups stay quiet by default: only slash
 * commands, an exact mention of this bot, a reply to the bot, or a TODO:/ACTION ITEMS: heading count.
 * Also holds the allowlist key logic used by the access gate in index.ts.
 */
import type { Context } from "grammy";

export function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

/** True when the sender or the chat is on the allowlist (an empty allowlist allows everyone). */
export function isTelegramContextAllowed(ctx: Context, allowlist: Set<string> | undefined): boolean {
  if (!allowlist || allowlist.size === 0) {
    return true;
  }

  return telegramAllowlistKeys(ctx).some((key) => allowlist.has(key));
}

/** Allowlist keys for this update: sender id, chat id, and chat:<id> (both group id spellings are accepted). */
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

/**
 * Returns the text natural-language handling should see, or undefined to stay silent. In groups
 * the message must target the bot (or be a TODO import), and the bot mention and greeting are
 * stripped so "@bot hey, remind me..." parses like "remind me...".
 */
export function prepareNaturalLanguageText(ctx: Context, text: string): string | undefined {
  if (!isGroupChat(ctx)) {
    return text;
  }

  if (!messageTargetsBot(ctx, text) && !isExplicitGroupTaskImport(text)) {
    return undefined;
  }

  const prepared = stripBotReference(ctx, text);
  return prepared.length > 0 ? prepared : undefined;
}

/**
 * True when a group message is addressed to this bot: a private (ephemeral) message to it, a reply
 * to one of its messages, or an exact mention of its username or user. Private chats always count.
 * Generic "@something_bot" mentions do not.
 */
export function messageTargetsBot(ctx: Context, text: string): boolean {
  if (!isGroupChat(ctx)) {
    return true;
  }

  const bot = botInfo(ctx);
  const ephemeralReceiverId = ephemeralReceiver(ctx);
  if (bot?.id && ephemeralReceiverId === bot.id) {
    return true;
  }

  if (bot?.id && ctx.message?.reply_to_message?.from?.id === bot.id) {
    return true;
  }

  if (bot?.username && mentionRegex(bot.username).test(text)) {
    return true;
  }

  if (messageMentionsBot(ctx, text, bot)) {
    return true;
  }

  return false;
}

/**
 * A deliberately narrow group-only shortcut for turning an existing action
 * list into tasks. It must be a heading at the start of the message so normal
 * conversation containing the words "todo" or "action items" stays silent.
 */
export function isExplicitGroupTaskImport(text: string): boolean {
  return /^\s*(?:TODO|TO\s+DO|ACTION\s+ITEMS?)\s*:\s*(?:\r?\n|\S)/iu.test(text);
}

/** Removes the bot mention, empty brackets, a leading greeting, and leading punctuation. */
function stripBotReference(ctx: Context, text: string): string {
  const bot = botInfo(ctx);
  let next = stripBotMentionEntities(ctx, text, bot);
  if (bot?.username) {
    next = next.replace(mentionRegex(bot.username, true), " ");
  } else {
    next = stripLeadingMentionEntity(ctx, next);
  }

  return next
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:hey|hi|hello)(?:\s+|\s*[,.:;!?]+\s*|$)/i, "")
    .replace(/^\s*[()[\]{}<>,.:;!?—–-]+\s*/, "")
    .trim();
}

/**
 * The early gate used in index.ts. Non-group updates and non-message updates (button taps, member
 * changes) pass; group messages pass only if they are commands, addressed to the bot, or a TODO import.
 */
export function shouldHandleGroupUpdate(ctx: Context): boolean {
  if (!isGroupChat(ctx) || !ctx.message) return true;
  if (ctx.message.text?.startsWith("/")) return true;
  const text = ctx.message.text ?? ctx.message.caption ?? "";
  return messageTargetsBot(ctx, text) || isExplicitGroupTaskImport(text);
}

/** True when Telegram privacy mode is on, meaning the bot only receives commands, mentions, and replies. */
export function telegramGroupPrivacyEnabled(ctx: Context): boolean {
  return botInfo(ctx)?.can_read_all_group_messages !== true;
}

/** Cuts this bot's mention entities out of the text, working from the end so earlier offsets stay valid. */
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

/**
 * Checks Telegram's mention entities for this bot. If the bot username is unknown, a mention at the
 * very start of the message is treated as addressing the bot.
 */
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

/** The receiver of a receiver-bound (ephemeral) message, if this is one. */
function ephemeralReceiver(ctx: Context): number | undefined {
  const message = ctx.message as unknown as {
    ephemeral_message_id?: number;
    receiver_user?: { id?: number };
  } | undefined;
  return message?.ephemeral_message_id ? message.receiver_user?.id : undefined;
}

function sameUsername(mention: string, username: string): boolean {
  return mention.replace(/^@/, "").toLowerCase() === username.replace(/^@/, "").toLowerCase();
}

/** Matches "@username" as a whole word, so "@threadwise_bot2" does not match "@threadwise_bot". */
function mentionRegex(username: string, global = false): RegExp {
  return new RegExp(`(^|\\s)@${escapeRegExp(username.replace(/^@/, ""))}(?=$|[\\s,.:;!?])`, global ? "ig" : "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
