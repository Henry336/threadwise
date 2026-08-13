import { randomBytes } from "node:crypto";
import { StudyCaptureBatchStatus, type StudyWorkspace } from "@prisma/client";
import type { Bot } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, h } from "../utils/html";
import { StudyModeError } from "./study";

export const STUDY_CAPTURE_BATCH_SETTLE_MS = 1_800;
export const STUDY_CAPTURE_BATCH_TTL_MS = 5 * 60_000;
export const STUDY_CAPTURE_BATCH_POLL_MS = 1_000;
const STUDY_CAPTURE_BATCH_LEASE_MS = 30_000;

export type StudyImageCaptureInput = {
  moduleId?: string;
  telegramMediaGroupId?: string;
  chatId: string;
  telegramFileId: string;
  telegramUniqueId: string;
  mediaKind: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  sourceMessageId: number;
  sourceSenderTelegramId?: string;
  sourceSentAt?: Date;
};

export async function registerStudyImageCapture(workspace: StudyWorkspace, input: StudyImageCaptureInput) {
  if (input.moduleId) {
    const belongs = await prisma.studyModule.count({ where: { id: input.moduleId, workspaceId: workspace.id, active: true } });
    if (!belongs) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STUDY_CAPTURE_BATCH_TTL_MS);
  const readyAt = new Date(now.getTime() + (input.telegramMediaGroupId ? STUDY_CAPTURE_BATCH_SETTLE_MS : 0));
  const groupKey = input.telegramMediaGroupId ?? `single:${input.chatId}:${input.sourceMessageId}`;

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.studyPendingCapture.findFirst({
      where: { workspaceId: workspace.id, telegramUniqueId: input.telegramUniqueId },
      include: { batch: true },
    });
    if (duplicate?.batch) return { batch: duplicate.batch, capture: duplicate, duplicate: true };

    const existing = await tx.studyPendingCaptureBatch.findUnique({
      where: { workspaceId_telegramMediaGroupId: { workspaceId: workspace.id, telegramMediaGroupId: groupKey } },
    });
    if (existing && (existing.status === StudyCaptureBatchStatus.COMPLETED || existing.status === StudyCaptureBatchStatus.EXPIRED)) {
      return { batch: existing, capture: null, duplicate: true };
    }
    const batch = await tx.studyPendingCaptureBatch.upsert({
      where: { workspaceId_telegramMediaGroupId: { workspaceId: workspace.id, telegramMediaGroupId: groupKey } },
      create: {
          token: randomBytes(9).toString("base64url"),
          workspaceId: workspace.id,
          moduleId: input.moduleId,
          telegramMediaGroupId: groupKey,
          chatId: input.chatId,
          sharedCaption: input.caption?.trim().slice(0, 4_000) || null,
          readyAt,
          expiresAt,
      },
      update: {
        ...(existing?.status === StudyCaptureBatchStatus.COLLECTING ? { readyAt } : {}),
        expiresAt,
        ...(input.moduleId ? { moduleId: input.moduleId } : {}),
        ...(input.caption?.trim() ? { sharedCaption: input.caption.trim().slice(0, 4_000) } : {}),
      },
    });
    const batchPosition = await tx.studyPendingCapture.count({ where: { batchId: batch.id } });
    const capture = await tx.studyPendingCapture.create({
      data: {
        token: randomBytes(9).toString("base64url"),
        workspaceId: workspace.id,
        moduleId: input.moduleId,
        sourceText: input.caption?.slice(0, 4_000),
        telegramFileId: input.telegramFileId,
        telegramUniqueId: input.telegramUniqueId,
        mediaKind: input.mediaKind,
        mimeType: input.mimeType,
        fileName: input.fileName?.slice(0, 500),
        fileSize: input.fileSize,
        sourceMessageId: input.sourceMessageId,
        sourceSenderTelegramId: input.sourceSenderTelegramId,
        sourceSentAt: input.sourceSentAt,
        batchId: batch.id,
        batchPosition,
        expiresAt,
      },
      include: { batch: true },
    });
    return { batch, capture, duplicate: false };
  });
}

