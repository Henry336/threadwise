import { CaptureKind } from "@prisma/client";
import type { Classification } from "../ai/types";
import { prisma } from "../db/prisma";

export async function createPendingCapture(
  userId: string,
  sourceText: string,
  classification: Classification,
  actorTelegramId?: string | number,
  telegramChatId?: string | number,
) {
  const kind = toPrismaKind(classification.kind);
  return prisma.pendingCapture.create({
    data: {
      userId,
      actorTelegramId: actorTelegramId === undefined ? null : String(actorTelegramId),
      telegramChatId: telegramChatId === undefined ? null : String(telegramChatId),
      sourceText,
      kind,
      payload: classification,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    }
  });
}

export async function findLatestPendingCapture(
  userId: string,
  actorTelegramId: string | number,
  telegramChatId: string | number,
) {
  return prisma.pendingCapture.findFirst({
    where: {
      userId,
      actorTelegramId: String(actorTelegramId),
      telegramChatId: String(telegramChatId),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function consumePendingCapture(
  userId: string,
  pendingId: string,
  actorTelegramId?: string | number
) {
  const where = pendingCaptureWhere(userId, pendingId, actorTelegramId);
  const pending = await prisma.pendingCapture.findFirst({
    where: { ...where, expiresAt: { gt: new Date() } }
  });
  if (!pending) return undefined;

  const claimed = await prisma.pendingCapture.deleteMany({
    where: { ...where, id: pending.id, expiresAt: { gt: new Date() } }
  });
  if (claimed.count !== 1) return undefined;
  return pending;
}

export async function findPendingCapture(
  userId: string,
  pendingId: string,
  actorTelegramId?: string | number
) {
  return prisma.pendingCapture.findFirst({
    where: {
      ...pendingCaptureWhere(userId, pendingId, actorTelegramId),
      expiresAt: { gt: new Date() }
    }
  });
}

export async function rememberPendingCaptureReminderPrompt(
  userId: string,
  pendingId: string,
  actorTelegramId: string | number,
  telegramChatId: string | number,
  telegramPromptMessageId: number
): Promise<boolean> {
  const updated = await prisma.pendingCapture.updateMany({
    where: {
      ...pendingCaptureWhere(userId, pendingId, actorTelegramId),
      expiresAt: { gt: new Date() }
    },
    data: {
      telegramChatId: String(telegramChatId),
      telegramPromptMessageId
    }
  });
  return updated.count === 1;
}

export async function findPendingCaptureReminderReply(
  userId: string,
  actorTelegramId: string | number,
  telegramChatId: string | number,
  telegramPromptMessageId: number
) {
  return prisma.pendingCapture.findFirst({
    where: {
      userId,
      OR: [
        { actorTelegramId: null },
        { actorTelegramId: String(actorTelegramId) }
      ],
      telegramChatId: String(telegramChatId),
      telegramPromptMessageId,
      expiresAt: { gt: new Date() }
    }
  });
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

function pendingCaptureWhere(
  userId: string,
  pendingId: string,
  actorTelegramId?: string | number
) {
  return {
    id: pendingId,
    userId,
    ...(actorTelegramId === undefined ? {} : {
      OR: [
        { actorTelegramId: null },
        { actorTelegramId: String(actorTelegramId) }
      ]
    })
  };
}
