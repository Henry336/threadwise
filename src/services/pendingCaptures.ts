import { CaptureKind } from "@prisma/client";
import type { Classification } from "../ai/types";
import { prisma } from "../db/prisma";

export async function createPendingCapture(userId: string, sourceText: string, classification: Classification) {
  const kind = toPrismaKind(classification.kind);
  return prisma.pendingCapture.create({
    data: {
      userId,
      sourceText,
      kind,
      payload: classification,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    }
  });
}

export async function consumePendingCapture(userId: string, pendingId: string) {
  const pending = await prisma.pendingCapture.findFirstOrThrow({
    where: {
      id: pendingId,
      userId,
      expiresAt: { gt: new Date() }
    }
  });

  await prisma.pendingCapture.delete({ where: { id: pending.id } });
  return pending;
}

export async function ignorePendingCapture(userId: string, pendingId: string) {
  await prisma.pendingCapture.deleteMany({
    where: { id: pendingId, userId }
  });
}

function toPrismaKind(kind: Classification["kind"]): CaptureKind {
  if (kind === "idea") return CaptureKind.IDEA;
  if (kind === "task") return CaptureKind.TASK;
  if (kind === "note") return CaptureKind.NOTE;
  return CaptureKind.NOISE;
}