export async function findStudyCaptureBatch(workspaceId: string, token: string) {
  const batch = await prisma.studyPendingCaptureBatch.findFirst({
    where: {
      workspaceId,
      token,
      expiresAt: { gt: new Date() },
      status: StudyCaptureBatchStatus.REVIEW,
    },
    include: { captures: { orderBy: [{ batchPosition: "asc" }, { createdAt: "asc" }] }, module: true },
  });
  if (!batch) throw new StudyModeError("That image batch was already handled or expired. Send it again if needed.", "not_found");
  return batch;
}

export async function updateStudyCaptureBatchCaption(workspaceId: string, token: string, caption: string) {
  const batch = await findStudyCaptureBatch(workspaceId, token);
  const sharedCaption = caption.trim().slice(0, 4_000) || null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.studyPendingCaptureBatch.update({ where: { id: batch.id }, data: { sharedCaption } });
    await tx.studyPendingCapture.updateMany({ where: { batchId: batch.id }, data: { sourceText: sharedCaption } });
    return updated;
  });
}

export async function setStudyCaptureBatchReviewMessage(workspaceId: string, token: string, reviewMessageId: number) {
  const current = await prisma.studyPendingCaptureBatch.findFirst({
    where: { workspaceId, token },
    select: { reviewMessageId: true },
  });
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { workspaceId, token, status: StudyCaptureBatchStatus.REVIEW },
    data: { reviewMessageId },
  });
  return current?.reviewMessageId ?? undefined;
}

export async function setStudyCaptureReviewMessageForItem(workspaceId: string, captureToken: string, reviewMessageId: number) {
  const capture = await prisma.studyPendingCapture.findFirst({
    where: { workspaceId, token: captureToken },
    select: { batchId: true, batch: { select: { reviewMessageId: true } } },
  });
  if (!capture?.batchId) return;
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { id: capture.batchId, workspaceId, status: StudyCaptureBatchStatus.REVIEW },
    data: { reviewMessageId },
  });
  return capture.batch?.reviewMessageId ?? undefined;
}

export async function setStudyCaptureBatchModule(workspaceId: string, token: string, moduleId: string) {
  const batch = await findStudyCaptureBatch(workspaceId, token);
  const module = await prisma.studyModule.findFirst({ where: { id: moduleId, workspaceId, active: true } });
  if (!module) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  await prisma.$transaction([
    prisma.studyPendingCaptureBatch.update({ where: { id: batch.id }, data: { moduleId: module.id } }),
    prisma.studyPendingCapture.updateMany({ where: { batchId: batch.id }, data: { moduleId: module.id } }),
  ]);
  return module;
}

export async function beginStudyCaptureBatchProcessing(workspaceId: string, token: string) {
  const now = new Date();
  const batch = await prisma.studyPendingCaptureBatch.findFirst({
    where: { workspaceId, token, expiresAt: { gt: now } },
    include: { captures: { orderBy: [{ batchPosition: "asc" }, { createdAt: "asc" }] }, module: true },
  });
  const claimable = batch && (
    batch.status === StudyCaptureBatchStatus.REVIEW
    || (batch.status === StudyCaptureBatchStatus.PROCESSING && (!batch.leaseExpiresAt || batch.leaseExpiresAt <= now))
  );
  if (!claimable) throw new StudyModeError("That image batch was already handled or is currently being saved.", "conflict");
  const claimed = await prisma.studyPendingCaptureBatch.updateMany({
    where: {
      id: batch.id,
      workspaceId,
      OR: [
        { status: StudyCaptureBatchStatus.REVIEW },
        { status: StudyCaptureBatchStatus.PROCESSING, leaseExpiresAt: { lte: now } },
      ],
    },
    data: { status: StudyCaptureBatchStatus.PROCESSING, leaseExpiresAt: new Date(now.getTime() + STUDY_CAPTURE_BATCH_LEASE_MS) },
  });
  if (claimed.count !== 1) throw new StudyModeError("That image batch is currently being saved.", "conflict");
  return batch;
}

