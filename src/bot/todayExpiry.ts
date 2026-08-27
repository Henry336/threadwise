import type { Bot } from "grammy";
import { logger } from "../logger";
import { expireTaskCaptureDrafts } from "../services/taskCaptureDrafts";

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
): NodeJS.Timeout | undefined {
  if (!ownerTelegramId) return undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await expireTaskDraftCards(bot, ownerTelegramId); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  return timer;
}
