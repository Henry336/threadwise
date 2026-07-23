import { CaptureKind } from "@prisma/client";
import type { Classification } from "../ai/types";
import { prisma } from "../db/prisma";

export async function createPendingCapture(
  userId: string,
  sourceText: string,
  classification: Classification,
  actorTelegramId?: string | number
) {
  const kind = toPrismaKind(classification.kind);
  return prisma.pendingCapture.create({
    data: {
      userId,
      actorTelegramId: actorTelegramId === undefined ? null : String(actorTelegramId),
      sourceText,
      kind,
      payload: classification,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    }
  });
}

export async function consumePendingCapture(
  userId: string,
  pendingId: string,
  actorTelegramId?: string | number
) {
  const pending = await prisma.pendingCapture.findFirst({
    where: {
      id: pendingId,
      userId,
      ...(actorTelegramId === undefined ? {} : {
        OR: [
          { actorTelegramId: null },
          { actorTelegramId: String(actorTelegramId) }
        ]
      }),
      expiresAt: { gt: new Date() }
    }
  });
  if (!pending) return undefined;

  await prisma.pendingCapture.delete({ where: { id: pending.id } });
  return pending;
}

export async function ignorePendingCapture(
  userId: string,
  pendingId: string,
  actorTelegramId?: string | number
) {
  const result = await prisma.pendingCapture.deleteMany({
    where: {
      id: pendingId,
      userId,
      ...(actorTelegramId === undefined ? {} : {
        OR: [
          { actorTelegramId: null },
          { actorTelegramId: String(actorTelegramId) }
        ]
      })
    }
  });
  return result.count > 0;
}

function toPrismaKind(kind: Classification["kind"]): CaptureKind {
  if (kind === "idea") return CaptureKind.IDEA;
  if (kind === "task") return CaptureKind.TASK;
  if (kind === "note") return CaptureKind.NOTE;
  return CaptureKind.NOISE;
}