export async function completeStudyCaptureBatch(workspaceId: string, batchId: string) {
  return prisma.$transaction([
    prisma.studyPendingCapture.deleteMany({ where: { workspaceId, batchId } }),
    prisma.studyPendingCaptureBatch.updateMany({
      where: { id: batchId, workspaceId, status: StudyCaptureBatchStatus.PROCESSING },
      data: { status: StudyCaptureBatchStatus.COMPLETED, completedAt: new Date(), leaseExpiresAt: null },
    }),
  ]);
}

export async function releaseStudyCaptureBatch(workspaceId: string, batchId: string) {
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { id: batchId, workspaceId, status: StudyCaptureBatchStatus.PROCESSING },
    data: { status: StudyCaptureBatchStatus.REVIEW, leaseExpiresAt: null },
  });
}

export async function ignoreStudyCaptureBatch(workspaceId: string, token: string) {
  const batch = await findStudyCaptureBatch(workspaceId, token);
  await prisma.$transaction([
    prisma.studyPendingCapture.deleteMany({ where: { workspaceId, batchId: batch.id } }),
    prisma.studyPendingCaptureBatch.update({
      where: { id: batch.id },
      data: { status: StudyCaptureBatchStatus.COMPLETED, completedAt: new Date(), leaseExpiresAt: null },
    }),
  ]);
}

export function studyCaptureBatchKeyboard(token: string) {
  return {
    inline_keyboard: [
      [{ text: "Save all images", callback_data: `study:capb:save:${token}` }],
      [
        { text: "Add shared caption", callback_data: `study:capb:caption:${token}` },
        { text: "Choose module", callback_data: `study:capb:choose:${token}` },
      ],
      [{ text: "Cancel batch", callback_data: `study:capb:ignore:${token}` }],
    ],
  };
}

export function startStudyCaptureBatchLoop(bot: Bot, pollMs = STUDY_CAPTURE_BATCH_POLL_MS): NodeJS.Timeout {
  void processStudyCaptureBatches(bot);
  const timer = setInterval(() => void processStudyCaptureBatches(bot), pollMs);
  timer.unref?.();
  return timer;
}

export async function processStudyCaptureBatches(bot: Bot, now = new Date()): Promise<void> {
  try {
    await recoverExpiredBatchLeases(now);
    await expireStudyCaptureBatches(bot, now);
    const ready = await prisma.studyPendingCaptureBatch.findMany({
      where: { status: StudyCaptureBatchStatus.COLLECTING, readyAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { readyAt: "asc" },
      take: 20,
    });
    for (const candidate of ready) {
      const claimed = await prisma.studyPendingCaptureBatch.updateMany({
        where: { id: candidate.id, status: StudyCaptureBatchStatus.COLLECTING, readyAt: { lte: now }, expiresAt: { gt: now } },
        data: { status: StudyCaptureBatchStatus.SENDING, leaseExpiresAt: new Date(now.getTime() + STUDY_CAPTURE_BATCH_LEASE_MS) },
      });
      if (claimed.count !== 1) continue;
      try {
        const batch = await prisma.studyPendingCaptureBatch.findUnique({
          where: { id: candidate.id },
          include: { captures: { orderBy: [{ batchPosition: "asc" }, { createdAt: "asc" }] }, module: true },
        });
        if (!batch?.captures.length) {
          await markBatchExpired(batch?.id ?? candidate.id);
          continue;
        }
        const memberCount = await bot.api.getChatMemberCount(batch.chatId).catch(() => undefined);
        if (memberCount !== 2) {
          await prisma.studyPendingCaptureBatch.updateMany({
            where: { id: batch.id, status: StudyCaptureBatchStatus.SENDING },
            data: { status: StudyCaptureBatchStatus.COLLECTING, readyAt: new Date(Date.now() + 30_000), leaseExpiresAt: null },
          });
          continue;
        }
        const one = batch.captures.length === 1;
        const capture = batch.captures[0]!;
        const message = await bot.api.sendMessage(batch.chatId, [
          bold(one ? "Image capture" : `${batch.captures.length} image captures`),
          batch.module ? `Module · ${bold(batch.module.code)}` : "Module · choose one",
          batch.sharedCaption ? `Caption · ${h(batch.sharedCaption)}` : "Caption · none",
          "This choice expires in about 5 minutes.",
        ].join("\n\n"), {
          parse_mode: "HTML",
          reply_markup: one ? singleImageCaptureKeyboard(capture.token) : studyCaptureBatchKeyboard(batch.token),
        });
        await prisma.studyPendingCaptureBatch.updateMany({
          where: { id: batch.id, status: StudyCaptureBatchStatus.SENDING },
          data: { status: StudyCaptureBatchStatus.REVIEW, reviewMessageId: message.message_id, leaseExpiresAt: null },
        });
      } catch (error) {
        logger.warn("Could not publish a Study image capture review.", { batchId: candidate.id, error: String(error) });
        await prisma.studyPendingCaptureBatch.updateMany({
          where: { id: candidate.id, status: StudyCaptureBatchStatus.SENDING },
          data: { status: StudyCaptureBatchStatus.COLLECTING, readyAt: new Date(Date.now() + 5_000), leaseExpiresAt: null },
        });
      }
    }
    await prisma.studyPendingCaptureBatch.deleteMany({
      where: { status: { in: [StudyCaptureBatchStatus.COMPLETED, StudyCaptureBatchStatus.EXPIRED] }, updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
    });
  } catch (error) {
    logger.error("Could not process Study image capture batches.", { error: String(error) });
  }
}

async function recoverExpiredBatchLeases(now: Date) {
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { status: StudyCaptureBatchStatus.SENDING, leaseExpiresAt: { lte: now }, expiresAt: { gt: now } },
    data: { status: StudyCaptureBatchStatus.COLLECTING, leaseExpiresAt: null },
  });
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { status: StudyCaptureBatchStatus.PROCESSING, leaseExpiresAt: { lte: now }, expiresAt: { gt: now } },
    data: { status: StudyCaptureBatchStatus.REVIEW, leaseExpiresAt: null },
  });
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { status: StudyCaptureBatchStatus.EXPIRING, leaseExpiresAt: { lte: now } },
    data: { status: StudyCaptureBatchStatus.REVIEW, leaseExpiresAt: null },
  });
}

