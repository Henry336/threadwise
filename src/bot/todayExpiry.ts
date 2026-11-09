import type { Bot } from "grammy";
import { logger } from "../logger";
import { expireTaskCaptureDrafts } from "../services/taskCaptureDrafts";
import { startLoop, type StopLoop } from "../utils/loop";

export const TASK_DRAFT_EXPIRY_POLL_MS = 60_000;

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

export function startTaskDraftExpiryLoop(
  bot: Bot,
  ownerTelegramId: string | undefined,
  pollMs = TASK_DRAFT_EXPIRY_POLL_MS,
): StopLoop | undefined {
  if (!ownerTelegramId) return undefined;
  return startLoop("Task draft expiry", pollMs, () => expireTaskDraftCards(bot, ownerTelegramId), { runImmediately: true });
}
