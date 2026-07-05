import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

const RETENTION_DAYS = 7;

export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  try {
    await prisma.processedTelegramUpdate.create({ data: { updateId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }

    throw error;
  }

  if (updateId % 100 === 0) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
    await prisma.processedTelegramUpdate.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }

  return true;
}