async function expireStudyCaptureBatches(bot: Bot, now: Date) {
  const expired = await prisma.studyPendingCaptureBatch.findMany({
    where: {
      expiresAt: { lte: now },
      status: { in: [StudyCaptureBatchStatus.COLLECTING, StudyCaptureBatchStatus.REVIEW, StudyCaptureBatchStatus.SENDING, StudyCaptureBatchStatus.PROCESSING] },
    },
    orderBy: { expiresAt: "asc" },
    take: 30,
  });
  for (const batch of expired) {
    const claimed = await prisma.studyPendingCaptureBatch.updateMany({
      where: { id: batch.id, status: batch.status },
      data: { status: StudyCaptureBatchStatus.EXPIRING, leaseExpiresAt: new Date(now.getTime() + STUDY_CAPTURE_BATCH_LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    try {
      if (batch.reviewMessageId) await bot.api.deleteMessage(batch.chatId, batch.reviewMessageId).catch(() => undefined);
      await markBatchExpired(batch.id);
    } catch (error) {
      logger.warn("Could not expire a Study image capture batch.", { batchId: batch.id, error: String(error) });
    }
  }
}

async function markBatchExpired(batchId: string) {
  await prisma.$transaction([
    prisma.studyPendingCapture.deleteMany({ where: { batchId } }),
    prisma.studyPendingCaptureBatch.updateMany({
      where: { id: batchId },
      data: { status: StudyCaptureBatchStatus.EXPIRED, leaseExpiresAt: null },
    }),
  ]);
}

function singleImageCaptureKeyboard(token: string) {
  return {
    inline_keyboard: [
      [
        { text: "Save image", callback_data: `study:cap:image:${token}` },
        { text: "Add caption", callback_data: `study:cap:caption:${token}` },
      ],
      [{ text: "Extract text", callback_data: `study:cap:ocr:${token}` }],
      [
        { text: "Choose module", callback_data: `study:cap:choose:${token}` },
        { text: "Cancel", callback_data: `study:cap:ignore:${token}` },
      ],
    ],
  };
}
