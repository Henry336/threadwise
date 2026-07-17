import type { InlineKeyboard } from "grammy";
import type { CardItemKind } from "./itemCards";

type ListOrigin = { page: number; expiresAt: number };
const ORIGIN_TTL_MS = 30 * 60_000;
const origins = new Map<string, ListOrigin>();

export function rememberListOrigin(userId: string, kind: CardItemKind, page: number): void {
  origins.set(key(userId, kind), {
    page: Math.max(1, Math.trunc(page) || 1),
    expiresAt: Date.now() + ORIGIN_TTL_MS
  });
}

export function listOrigin(userId: string, kind: CardItemKind): number | undefined {
  const origin = origins.get(key(userId, kind));
  if (!origin) return undefined;
  if (origin.expiresAt <= Date.now()) {
    origins.delete(key(userId, kind));
    return undefined;
  }
  return origin.page;
}

export function appendListOrigin(
  keyboard: InlineKeyboard,
  userId: string,
  kind: CardItemKind
): void {
  const page = listOrigin(userId, kind);
  if (!page) return;
  const listKind = kind === "task" ? "tasks" : kind === "note" ? "notes" : "ideas";
  keyboard.row().text(`‹ Back to page ${page}`, `list:${listKind}:${page}`);
}

function key(userId: string, kind: CardItemKind): string {
  return `${userId}:${kind}`;
}
