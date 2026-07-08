import type { Context } from "grammy";
import type { TaskCreationOptions, TaskEntityMention } from "../services/tasks";

export function taskCreationOptionsFromContext(ctx: Context, sourceText: string): TaskCreationOptions {
  const mentions = taskEntityMentionsFromContext(ctx, sourceText);
  return mentions.length > 0 ? { mentions } : {};
}

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

function offsetInSource(sourceText: string, mentionText: string, fallbackText: string): number {
  const mentionOffset = sourceText.indexOf(mentionText);
  if (mentionOffset >= 0) {
    return mentionOffset;
  }

  const fallbackOffset = sourceText.indexOf(fallbackText);
  return fallbackOffset >= 0 ? fallbackOffset : -1;
}
