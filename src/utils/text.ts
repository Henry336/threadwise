/**
 * Returns the text after a slash command, also removing an optional @botname suffix
 * (Telegram adds it in groups, for example `/todo@threadwise_1_bot`).
 */
/**
 * Plain string helpers shared by the bot and services: stripping a slash command,
 * truncating for display, normalizing public ids like TASK-1, and splitting words for search.
 */

export function commandBody(text: string, commandName: string): string {
  const withoutCommand = text.replace(new RegExp(`^/${commandName}(?:@\\w+)?`, "i"), "");
  return withoutCommand.trim();
}

/**
 * Shortens text to `maxLength` characters including a trailing "...".
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function normalizePublicId(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Lower-cases text and splits it into ASCII word tokens. Used by the local search embedding,
 * so non-Latin scripts produce no tokens here.
 */
export function splitWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

