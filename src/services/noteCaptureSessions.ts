/**
 * Private "note session" mode: while a session is open, each message the user sends is stored as a
 * paragraph (NoteCaptureSegment), and Stop saves them all as one note exactly as written (no AI).
 * A session closes itself after one idle hour; a one-minute loop started from src/main.ts auto-saves it.
 * Driven by src/bot/noteSessions.ts. One session per user, kept in PostgreSQL so it survives restarts.
 */
import type { Bot } from "grammy";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { nextPublicId } from "./publicIds";
import { recordCreateUndo } from "./undo";
import { startLoop, type StopLoop } from "../utils/loop";

/** Idle time before an open session auto-saves. Every new paragraph resets it. */
export const NOTE_CAPTURE_IDLE_MS = 60 * 60_000;
export const NOTE_CAPTURE_POLL_MS = 60_000;

type SessionWithSegments = Prisma.NoteCaptureSessionGetPayload<{
  include: { segments: true };
}>;

export type FinalizedNoteCapture = {
  chatId: string;
  statusMessageId?: number;
  paragraphCount: number;
  note?: {
    id: string;
    publicId: string;
    title: string;
  };
};

export type CanceledNoteCapture = {
  chatId?: string;
  statusMessageId?: number;
  paragraphCount: number;
};

/**
 * Opens a session, or resumes the user's live one. A leftover expired session is saved first
 * so its paragraphs are not lost.
 */
export async function startNoteCaptureSession(userId: string, telegramChatId: string) {
  const existing = await prisma.noteCaptureSession.findUnique({
    where: { userId },
    include: { _count: { select: { segments: true } } }
  });

  if (existing && existing.expiresAt > new Date()) {
    return { session: existing, resumed: true };
  }

  if (existing) {
    await finalizeNoteCaptureSession(userId);
  }

  const session = await prisma.noteCaptureSession.create({
    data: {
      userId,
      telegramChatId,
      expiresAt: nextExpiry()
    },
    include: { _count: { select: { segments: true } } }
  });
  return { session, resumed: false };
}

export async function noteCaptureSessionForTelegramUser(telegramId: string) {
  return prisma.noteCaptureSession.findFirst({
    where: { user: { telegramId } },
    include: { _count: { select: { segments: true } } }
  });
}

/** Stores the id of the session's status card so its paragraph count can be edited in place later. */
export async function rememberNoteCaptureStatusMessage(
  userId: string,
  telegramStatusMessageId: number,
) {
  return prisma.noteCaptureSession.update({
    where: { userId },
    data: { telegramStatusMessageId },
    include: { _count: { select: { segments: true } } },
  });
}

/**
 * Adds one message as a paragraph and pushes the idle expiry forward, in one transaction.
 * A unique key on (session, Telegram message id) turns a redelivered message into "duplicate"
 * instead of a second copy of the paragraph.
 */
export async function appendNoteCaptureParagraph(
  userId: string,
  telegramMessageId: number,
  text: string
): Promise<"saved" | "duplicate" | "expired" | "missing"> {
  const session = await prisma.noteCaptureSession.findUnique({ where: { userId } });
  if (!session) return "missing";
  if (session.expiresAt <= new Date()) return "expired";

  try {
    await prisma.$transaction([
      prisma.noteCaptureSegment.create({
        data: {
          sessionId: session.id,
          telegramMessageId,
          text
        }
      }),
      prisma.noteCaptureSession.update({
        where: { id: session.id },
        data: { expiresAt: nextExpiry() }
      })
    ]);
    return "saved";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "duplicate";
    }
    throw error;
  }
}

/** Throws the session and its paragraphs away without saving a note. */
export async function cancelNoteCaptureSession(userId: string): Promise<CanceledNoteCapture> {
  const session = await prisma.noteCaptureSession.findUnique({
    where: { userId },
    include: { _count: { select: { segments: true } } }
  });
  if (!session) return { paragraphCount: 0 };
  await prisma.noteCaptureSession.delete({ where: { id: session.id } });
  return {
    chatId: session.telegramChatId,
    ...(session.telegramStatusMessageId ? { statusMessageId: session.telegramStatusMessageId } : {}),
    paragraphCount: session._count.segments,
  };
}

/** Saves the user's session now (the Stop action), with paragraphs in Telegram message order. */
export async function finalizeNoteCaptureSession(userId: string): Promise<FinalizedNoteCapture | undefined> {
  const session = await prisma.noteCaptureSession.findUnique({
    where: { userId },
    include: { segments: { orderBy: { telegramMessageId: "asc" } } }
  });
  if (!session) return undefined;
  return finalizeLoadedSession(session);
}

