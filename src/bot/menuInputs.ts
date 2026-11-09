/**
 * Tracks "the next message you type is input for this menu button" (for example, after tapping
 * Add task or Set timezone). State is keyed by workspace owner plus the human sender, so in a group
 * one member's pending prompt does not capture another member's message.
 */
export type MenuInputAction =
  | "task"
  | "reminder"
  | "note"
  | "idea"
  | "search"
  | "note-search"
  | "idea-search"
  | "idea-brief"
  | "image-search"
  | "setting-interval"
  | "setting-quiet"
  | "setting-due-nudge"
  | "setting-max"
  | "setting-timezone"
  | "setting-currency";

type PendingMenuInput = {
  action: MenuInputAction;
  expiresAt: number;
};

const INPUT_TTL_MS = 15 * 60_000;
// In memory by design: a deploy or restart drops pending menu prompts, and the user just taps the menu again.
const pendingInputs = new Map<string, PendingMenuInput>();

/** Arms a menu prompt for 15 minutes, replacing any earlier one for the same sender. */
export function beginMenuInput(userId: string, actorTelegramId: string | number, action: MenuInputAction): void {
  pendingInputs.set(scopeKey(userId, actorTelegramId), { action, expiresAt: Date.now() + INPUT_TTL_MS });
}

/** Returns the armed prompt, or undefined once it has expired (expired entries are removed). */
export function pendingMenuInput(userId: string, actorTelegramId: string | number): MenuInputAction | undefined {
  const key = scopeKey(userId, actorTelegramId);
  const pending = pendingInputs.get(key);
  if (!pending) return undefined;
  if (pending.expiresAt <= Date.now()) {
    pendingInputs.delete(key);
    return undefined;
  }
  return pending.action;
}

export function clearMenuInput(userId: string, actorTelegramId: string | number): boolean {
  return pendingInputs.delete(scopeKey(userId, actorTelegramId));
}

function scopeKey(userId: string, actorTelegramId: string | number): string {
  return `${userId}:${actorTelegramId}`;
}
