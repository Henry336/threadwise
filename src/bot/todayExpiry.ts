/**
 * Background loop that expires stale Today task drafts and rewrites their Telegram review cards.
 * The draft rows live in PostgreSQL (services/taskCaptureDrafts.ts); this file only owns the
 * Telegram side and the minute timer. Started from main.ts for the Today owner only.
 */
import type { Bot } from "grammy";
import { logger } from "../logger";
import { expireTaskCaptureDrafts } from "../services/taskCaptureDrafts";
import { startLoop, type StopLoop } from "../utils/loop";

export const TASK_DRAFT_EXPIRY_POLL_MS = 60_000;

/**
 * Marks expired drafts in the database, then edits each original review card to say nothing was
 * saved. Replacing the card (rather than leaving its Save button) stops a late tap from acting on
 * a dead draft. Edit failures are logged and skipped; the draft is already expired either way.
 */
export async function expireTaskDraftCards(bot: Bot, ownerTelegramId: string, now = new Date()): Promise<number> {
  const drafts = await expireTaskCaptureDrafts(ownerTelegramId, now);
  let edited = 0;
  for (const draft of drafts) {
    try {
      await bot.api.editMessageText(draft.telegramChatId, draft.telegramReviewMessageId, "Draft expired · Nothing was saved.");
      edited += 1;
    } catch (error) {
      logger.warn("Could not replace an expired Today draft card.", { draftId: draft.id, error: String(error) });
    }
  }
  return edited;
}

/**
 * Starts the once-a-minute expiry loop. Returns undefined (no loop) when no Today owner is
 * configured, because Today drafts are gated behind TODAY_FOUNDATION_OWNER_TELEGRAM_ID.
 */
export function startTaskDraftExpiryLoop(
  bot: Bot,
  ownerTelegramId: string | undefined,
  pollMs = TASK_DRAFT_EXPIRY_POLL_MS,
): StopLoop | undefined {
  if (!ownerTelegramId) return undefined;
  return startLoop("Task draft expiry", pollMs, () => expireTaskDraftCards(bot, ownerTelegramId), { runImmediately: true });
}
