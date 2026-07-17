export type MenuInputAction =
  | "task"
  | "reminder"
  | "note"
  | "idea"
  | "search"
  | "note-search"
  | "idea-search"
  | "image-search"
  | "expense";

type PendingMenuInput = {
  action: MenuInputAction;
  expiresAt: number;
};

const INPUT_TTL_MS = 15 * 60_000;
const pendingInputs = new Map<string, PendingMenuInput>();

export function beginMenuInput(userId: string, actorTelegramId: string | number, action: MenuInputAction): void {
  pendingInputs.set(scopeKey(userId, actorTelegramId), { action, expiresAt: Date.now() + INPUT_TTL_MS });
}

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
