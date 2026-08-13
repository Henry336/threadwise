import { randomBytes } from "node:crypto";
import { ImageUploadBatchStatus } from "@prisma/client";
import type { Bot } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, code, h } from "../utils/html";
import { nextPublicId } from "./publicIds";

export const IMAGE_UPLOAD_BATCH_SETTLE_MS = 1_800;
export const IMAGE_UPLOAD_BATCH_TTL_MS = 24 * 60 * 60_000;
export const IMAGE_UPLOAD_BATCH_POLL_MS = 1_000;
const IMAGE_UPLOAD_BATCH_LEASE_MS = 30_000;

export type ImageUploadBatchInput = {
  userId: string;
  chatId: string;
  telegramMediaGroupId: string;
  sourceMessageId: number;
  telegramFileId: string;
  telegramUniqueId?: string;
  mediaKind: "photo" | "document";
  mimeType?: string;
  fileName?: string;
  caption?: string;
  fileSize?: number;
};

export async function hasOpenImageUploadBatch(userId: string, chatId: string, telegramMediaGroupId: string) {
  const count = await prisma.pendingImageUploadBatch.count({
    where: {
      userId,
      chatId,
      telegramMediaGroupId,
      status: { in: [ImageUploadBatchStatus.COLLECTING, ImageUploadBatchStatus.REVIEW] },
      expiresAt: { gt: new Date() },
    },
  });
  return count > 0;
}

export async function registerImageUploadBatchItem(input: ImageUploadBatchInput) {
  const now = new Date();
  const readyAt = new Date(now.getTime() + IMAGE_UPLOAD_BATCH_SETTLE_MS);
  const expiresAt = new Date(now.getTime() + IMAGE_UPLOAD_BATCH_TTL_MS);

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.pendingImageUpload.findFirst({
      where: { userId: input.userId, sourceChatId: input.chatId, sourceMessageId: input.sourceMessageId },
      include: { batch: true },
    });
    if (duplicate?.batch) return { batch: duplicate.batch, upload: duplicate, duplicate: true };

    const existing = await tx.pendingImageUploadBatch.findUnique({
      where: {
        userId_chatId_telegramMediaGroupId: {
          userId: input.userId,
          chatId: input.chatId,
          telegramMediaGroupId: input.telegramMediaGroupId,
        },
      },
    });
    if (existing
      && existing.status !== ImageUploadBatchStatus.COLLECTING
      && existing.status !== ImageUploadBatchStatus.REVIEW) {
      return { batch: existing, upload: null, duplicate: true };
    }

    const sharedCaption = input.caption?.trim().slice(0, 4_000) || null;
    const batch = await tx.pendingImageUploadBatch.upsert({
      where: {
        userId_chatId_telegramMediaGroupId: {
          userId: input.userId,
          chatId: input.chatId,
          telegramMediaGroupId: input.telegramMediaGroupId,
        },
      },
      create: {
        token: randomBytes(9).toString("base64url"),
        userId: input.userId,
        chatId: input.chatId,
        telegramMediaGroupId: input.telegramMediaGroupId,
        sharedCaption,
        readyAt,
        expiresAt,
      },
      update: {
        status: ImageUploadBatchStatus.COLLECTING,
        readyAt,
        expiresAt,
        awaitingCaption: false,
        ...(sharedCaption ? { sharedCaption } : {}),
      },
    });
    const upload = await tx.pendingImageUpload.create({
      data: {
        userId: input.userId,
        telegramFileId: input.telegramFileId,
        telegramUniqueId: input.telegramUniqueId,
        mediaKind: input.mediaKind,
        mimeType: input.mimeType,
        fileName: input.fileName?.slice(0, 500),
        caption: sharedCaption ?? batch.sharedCaption,
        fileSize: input.fileSize,
        sourceChatId: input.chatId,
        sourceMessageId: input.sourceMessageId,
        batchId: batch.id,
        batchPosition: input.sourceMessageId,
        expiresAt,
      },
      include: { batch: true },
    });
    if (sharedCaption) {
      await tx.pendingImageUpload.updateMany({ where: { batchId: batch.id }, data: { caption: sharedCaption } });
    }
    return { batch, upload, duplicate: false };
  });
}

