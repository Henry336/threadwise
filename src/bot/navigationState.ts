/**
 * Remembers which list page a user opened an item from, so the item card can offer
 * "Back to page N". This is in-memory, per process, and expires after 30 minutes; losing it
 * on restart only means the Back button falls back to the list's first page.
 */
import type { InlineKeyboard } from "grammy";
import type { CardItemKind } from "./itemCards";

type ListOrigin = { page: number; expiresAt: number };
const ORIGIN_TTL_MS = 30 * 60_000;
const origins = new Map<string, ListOrigin>();

/** Records the list page a user was on when they opened a task, note, or idea. */
export function rememberListOrigin(userId: string, kind: CardItemKind, page: number): void {
  origins.set(key(userId, kind), {
    page: Math.max(1, Math.trunc(page) || 1),
    expiresAt: Date.now() + ORIGIN_TTL_MS
  });
}

/** Returns the remembered page, dropping the entry once it has expired. */
export function listOrigin(userId: string, kind: CardItemKind): number | undefined {
  const origin = origins.get(key(userId, kind));
  if (!origin) return undefined;
  if (origin.expiresAt <= Date.now()) {
    origins.delete(key(userId, kind));
    return undefined;
  }
  return origin.page;
}

/** Adds a back button to an item card: to the remembered page, or to the list menu if none. */
export function appendListOrigin(
  keyboard: InlineKeyboard,
  userId: string,
  kind: CardItemKind
): void {
  const page = listOrigin(userId, kind);
  const listKind = kind === "task" ? "tasks" : kind === "note" ? "notes" : "ideas";
  if (page) keyboard.row().text(`‹ Back to page ${page}`, `list:${listKind}:${page}`);
  else keyboard.row().text(`‹ ${kind === "task" ? "Tasks" : kind === "note" ? "Notes" : "Ideas"}`, `menu:${listKind}`);
}

function key(userId: string, kind: CardItemKind): string {
  return `${userId}:${kind}`;
}
