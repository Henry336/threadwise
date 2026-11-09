/**
 * Turns the @mentions Telegram attached to a message into structured task mentions, which the
 * task service uses to set group assignees. Reading Telegram's message entities is more reliable
 * than re-parsing "@name" from text, and text_mention entities carry the real user id.
 */
import type { Context } from "grammy";
import type { TaskCreationOptions, TaskEntityMention } from "../services/tasks";

/** Task creation options for this message: the mentions it contains, or an empty object. */
export function taskCreationOptionsFromContext(ctx: Context, sourceText: string): TaskCreationOptions {
  const mentions = taskEntityMentionsFromContext(ctx, sourceText);
  return mentions.length > 0 ? { mentions } : {};
}

/**
 * Collects "@username" mentions and "text_mention" entities (users without a username).
 * Mentions of the bot itself are skipped so addressing Threadwise does not assign it the task.
 */
function taskEntityMentionsFromContext(ctx: Context, sourceText: string): TaskEntityMention[] {
  const message = ctx.message;
  if (!message || !("text" in message)) {
    return [];
  }

  const fullText = message.text;
  if (typeof fullText !== "string") {
    return [];
  }
  const botId = (ctx as unknown as { me?: { id?: number } }).me?.id;
  const mentions: TaskEntityMention[] = [];
  for (const entity of message.entities ?? []) {
    if (entity.type === "mention") {
      const mentionText = fullText.slice(entity.offset, entity.offset + entity.length);
      const username = mentionText.replace(/^@/, "");
      mentions.push({
        offset: offsetInSource(sourceText, mentionText, username),
        length: mentionText.length,
        username,
        displayName: username
      });
      continue;
    }

    if (entity.type !== "text_mention" || (botId && entity.user.id === botId)) {
      continue;
    }

    const mentionText = fullText.slice(entity.offset, entity.offset + entity.length);
    const displayName = [entity.user.first_name, entity.user.last_name].filter(Boolean).join(" ").trim() || mentionText;
    mentions.push({
      offset: offsetInSource(sourceText, mentionText, displayName),
      length: mentionText.length,
      username: entity.user.username,
      telegramId: String(entity.user.id),
      displayName
    });
  }

  return mentions;
}

/**
 * Re-finds the mention inside sourceText. Entity offsets are relative to the full message, but
 * sourceText is often a trimmed part of it (for example after a command prefix). Returns -1 if absent.
 */
function offsetInSource(sourceText: string, mentionText: string, fallbackText: string): number {
  const mentionOffset = sourceText.indexOf(mentionText);
  if (mentionOffset >= 0) {
    return mentionOffset;
  }

  const fallbackOffset = sourceText.indexOf(fallbackText);
  return fallbackOffset >= 0 ? fallbackOffset : -1;
}
