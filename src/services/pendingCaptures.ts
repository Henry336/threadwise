/**
 * PendingCapture rows: a message whose type is unclear waits here (24 hours) while its sender picks
 * Task/Reminder/Note/Idea/Ignore on the review card. Used by src/bot/naturalLanguage.ts and callbacks.
 * Rows are bound to the sender and chat, so in a group only the person who wrote the message can act on it.
 * Rows with no recorded actor (the column was added later) remain usable by anyone in the workspace.
 */
import { CaptureKind, type Prisma } from "@prisma/client";
import type { Classification } from "../ai/types";
import { prisma } from "../db/prisma";
import type { TaskCreationOptions, TaskEntityMention } from "./tasks";

/**
 * Holds an ambiguous capture until its sender picks a type. The original message's Telegram
 * mentions go into the payload, because a later button tap or reply carries no entities of its
 * own; without them a review-card save would lose an assignee that /add keeps.
 */
export async function createPendingCapture(
  userId: string,
  sourceText: string,
  classification: Classification,
  actorTelegramId?: string | number,
  telegramChatId?: string | number,
  mentions: TaskEntityMention[] = [],
) {
  const kind = toPrismaKind(classification.kind);
  return prisma.pendingCapture.create({
    data: {
      userId,
      actorTelegramId: actorTelegramId === undefined ? null : String(actorTelegramId),
      telegramChatId: telegramChatId === undefined ? null : String(telegramChatId),
      sourceText,
      kind,
      payload: { ...classification, ...(mentions.length ? { mentions } : {}) },
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    }
  });
}

/** The sender's newest live pending capture in this chat, used by natural corrections like "make that a note". */
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

/**
 * Claims a pending capture for saving by deleting it. Only the caller whose delete removed the row
 * gets it back, so a double tap or a race between two taps saves at most once.
 */
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

/**
 * Records which "when should I remind you?" prompt message belongs to this capture, so only a reply
 * to that exact prompt, from the same sender in the same chat, is read as the reminder time.
 */
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

/** Finds the capture whose reminder prompt the user just replied to (matched by chat and prompt message id). */
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

/** The task options (mentions) saved with a pending capture, read defensively since payload is free-form JSON. */
export function pendingCaptureTaskOptions(pending: { payload: Prisma.JsonValue }): TaskCreationOptions {
  const stored = pending.payload && typeof pending.payload === "object" && !Array.isArray(pending.payload)
    ? (pending.payload as Record<string, unknown>).mentions
    : undefined;
  if (!Array.isArray(stored)) return {};
  const mentions = stored.filter((mention): mention is TaskEntityMention =>
    Boolean(mention) && typeof mention === "object"
    && typeof (mention as TaskEntityMention).offset === "number"
    && typeof (mention as TaskEntityMention).length === "number");
  return mentions.length ? { mentions } : {};
}

function toPrismaKind(kind: Classification["kind"]): CaptureKind {
  if (kind === "idea") return CaptureKind.IDEA;
  if (kind === "task") return CaptureKind.TASK;
  if (kind === "note") return CaptureKind.NOTE;
  return CaptureKind.NOISE;
}

/** Shared filter: the capture's id within this workspace, plus the actor check when an actor is given. */
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
