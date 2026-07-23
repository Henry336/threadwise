import type { Bot } from "grammy";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { nextPublicId } from "./publicIds";
import { recordCreateUndo } from "./undo";

export const NOTE_CAPTURE_IDLE_MS = 30 * 60_000;
export const NOTE_CAPTURE_POLL_MS = 60_000;

type SessionWithSegments = Prisma.NoteCaptureSessionGetPayload<{
  include: { segments: true };
}>;

export type FinalizedNoteCapture = {
  chatId: string;
  paragraphCount: number;
  note?: {
    id: string;
    publicId: string;
    title: string;
  };
};

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

export async function cancelNoteCaptureSession(userId: string): Promise<number> {
  const session = await prisma.noteCaptureSession.findUnique({
    where: { userId },
    include: { _count: { select: { segments: true } } }
  });
  if (!session) return 0;
  await prisma.noteCaptureSession.delete({ where: { id: session.id } });
  return session._count.segments;
}

export async function finalizeNoteCaptureSession(userId: string): Promise<FinalizedNoteCapture | undefined> {
  const session = await prisma.noteCaptureSession.findUnique({
    where: { userId },
    include: { segments: { orderBy: { telegramMessageId: "asc" } } }
  });
  if (!session) return undefined;
  return finalizeLoadedSession(session);
}

export async function finalizeExpiredNoteCaptureSessions(): Promise<FinalizedNoteCapture[]> {
  const expired = await prisma.noteCaptureSession.findMany({
    where: { expiresAt: { lte: new Date() } },
    include: { segments: { orderBy: { telegramMessageId: "asc" } } },
    orderBy: { expiresAt: "asc" },
    take: 50
  });

  const results: FinalizedNoteCapture[] = [];
  for (const session of expired) {
    const current = await prisma.noteCaptureSession.findUnique({
      where: { id: session.id },
      include: { segments: { orderBy: { telegramMessageId: "asc" } } }
    });
    if (!current || current.expiresAt > new Date()) continue;
    results.push(await finalizeLoadedSession(current));
  }
  return results;
}

export function startNoteCaptureExpiryLoop(bot: Bot, pollMs = NOTE_CAPTURE_POLL_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    void autoSaveExpiredSessions(bot);
  }, pollMs);
  timer.unref?.();
  return timer;
}

export function deriveCapturedNoteTitle(paragraphs: string[]): string {
  const source = paragraphs.map((paragraph) => paragraph.trim()).find(Boolean) ?? "Untitled note";
  const singleLine = source.replace(/\s+/g, " ").trim();
  const sentence = singleLine.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? singleLine;
  return clampText(sentence, 84);
}

async function finalizeLoadedSession(session: SessionWithSegments): Promise<FinalizedNoteCapture> {
  const paragraphs = session.segments
    .map((segment) => segment.text)
    .filter((text) => text.trim().length > 0);
  const paragraphCount = paragraphs.length;

  if (paragraphCount === 0) {
    await prisma.noteCaptureSession.deleteMany({ where: { id: session.id } });
    return { chatId: session.telegramChatId, paragraphCount };
  }

  const body = paragraphs.join("\n\n");
  const title = deriveCapturedNoteTitle(paragraphs);
  const summary = clampText(body.replace(/\s+/g, " ").trim(), 180);

  const note = await prisma.$transaction(async (tx) => {
    const stillExists = await tx.noteCaptureSession.findUnique({ where: { id: session.id } });
    if (!stillExists) return undefined;
    const publicId = await nextPublicId(session.userId, "NOTE", tx);
    const created = await tx.note.create({
      data: {
        userId: session.userId,
        publicId,
        title,
        body,
        summary,
        sourceText: body,
        tags: [],
        embedding: Prisma.JsonNull
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

  return {
    chatId: session.telegramChatId,
    paragraphCount,
    note: note ? { id: note.id, publicId: note.publicId, title: note.title } : undefined
  };
}

async function autoSaveExpiredSessions(bot: Bot): Promise<void> {
  try {
    const results = await finalizeExpiredNoteCaptureSessions();
    for (const result of results) {
      const message = await bot.api.sendMessage(
        result.chatId,
        result.note
          ? `Auto-saved · ${result.paragraphCount} ${result.paragraphCount === 1 ? "paragraph" : "paragraphs"}`
          : "Empty note session closed.",
        {
          reply_markup: {
            keyboard: [[{ text: "☰ Menu" }, { text: "🌐 Dashboard" }]],
            resize_keyboard: true,
            is_persistent: true,
            input_field_placeholder: "Tell Threadwise what you need…"
          }
        }
      );
      const removal = setTimeout(() => {
        void bot.api.deleteMessage(result.chatId, message.message_id).catch(() => undefined);
      }, 3_500);
      removal.unref?.();
    }
  } catch (error) {
    logger.error("Could not auto-save expired note capture sessions.", { error: String(error) });
  }
}

function nextExpiry(): Date {
  return new Date(Date.now() + NOTE_CAPTURE_IDLE_MS);
}

function clampText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(1, maxLength - 1)).join("").trimEnd()}…`;
}