export async function findImageUploadBatch(userId: string, token: string) {
  const batch = await prisma.pendingImageUploadBatch.findFirst({
    where: { userId, token, status: ImageUploadBatchStatus.REVIEW, expiresAt: { gt: new Date() } },
    include: { uploads: { orderBy: [{ batchPosition: "asc" }, { createdAt: "asc" }] } },
  });
  if (!batch) throw new Error("That image batch was already handled or expired. Send it again if needed.");
  return batch;
}

export async function beginImageUploadBatchCaption(userId: string, token: string) {
  const batch = await findImageUploadBatch(userId, token);
  await prisma.$transaction([
    prisma.pendingImageUploadBatch.updateMany({ where: { userId, awaitingCaption: true }, data: { awaitingCaption: false } }),
    prisma.pendingImageUploadBatch.update({ where: { id: batch.id }, data: { awaitingCaption: true } }),
  ]);
  return batch;
}

export async function cancelImageUploadBatchCaption(userId: string, token: string) {
  const updated = await prisma.pendingImageUploadBatch.updateMany({
    where: { userId, token, status: ImageUploadBatchStatus.REVIEW },
    data: { awaitingCaption: false },
  });
  return updated.count > 0;
}

export async function applyPendingImageUploadBatchCaption(userId: string, caption: string) {
  const sharedCaption = caption.trim().slice(0, 4_000);
  if (!sharedCaption) return undefined;
  const batch = await prisma.pendingImageUploadBatch.findFirst({
    where: {
      userId,
      awaitingCaption: true,
      status: ImageUploadBatchStatus.REVIEW,
      expiresAt: { gt: new Date() },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!batch) return undefined;
  await prisma.$transaction([
    prisma.pendingImageUploadBatch.update({
      where: { id: batch.id },
      data: { sharedCaption, awaitingCaption: false },
    }),
    prisma.pendingImageUpload.updateMany({ where: { batchId: batch.id }, data: { caption: sharedCaption } }),
  ]);
  return findImageUploadBatch(userId, batch.token);
}

export async function discardImageUploadBatch(userId: string, token: string) {
  const batch = await findImageUploadBatch(userId, token);
  await prisma.$transaction([
    prisma.pendingImageUpload.deleteMany({ where: { userId, batchId: batch.id } }),
    prisma.pendingImageUploadBatch.update({
      where: { id: batch.id },
      data: {
        status: ImageUploadBatchStatus.COMPLETED,
        completedAt: new Date(),
        awaitingCaption: false,
        leaseExpiresAt: null,
      },
    }),
  ]);
}

export async function saveImageUploadBatch(userId: string, token: string) {
  const now = new Date();
  const batch = await prisma.pendingImageUploadBatch.findFirst({
    where: { userId, token, expiresAt: { gt: now } },
  });
  const claimable = batch && (
    batch.status === ImageUploadBatchStatus.REVIEW
    || (batch.status === ImageUploadBatchStatus.PROCESSING && (!batch.leaseExpiresAt || batch.leaseExpiresAt <= now))
  );
  if (!claimable) throw new Error("That image batch was already handled or is currently being saved.");
  const claimed = await prisma.pendingImageUploadBatch.updateMany({
    where: {
      id: batch.id,
      userId,
      OR: [
        { status: ImageUploadBatchStatus.REVIEW },
        { status: ImageUploadBatchStatus.PROCESSING, leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: ImageUploadBatchStatus.PROCESSING,
      awaitingCaption: false,
      leaseExpiresAt: new Date(now.getTime() + IMAGE_UPLOAD_BATCH_LEASE_MS),
    },
  });
  if (claimed.count !== 1) throw new Error("That image batch is currently being saved.");

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.pendingImageUploadBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { uploads: { orderBy: [{ batchPosition: "asc" }, { createdAt: "asc" }] } },
      });
      const images: Array<{ publicId: string; caption: string | null; duplicate: boolean }> = [];
      for (const pending of current.uploads) {
        const existing = pending.telegramUniqueId
          ? await tx.storedImage.findFirst({ where: { userId, telegramUniqueId: pending.telegramUniqueId } })
          : undefined;
        if (existing) {
          images.push({ publicId: existing.publicId, caption: existing.caption, duplicate: true });
          continue;
        }
        const publicId = await nextPublicId(userId, "IMG", tx);
        const image = await tx.storedImage.create({
          data: {
            userId,
            publicId,
            telegramFileId: pending.telegramFileId,
            telegramUniqueId: pending.telegramUniqueId,
            mediaKind: pending.mediaKind,
            mimeType: pending.mimeType,
            fileName: pending.fileName,
            caption: current.sharedCaption ?? pending.caption,
          },
        });
        images.push({ publicId: image.publicId, caption: image.caption, duplicate: false });
      }
      await tx.pendingImageUpload.deleteMany({ where: { userId, batchId: current.id } });
      await tx.pendingImageUploadBatch.update({
        where: { id: current.id },
        data: {
          status: ImageUploadBatchStatus.COMPLETED,
          completedAt: new Date(),
          awaitingCaption: false,
          leaseExpiresAt: null,
        },
      });
      return { images, caption: current.sharedCaption };
    });
  } catch (error) {
    await prisma.pendingImageUploadBatch.updateMany({
      where: { id: batch.id, userId, status: ImageUploadBatchStatus.PROCESSING },
      data: { status: ImageUploadBatchStatus.REVIEW, leaseExpiresAt: null },
    });
    throw error;
  }
}

