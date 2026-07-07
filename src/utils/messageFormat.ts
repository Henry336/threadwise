import { bold, h } from "./html";

// Keep Telegram messages consistent without making every service hand-roll labels.
export function field(label: string, value: string | number): string {
  return `${bold(`${label}:`)} ${h(String(value))}`;
}

export function fieldHtml(label: string, value: string): string {
  return `${bold(`${label}:`)} ${value}`;
}

export function joinBlocks(blocks: Array<string | undefined | false | null>): string {
  return blocks.filter(Boolean).join("\n\n");
}

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
