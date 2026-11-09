/**
 * Groups Study images sent to Telegram (one photo or a whole album) into one review card.
 * Each image is stored as a pending capture inside a batch row that moves through
 * COLLECTING, SENDING, REVIEW, PROCESSING and ends COMPLETED or EXPIRED. Called from the
 * Study capture handlers in src/bot/studyCapture.ts; the loop is started in main.ts.
 */
import { randomBytes } from "node:crypto";
import { StudyCaptureBatchStatus, type StudyWorkspace } from "@prisma/client";
import type { Api, Bot } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, h } from "../utils/html";
import { StudyModeError } from "./study";
import { startLoop, type StopLoop } from "../utils/loop";

/** Wait for the rest of a Telegram album to arrive before posting one review card. */
export const STUDY_CAPTURE_BATCH_SETTLE_MS = 1_800;
export const STUDY_CAPTURE_BATCH_TTL_MS = 5 * 60_000;
// New captures wake the processor directly. This interval only recovers work
// after restarts or transient errors, so it must not hammer external Postgres.
export const STUDY_CAPTURE_BATCH_POLL_MS = 5 * 60_000;
const STUDY_CAPTURE_BATCH_LEASE_MS = 30_000;
let activeStudyCaptureBatchPass: Promise<void> | undefined;
type TelegramApiClient = { api: Api };

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

/**
 * Adds one incoming image to its batch (keyed by Telegram media group, or by message for a
 * single photo) in one transaction. Telegram can redeliver updates, so an image already
 * seen (same file unique id) or a batch already finished is returned as a duplicate
 * instead of being added twice. While collecting, each new image pushes the ready time back.
 */
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

/** Loads a batch awaiting review by its button token, scoped to the workspace; throws if handled or expired. */
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

/** Sets one shared caption on the batch and copies it to every image in it. */
export async function updateStudyCaptureBatchCaption(workspaceId: string, token: string, caption: string) {
  const batch = await findStudyCaptureBatch(workspaceId, token);
  const sharedCaption = caption.trim().slice(0, 4_000) || null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.studyPendingCaptureBatch.update({ where: { id: batch.id }, data: { sharedCaption } });
    await tx.studyPendingCapture.updateMany({ where: { batchId: batch.id }, data: { sourceText: sharedCaption } });
    return updated;
  });
}

/**
 * Records which Telegram message now shows the review card and returns the previous one,
 * so the caller can delete the old card and keep only one visible.
 */
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

/** Same as above, but found through a single image's capture token (single-photo cards). */
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

/** Assigns the module for the whole batch after checking it is an active module of this workspace. */
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

/**
 * Claims a batch for saving with a 30-second lease (REVIEW to PROCESSING). The conditional
 * update means a double-tapped "Save all" saves once; a lease left by a crash can be
 * reclaimed after it expires. Pair with completeStudyCaptureBatch or releaseStudyCaptureBatch.
 */
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

/** After a successful save: deletes the pending image rows and marks the batch COMPLETED. */
export async function completeStudyCaptureBatch(workspaceId: string, batchId: string) {
  return prisma.$transaction([
    prisma.studyPendingCapture.deleteMany({ where: { workspaceId, batchId } }),
    prisma.studyPendingCaptureBatch.updateMany({
      where: { id: batchId, workspaceId, status: StudyCaptureBatchStatus.PROCESSING },
      data: { status: StudyCaptureBatchStatus.COMPLETED, completedAt: new Date(), leaseExpiresAt: null },
    }),
  ]);
}

/** After a failed save: returns the batch to REVIEW so the owner can try again. */
export async function releaseStudyCaptureBatch(workspaceId: string, batchId: string) {
  await prisma.studyPendingCaptureBatch.updateMany({
    where: { id: batchId, workspaceId, status: StudyCaptureBatchStatus.PROCESSING },
    data: { status: StudyCaptureBatchStatus.REVIEW, leaseExpiresAt: null },
  });
}

/** "Cancel batch": drops the pending images without saving anything. */
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

/** Album review buttons; callbacks carry the batch token and are handled in src/bot/studyCapture.ts. */
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

/** Restart-recovery sweep for Study capture albums; normal processing is triggered by each upload. */
export function startStudyCaptureBatchLoop(bot: Bot, pollMs = STUDY_CAPTURE_BATCH_POLL_MS): StopLoop {
  return startLoop("Study capture batch", pollMs, () => processStudyCaptureBatches(bot), { runImmediately: true });
}

/**
 * Called after each upload: runs a pass just after the album settle window. This replaced
 * the old one-second database polling that caused the September 2026 bandwidth bill.
 */
export function scheduleStudyCaptureBatchProcessing(api: Api, delayMs = STUDY_CAPTURE_BATCH_SETTLE_MS + 100): NodeJS.Timeout {
  const timer = setTimeout(() => void processStudyCaptureBatches({ api }), Math.max(0, delayMs));
  timer.unref?.();
  return timer;
}

/** Single-flight entry point: if a pass is already running, callers share it instead of starting another. */
export function processStudyCaptureBatches(bot: TelegramApiClient, now = new Date()): Promise<void> {
  if (activeStudyCaptureBatchPass) return activeStudyCaptureBatchPass;
  const pass = processStudyCaptureBatchesOnce(bot, now).finally(() => {
    if (activeStudyCaptureBatchPass === pass) activeStudyCaptureBatchPass = undefined;
  });
  activeStudyCaptureBatchPass = pass;
  return pass;
}

/**
 * One pass: recover stale leases, expire old batches, then post a review card for each
 * settled batch (claimed COLLECTING to SENDING first so it is posted once). It fails closed:
 * if the Study chat does not have exactly two members, no card is sent and the batch waits.
 * Send failures retry shortly. Finished batches older than a day are deleted.
 */
async function processStudyCaptureBatchesOnce(bot: TelegramApiClient, now: Date): Promise<void> {
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

/** Undoes claims whose lease ran out (for example after a crash) so the step can be retried. */
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

/** Expires unfinished batches past their five-minute window and deletes their review card from the chat. */
async function expireStudyCaptureBatches(bot: TelegramApiClient, now: Date) {
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

/** Deletes the batch's pending images and marks it EXPIRED, atomically. */
async function markBatchExpired(batchId: string) {
  await prisma.$transaction([
    prisma.studyPendingCapture.deleteMany({ where: { batchId } }),
    prisma.studyPendingCaptureBatch.updateMany({
      where: { id: batchId },
      data: { status: StudyCaptureBatchStatus.EXPIRED, leaseExpiresAt: null },
    }),
  ]);
}

/** A single photo gets per-image actions (including OCR) instead of the album buttons. */
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