export function formatImageUploadBatchReview(batch: { uploads: unknown[]; sharedCaption: string | null }) {
  return [
    bold(`${batch.uploads.length} images received`),
    batch.sharedCaption ? `Shared caption · ${h(batch.sharedCaption)}` : "Shared caption · none",
    "Save the whole album once, or add one caption that will be applied to every image.",
  ].join("\n\n");
}

export function formatImageUploadBatchSaved(result: Awaited<ReturnType<typeof saveImageUploadBatch>>) {
  const duplicates = result.images.filter((image) => image.duplicate).length;
  return [
    bold(`✅ ${result.images.length} images saved`),
    result.caption ? `Shared caption · ${h(result.caption)}` : "Saved without a caption.",
    `Image IDs · ${result.images.map((image) => code(image.publicId)).join(", ")}`,
    duplicates ? `${duplicates} ${duplicates === 1 ? "image was" : "images were"} already in your library.` : undefined,
    `Browse them with ${code("/images")}.`,
  ].filter(Boolean).join("\n");
}

export function imageUploadBatchKeyboard(token: string) {
  return {
    inline_keyboard: [
      [{ text: "🖼️ Save all images", callback_data: `image-batch:save:${token}` }],
      [{ text: "✏️ Add shared caption", callback_data: `image-batch:caption:${token}` }],
      [{ text: "✕ Discard album", callback_data: `image-batch:discard:${token}` }],
    ],
  };
}

export function imageUploadBatchCaptionKeyboard(token: string) {
  return { inline_keyboard: [[{ text: "✕ Cancel caption", callback_data: `image-batch:caption-cancel:${token}` }]] };
}

export function startImageUploadBatchLoop(bot: Bot, pollMs = IMAGE_UPLOAD_BATCH_POLL_MS): NodeJS.Timeout {
  void processImageUploadBatches(bot);
  const timer = setInterval(() => void processImageUploadBatches(bot), pollMs);
  timer.unref?.();
  return timer;
}