/** Saves up to 50 idle-expired sessions per pass; skips any that got a new paragraph meanwhile. */
export async function finalizeExpiredNoteCaptureSessions(): Promise<FinalizedNoteCapture[]> {
  const expired = await prisma.noteCaptureSession.findMany({
    where: { expiresAt: { lte: new Date() } },
    include: { segments: { orderBy: { telegramMessageId: "asc" } } },
    orderBy: { expiresAt: "asc" },
    take: 50
  });

  const results: FinalizedNoteCapture[] = [];
  for (const session of expired) {
    const result = await finalizeLoadedSession(session, new Date());
    if (result) results.push(result);
  }
  return results;
}

/** Auto-saves note capture sessions that ran out of time. */
export function startNoteCaptureExpiryLoop(bot: Bot, pollMs = NOTE_CAPTURE_POLL_MS): StopLoop {
  return startLoop("Note capture expiry", pollMs, () => autoSaveExpiredSessions(bot));
}

/** Uses the first sentence of the first non-empty paragraph as the title, capped at 84 characters. */
export function deriveCapturedNoteTitle(paragraphs: string[]): string {
  const source = paragraphs.map((paragraph) => paragraph.trim()).find(Boolean) ?? "Untitled note";
  const singleLine = source.replace(/\s+/g, " ").trim();
  const sentence = singleLine.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? singleLine;
  return clampText(sentence, 84);
}

/**
 * Saves a loaded session as one note and deletes the session. With `expiredBy`, the expiry loop
 * asks to finalize only a session that is still expired at that time: a paragraph added since the
 * session was loaded extends its expiry, so the in-transaction check skips it (returns undefined)
 * instead of saving stale segments.
 */
async function finalizeLoadedSession(session: SessionWithSegments, expiredBy?: Date): Promise<FinalizedNoteCapture | undefined> {
  const stillExpired = expiredBy ? { expiresAt: { lte: expiredBy } } : {};
  const paragraphs = session.segments
    .map((segment) => segment.text)
    .filter((text) => text.trim().length > 0);
  const paragraphCount = paragraphs.length;

  if (paragraphCount === 0) {
    const removed = await prisma.noteCaptureSession.deleteMany({ where: { id: session.id, ...stillExpired } });
    if (expiredBy && removed.count === 0) return undefined;
    return { chatId: session.telegramChatId, paragraphCount };
  }

  const body = paragraphs.join("\n\n");
  const title = deriveCapturedNoteTitle(paragraphs);
  const summary = clampText(body.replace(/\s+/g, " ").trim(), 180);

  const note = await prisma.$transaction(async (tx) => {
    const stillExists = await tx.noteCaptureSession.findUnique({ where: { id: session.id } });
    if (!stillExists) return undefined;
    if (expiredBy && stillExists.expiresAt > expiredBy) return "extended" as const;
    const publicId = await nextPublicId(session.userId, "NOTE", tx);
    const created = await tx.note.create({
      data: {
        userId: session.userId,
        publicId,
        title,
        body,
        summary,
        sourceText: body,
        tags: []
      }
    });
    await recordCreateUndo(tx, session.userId, {
      kind: "note",
      id: created.id,
      publicId: created.publicId,
      title: created.title
    });
    await tx.noteCaptureSession.delete({ where: { id: session.id } });
    return created;
  });
  if (note === "extended") return undefined;

  return {
    chatId: session.telegramChatId,
    ...(session.telegramStatusMessageId ? { statusMessageId: session.telegramStatusMessageId } : {}),
    paragraphCount,
    note: note ? { id: note.id, publicId: note.publicId, title: note.title } : undefined
  };
}

/**
 * Loop body: saves expired sessions and tells the user, preferably by editing the existing status
 * card, falling back to a new message. Errors are logged so the loop keeps running.
 */
async function autoSaveExpiredSessions(bot: Bot): Promise<void> {
  try {
    const results = await finalizeExpiredNoteCaptureSessions();
    for (const result of results) {
      const text = result.note
        ? `Auto-saved · ${result.paragraphCount} ${result.paragraphCount === 1 ? "paragraph" : "paragraphs"}\n\nStored exactly as written.`
        : "Empty note session closed.";
      const replyMarkup = result.note
        ? { inline_keyboard: [[{ text: "Open note", callback_data: `item:note:open:${result.note.id}:1` }]] }
        : undefined;
      if (result.statusMessageId) {
        try {
          await bot.api.editMessageText(result.chatId, result.statusMessageId, text, { reply_markup: replyMarkup });
          continue;
        } catch { /* The original status card may no longer be editable. */ }
      }
      await bot.api.sendMessage(result.chatId, text, { reply_markup: replyMarkup });
    }
  } catch (error) {
    logger.error("Could not auto-save expired note capture sessions.", { error: String(error) });
  }
}

function nextExpiry(): Date {
  return new Date(Date.now() + NOTE_CAPTURE_IDLE_MS);
}

/** Truncates by Unicode characters (not UTF-16 units) so emoji are never cut in half. */
function clampText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(1, maxLength - 1)).join("").trimEnd()}…`;
}
