/**
 * Shared building blocks for Telegram HTML messages, so cards follow the house layout:
 * content first, then a compact metadata block, then guidance (see docs/ARCHITECTURE.md).
 */

import { bold, h } from "./html";

// Keep Telegram messages consistent without making every service hand-roll labels.
/**
 * One "Label: value" line with the value HTML-escaped.
 */
export function field(label: string, value: string | number): string {
  return `${bold(`${label}:`)} ${h(String(value))}`;
}

/**
 * Same as `field`, but the value is already HTML and is not escaped again.
 */
export function fieldHtml(label: string, value: string): string {
  return `${bold(`${label}:`)} ${value}`;
}

/**
 * Joins message sections with blank lines, skipping empty or conditional ones.
 */
export function joinBlocks(blocks: Array<string | undefined | false | null>): string {
  return blocks.filter(Boolean).join("\n\n");
}

/**
 * Picks one wording from `choices` using a small hash of `seed` (usually a public id).
 * This gives some variety in replies without randomness, so the same item always gets the same text
 * and tests stay stable.
 */
export function stableChoice(seed: string, choices: string[]): string {
  if (choices.length === 0) {
    return "";
  }

  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return choices[hash % choices.length] ?? choices[0] ?? "";
}
