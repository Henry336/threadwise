import { InlineKeyboard, type Bot, type Context } from "grammy";
import {
  appendNoteCaptureParagraph,
  cancelNoteCaptureSession,
  finalizeNoteCaptureSession,
  noteCaptureSessionForTelegramUser,
  rememberNoteCaptureStatusMessage,
  startNoteCaptureSession
} from "../services/noteCaptureSessions";
import { ensureUser } from "../services/users";
import { bold, h, replyHtml } from "../utils/html";
import { isGroupChat } from "./groupRouting";
import {
  NOTE_SESSION_LABELS,
  privateMenuKeyboard
} from "./keyboards";
import { replyQuietAcknowledgementHtml } from "./quietAcknowledgements";

export function registerNoteSessions(bot: Bot): void {
  bot.callbackQuery("note-session:save", async (ctx) => {
    if (!ctx.from || isGroupChat(ctx)) return ctx.answerCallbackQuery({ text: "Note sessions are private.", show_alert: true });
    const session = await noteCaptureSessionForTelegramUser(String(ctx.from.id));
    await ctx.answerCallbackQuery().catch(() => undefined);
    if (!session) return replyQuietAcknowledgementHtml(ctx, "No note session is active.", 2_500);
    await saveNoteSession(ctx, session.userId);
  });
  bot.callbackQuery("note-session:cancel", async (ctx) => {
    if (!ctx.from || isGroupChat(ctx)) return ctx.answerCallbackQuery({ text: "Note sessions are private.", show_alert: true });
    const session = await noteCaptureSessionForTelegramUser(String(ctx.from.id));
    await ctx.answerCallbackQuery().catch(() => undefined);
    if (!session) return replyQuietAcknowledgementHtml(ctx, "No note session is active.", 2_500);
    await cancelNoteSession(ctx, session.userId);
  });

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
      if (result) await finishNoteSessionStatus(ctx, result, true);
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
    if (result === "saved" || result === "duplicate") {
      await refreshNoteSessionStatus(ctx, session.userId);
    }
    if (result === "expired") {
      const saved = await finalizeNoteCaptureSession(session.userId);
      if (saved) await finishNoteSessionStatus(ctx, saved, true);
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
  const content = noteSessionStatusText(result.session._count.segments, result.resumed);
  if (result.session.telegramStatusMessageId) {
    try {
      await ctx.api.editMessageText(String(ctx.chat!.id), result.session.telegramStatusMessageId, content, {
        parse_mode: "HTML",
        reply_markup: noteSessionControls(),
      });
      return;
    } catch { /* The previous status card may no longer be editable. */ }
  }
  const message = await replyHtml(ctx, content, { reply_markup: noteSessionControls() }) as { message_id?: number };
  if (typeof message?.message_id === "number") await rememberNoteCaptureStatusMessage(userId, message.message_id);
}

async function saveNoteSession(ctx: Context, userId: string): Promise<void> {
  const result = await finalizeNoteCaptureSession(userId);
  if (!result?.note) {
    if (result) await finishNoteSessionStatus(ctx, result, false);
  } else {
    await finishNoteSessionStatus(ctx, result, false);
  }
}

async function cancelNoteSession(ctx: Context, userId: string): Promise<void> {
  const result = await cancelNoteCaptureSession(userId);
  const text = result.paragraphCount > 0
    ? `Canceled · ${result.paragraphCount} unsaved ${result.paragraphCount === 1 ? "paragraph" : "paragraphs"} removed.`
    : "Empty note session closed.";
  await replaceOrReplyStatus(ctx, result.chatId, result.statusMessageId, text);
}

async function refreshNoteSessionStatus(ctx: Context, userId: string): Promise<void> {
  const session = await noteCaptureSessionForTelegramUser(String(ctx.from!.id));
  if (!session || session.userId !== userId || !session.telegramStatusMessageId) return;
  await ctx.api.editMessageText(session.telegramChatId, session.telegramStatusMessageId, noteSessionStatusText(session._count.segments), {
    parse_mode: "HTML",
    reply_markup: noteSessionControls(),
  }).catch(() => undefined);
}

async function finishNoteSessionStatus(
  ctx: Context,
  result: NonNullable<Awaited<ReturnType<typeof finalizeNoteCaptureSession>>>,
  automatic: boolean,
): Promise<void> {
  const text = result.note
    ? `${bold(automatic ? "Note auto-saved" : "Note saved")} · ${result.paragraphCount} ${result.paragraphCount === 1 ? "paragraph" : "paragraphs"}\n\n${h(result.note.title)}\nStored exactly as written.`
    : "Empty note session closed.";
  const keyboard = result.note ? new InlineKeyboard().text("Open note", `item:note:open:${result.note.id}:1`) : undefined;
  await replaceOrReplyStatus(ctx, result.chatId, result.statusMessageId, text, keyboard);
}

async function replaceOrReplyStatus(
  ctx: Context,
  chatId: string | undefined,
  messageId: number | undefined,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  if (chatId && messageId) {
    try {
      await ctx.api.editMessageText(chatId, messageId, text, { parse_mode: "HTML", ...(keyboard ? { reply_markup: keyboard } : {}) });
      return;
    } catch { /* Fall back to a new message. */ }
  }
  await replyHtml(ctx, text, { ...(keyboard ? { reply_markup: keyboard } : { reply_markup: privateMenuKeyboard() }) });
}

function noteSessionStatusText(paragraphs: number, resumed = false): string {
  return [
    bold(resumed ? "Note session resumed" : "Note session active"),
    `${paragraphs} ${paragraphs === 1 ? "paragraph" : "paragraphs"} captured`,
    "",
    "Keep sending text. Each message stays one exact paragraph.",
    "Auto-saves after 1 hour of inactivity.",
  ].join("\n");
}

function noteSessionControls(): InlineKeyboard {
  return new InlineKeyboard().text("Save & finish", "note-session:save").text("Cancel session", "note-session:cancel");
}

function isSaveCommand(text: string): boolean {
  return text === NOTE_SESSION_LABELS.save || /^\/save_note(?:@\w+)?$/i.test(text);
}

function isCancelCommand(text: string): boolean {
  return text === NOTE_SESSION_LABELS.cancel || /^\/cancel_note(?:@\w+)?$/i.test(text);
}
