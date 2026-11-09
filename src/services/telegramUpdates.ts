/**
 * Webhook deduplication for Telegram updates.
 * src/bot/index.ts calls this before handling any update, because Telegram
 * retries a webhook delivery when a response is slow or fails.
 */
import { prisma } from "../db/prisma";

const RETENTION_DAYS = 7;

/**
 * Records the update id and returns true only for the first delivery.
 * The insert uses skipDuplicates, so a retried update returns false and is skipped.
 * Every 100th update also prunes ids older than RETENTION_DAYS to keep the table small.
 */
export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  const result = await prisma.processedTelegramUpdate.createMany({
    data: [{ updateId }],
    skipDuplicates: true
  });
  if (result.count === 0) {
    return false;
  }

  if (updateId % 100 === 0) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
    await prisma.processedTelegramUpdate.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }

  return true;
}
