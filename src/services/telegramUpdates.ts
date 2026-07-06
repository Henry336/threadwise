import { prisma } from "../db/prisma";

const RETENTION_DAYS = 7;

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
