import type { Bot, Context } from "grammy";
import {
  appendNoteCaptureParagraph,
  cancelNoteCaptureSession,
  finalizeNoteCaptureSession,
  noteCaptureSessionForTelegramUser,
  startNoteCaptureSession
} from "../services/noteCaptureSessions";
import { ensureUser } from "../services/users";
import { bold, h } from "../utils/html";
import { isGroupChat } from "./groupRouting";
import {
  NOTE_SESSION_LABELS,
  noteSessionKeyboard,
  privateMenuKeyboard
} from "./keyboards";
import { replyQuietAcknowledgementHtml } from "./quietAcknowledgements";

export function registerNoteSessions(bot: Bot): void {
  bot.on("message:text", async (ctx, next) => {
    if (isGroupChat(ctx) || !ctx.from) {
      await next();
      return;
    }

    const text = ctx.message.text;
    const startRequested = /^\/note_session(?:@\w+)?$/i.test(text);
    const session = await noteCaptureSessionForTelegramUser(String(ctx.from.id));

    if (!session) {
      if (startRequested) {
        const user = await ensureUser(ctx);
        await beginNoteSession(ctx, user.id);
        return;
      }
      if (isSaveCommand(text) || isCancelCommand(text)) {
        await replyQuietAcknowledgementHtml(ctx, "No note session is active.", 2_500);
        return;
      }
      await next();
      return;
    }

    if (session.expiresAt <= new Date()) {
      const result = await finalizeNoteCaptureSession(session.userId);
      await replyQuietAcknowledgementHtml(
        ctx,
        result?.note
          ? `Auto-saved · ${result.paragraphCount} ${result.paragraphCount === 1 ? "paragraph" : "paragraphs"}`
          : "Empty note session closed.",
        3_500,
        { reply_markup: privateMenuKeyboard() }
      );
      if (!startRequested && !isSaveCommand(text) && !isCancelCommand(text)) {
        await next();
      }
      return;
    }

    if (startRequested) {
      await replyQuietAcknowledgementHtml(
        ctx,
        `${bold("Note session already active")} · ${session._count.segments} ${session._count.segments === 1 ? "paragraph" : "paragraphs"}`,
        3_500
      );
      return;
    }

    if (isSaveCommand(text)) {
      await saveNoteSession(ctx, session.userId);
      return;
    }

    if (isCancelCommand(text)) {
      await cancelNoteSession(ctx, session.userId);
      return;
    }

    if (text.startsWith("/")) {
      await replyQuietAcknowledgementHtml(
        ctx,
        "Finish this note first with Save note or Cancel.",
        3_500
      );
      return;
    }

    const result = await appendNoteCaptureParagraph(
      session.userId,
      ctx.message.message_id,
      text
    );
    if (result === "expired") {
      const saved = await finalizeNoteCaptureSession(session.userId);
      await replyQuietAcknowledgementHtml(
        ctx,
        saved?.note ? "The previous note was auto-saved." : "The empty note session was closed.",
        3_500,
        { reply_markup: privateMenuKeyboard() }
      );
      await next();
    }
    // "saved" and "duplicate" deliberately produce no response.
  });
}

export async function beginNoteSession(ctx: Context, userId: string): Promise<void> {
  if (isGroupChat(ctx)) {
    await ctx.reply("Note sessions are private. Open Threadwise directly to start one.");
    return;
  }

  const result = await startNoteCaptureSession(userId, String(ctx.chat!.id));
  await replyQuietAcknowledgementHtml(
    ctx,
    result.resumed
      ? `${bold("Note session resumed")}\nKeep sending paragraphs, then tap Save note.`
      : `${bold("Note session started")}\nEach message becomes one paragraph.`,
    3_500,
    { reply_markup: noteSessionKeyboard() }
  );
}

async function saveNoteSession(ctx: Context, userId: string): Promise<void> {
  const result = await finalizeNoteCaptureSession(userId);
  if (!result?.note) {
    await replyQuietAcknowledgementHtml(
      ctx,
      "Empty note session closed.",
      3_500,
      { reply_markup: privateMenuKeyboard() }
    );
  } else {
    await replyQuietAcknowledgementHtml(
      ctx,
      `${bold("Saved")} · ${result.paragraphCount} ${result.paragraphCount === 1 ? "paragraph" : "paragraphs"}\n${h(result.note.title)}`,
      3_500,
      { reply_markup: privateMenuKeyboard() }
    );
  }
}

async function cancelNoteSession(ctx: Context, userId: string): Promise<void> {
  const paragraphs = await cancelNoteCaptureSession(userId);
  await replyQuietAcknowledgementHtml(
    ctx,
    paragraphs > 0 ? `Canceled · ${paragraphs} unsaved ${paragraphs === 1 ? "paragraph" : "paragraphs"} removed.` : "Empty note session closed.",
    3_500,
    { reply_markup: privateMenuKeyboard() }
  );
}

function isSaveCommand(text: string): boolean {
  return text === NOTE_SESSION_LABELS.save || /^\/save_note(?:@\w+)?$/i.test(text);
}

function isCancelCommand(text: string): boolean {
  return text === NOTE_SESSION_LABELS.cancel || /^\/cancel_note(?:@\w+)?$/i.test(text);
}