export async function processImageUploadBatches(bot: Bot, now = new Date()): Promise<void> {
  try {
    await recoverExpiredLeases(now);
    await expireBatches(bot, now);
    const ready = await prisma.pendingImageUploadBatch.findMany({
      where: { status: ImageUploadBatchStatus.COLLECTING, readyAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { readyAt: "asc" },
      take: 20,
    });
    for (const candidate of ready) {
      const claimed = await prisma.pendingImageUploadBatch.updateMany({
        where: { id: candidate.id, status: ImageUploadBatchStatus.COLLECTING, readyAt: { lte: now }, expiresAt: { gt: now } },
        data: { status: ImageUploadBatchStatus.SENDING, leaseExpiresAt: new Date(now.getTime() + IMAGE_UPLOAD_BATCH_LEASE_MS) },
      });
      if (claimed.count !== 1) continue;
      try {
        const batch = await prisma.pendingImageUploadBatch.findUnique({
          where: { id: candidate.id },
          include: { uploads: { orderBy: [{ batchPosition: "asc" }, { createdAt: "asc" }] } },
        });
        if (!batch?.uploads.length) {
          await markBatchExpired(candidate.id);
          continue;
        }
        if (batch.reviewMessageId) {
          await bot.api.deleteMessage(batch.chatId, batch.reviewMessageId).catch(() => undefined);
        }
        const message = await bot.api.sendMessage(batch.chatId, formatImageUploadBatchReview(batch), {
          parse_mode: "HTML",
          reply_markup: imageUploadBatchKeyboard(batch.token),
        });
        await prisma.pendingImageUploadBatch.updateMany({
          where: { id: batch.id, status: ImageUploadBatchStatus.SENDING },
          data: { status: ImageUploadBatchStatus.REVIEW, reviewMessageId: message.message_id, leaseExpiresAt: null },
        });
      } catch (error) {
        logger.warn("Could not publish an image album review.", { batchId: candidate.id, error: String(error) });
        await prisma.pendingImageUploadBatch.updateMany({
          where: { id: candidate.id, status: ImageUploadBatchStatus.SENDING },
          data: { status: ImageUploadBatchStatus.COLLECTING, readyAt: new Date(Date.now() + 5_000), leaseExpiresAt: null },
        });
      }
    }
    await prisma.pendingImageUploadBatch.deleteMany({
      where: {
        status: { in: [ImageUploadBatchStatus.COMPLETED, ImageUploadBatchStatus.EXPIRED] },
        updatedAt: { lt: new Date(now.getTime() - IMAGE_UPLOAD_BATCH_TTL_MS) },
      },
    });
  } catch (error) {
    logger.error("Could not process image upload batches.", { error: String(error) });
  }
}

async function recoverExpiredLeases(now: Date) {
  await prisma.pendingImageUploadBatch.updateMany({
    where: { status: ImageUploadBatchStatus.SENDING, leaseExpiresAt: { lte: now }, expiresAt: { gt: now } },
    data: { status: ImageUploadBatchStatus.COLLECTING, leaseExpiresAt: null },
  });
  await prisma.pendingImageUploadBatch.updateMany({
    where: { status: ImageUploadBatchStatus.PROCESSING, leaseExpiresAt: { lte: now }, expiresAt: { gt: now } },
    data: { status: ImageUploadBatchStatus.REVIEW, leaseExpiresAt: null },
  });
  await prisma.pendingImageUploadBatch.updateMany({
    where: { status: ImageUploadBatchStatus.EXPIRING, leaseExpiresAt: { lte: now } },
    data: { status: ImageUploadBatchStatus.REVIEW, leaseExpiresAt: null },
  });
}

async function expireBatches(bot: Bot, now: Date) {
  const expired = await prisma.pendingImageUploadBatch.findMany({
    where: {
      expiresAt: { lte: now },
      status: { in: [ImageUploadBatchStatus.COLLECTING, ImageUploadBatchStatus.REVIEW, ImageUploadBatchStatus.SENDING, ImageUploadBatchStatus.PROCESSING] },
    },
    orderBy: { expiresAt: "asc" },
    take: 30,
  });
  for (const batch of expired) {
    const claimed = await prisma.pendingImageUploadBatch.updateMany({
      where: { id: batch.id, status: batch.status },
      data: { status: ImageUploadBatchStatus.EXPIRING, leaseExpiresAt: new Date(now.getTime() + IMAGE_UPLOAD_BATCH_LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    try {
      if (batch.reviewMessageId) await bot.api.deleteMessage(batch.chatId, batch.reviewMessageId).catch(() => undefined);
      await markBatchExpired(batch.id);
    } catch (error) {
      logger.warn("Could not expire an image upload batch.", { batchId: batch.id, error: String(error) });
    }
  }
}

async function markBatchExpired(batchId: string) {
  await prisma.$transaction([
    prisma.pendingImageUpload.deleteMany({ where: { batchId } }),
    prisma.pendingImageUploadBatch.updateMany({
      where: { id: batchId },
      data: { status: ImageUploadBatchStatus.EXPIRED, awaitingCaption: false, leaseExpiresAt: null },
    }),
  ]);
}
