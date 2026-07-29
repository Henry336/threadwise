import { InlineKeyboard, type Bot, type Context } from "grammy";
import { VoiceCleanupMode, VoiceTranscriptionStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { logger } from "../logger";
import { ensureUser } from "../services/users";
import {
  findVoiceJobForContext,
  isSupportedVoiceMedia,
  keepVoiceNoteVerbatim,
  markVoiceJobDelivered,
  processRecoverableVoiceTranscriptions,
  processVoiceTranscription,
  queueVoiceTranscription,
  rawTranscriptPage,
  saveVoiceAcknowledgement,
  undoVoiceNote,
  undeliveredVoiceJobs,
  voiceFileSizeError,
  type VoiceMedia
} from "../services/voiceTranscription";

export function registerVoiceCapture(bot: Bot, ai: AiProvider, botToken: string): void {
  bot.on("message:voice", async (ctx) => {
    await queueVoiceFromContext(ctx, ai, botToken, {
      telegramFileId: ctx.message.voice.file_id,
      telegramFileUniqueId: ctx.message.voice.file_unique_id,
      sourceKind: "VOICE",
      durationSeconds: ctx.message.voice.duration,
      mimeType: ctx.message.voice.mime_type,
      fileSize: ctx.message.voice.file_size
    });
  });

  bot.on("message:audio", async (ctx, next) => {
    const user = await ensureUser(ctx);
    if (!user.settings?.voiceAutoTranscribeAudio) {
      await next();
      return;
    }
    await queueVoiceFromContext(ctx, ai, botToken, {
      telegramFileId: ctx.message.audio.file_id,
      telegramFileUniqueId: ctx.message.audio.file_unique_id,
      sourceKind: "AUDIO",
      durationSeconds: ctx.message.audio.duration,
      mimeType: ctx.message.audio.mime_type,
      fileName: ctx.message.audio.file_name,
      fileSize: ctx.message.audio.file_size
    }, user);
  });

  bot.on("message:document", async (ctx, next) => {
    const document = ctx.message.document;
    const media: VoiceMedia = {
      telegramFileId: document.file_id,
      telegramFileUniqueId: document.file_unique_id,
      sourceKind: "AUDIO",
      mimeType: document.mime_type,
      fileName: document.file_name,
      fileSize: document.file_size
    };
    if (!isSupportedVoiceMedia(media)) {
      await next();
      return;
    }
    const user = await ensureUser(ctx);
    if (!user.settings?.voiceAutoTranscribeAudio) {
      await next();
      return;
    }
    await queueVoiceFromContext(ctx, ai, botToken, media, user);
  });

  bot.callbackQuery(/^voice:raw:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const job = await findVoiceJobForContext(ctx.match[1]!, user.id, String(ctx.chat!.id));
    if (!job?.rawTranscript) {
      await ctx.answerCallbackQuery({ text: "That transcript is unavailable.", show_alert: true });
      return;
    }
    const page = rawTranscriptPage(job.rawTranscript, Number(ctx.match[2]) + 1);
    const keyboard = rawTranscriptKeyboard(job.id, page.page, page.totalPages);
    await ctx.answerCallbackQuery({ text: `Raw transcript ${page.page}/${page.totalPages}` });
    await ctx.reply(`Raw transcript (${page.page}/${page.totalPages})\n\n${page.text}`, { reply_markup: keyboard });
  });

  bot.callbackQuery(/^voice:raw-page:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const job = await findVoiceJobForContext(ctx.match[1]!, user.id, String(ctx.chat!.id));
    if (!job?.rawTranscript) {
      await ctx.answerCallbackQuery({ text: "That transcript is unavailable.", show_alert: true });
      return;
    }
    const page = rawTranscriptPage(job.rawTranscript, Number(ctx.match[2]));
    await ctx.answerCallbackQuery({ text: `Page ${page.page}` });
    await ctx.editMessageText(`Raw transcript (${page.page}/${page.totalPages})\n\n${page.text}`, {
      reply_markup: rawTranscriptKeyboard(job.id, page.page, page.totalPages)
    });
  });

  bot.callbackQuery(/^voice:verbatim:([0-9a-f-]+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const note = await keepVoiceNoteVerbatim(ctx.match[1]!, user.id, String(ctx.chat!.id));
    await ctx.answerCallbackQuery({
      text: note ? "Note restored to the exact raw transcript." : "That voice note is unavailable.",
      show_alert: !note
    });
    if (note) await ctx.reply(`Kept verbatim as ${note.publicId}.`);
  });

  bot.callbackQuery(/^voice:undo:([0-9a-f-]+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const undone = await undoVoiceNote(ctx.match[1]!, user.id, String(ctx.chat!.id));
    await ctx.answerCallbackQuery({
      text: undone ? "Voice note removed." : "That voice note was already removed or is unavailable.",
      show_alert: !undone
    });
    if (undone) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      await ctx.reply("Voice note removed. The raw transcript remains in the capture record.");
    }
  });
}

export function startVoiceCaptureRecoveryLoop(bot: Bot, ai: AiProvider, botToken: string): NodeJS.Timeout {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await processRecoverableVoiceTranscriptions(bot.api, botToken, ai);
      await deliverVoiceTranscriptionResults(bot);
    } catch (error) {
      logger.error("Voice capture recovery loop failed.", { error: String(error) });
    } finally {
      busy = false;
    }
  };
  void tick();
  return setInterval(() => void tick(), 5_000);
}

export async function deliverVoiceTranscriptionResults(bot: Bot): Promise<void> {
  const jobs = await undeliveredVoiceJobs();
  for (const job of jobs) {
    try {
      if (job.status === VoiceTranscriptionStatus.FAILED) {
        const sent = await bot.api.sendMessage(
          job.telegramChatId,
          `🎙️ Transcription failed\n\n${job.error ?? "The audio could not be transcribed."}\n\nYou can send the audio again to retry.`
        );
        await markVoiceJobDelivered(job.id, sent.message_id);
        continue;
      }
      if (!job.cleanedNote) continue;
      const cleanupNote = job.cleanupError ? "\n\nCleanup was unsafe or unavailable, so this note was saved verbatim." : "";
      const preview = job.cleanedNote.body.length <= 700
        ? job.cleanedNote.body
        : `${job.cleanedNote.body.slice(0, 697).trimEnd()}…`;
      const sent = await bot.api.sendMessage(
        job.telegramChatId,
        [
          "✅ Voice note saved",
          `Note: ${job.cleanedNote.publicId}`,
          `Model: ${job.transcriptionModel}`,
          `Cleanup: ${job.cleanupMode === VoiceCleanupMode.VERBATIM || job.cleanupError ? "verbatim" : "light"}`,
          "",
          preview + cleanupNote
        ].join("\n"),
        { reply_markup: voiceResultKeyboard(job.id, job.cleanedNote.id) }
      );
      await markVoiceJobDelivered(job.id, sent.message_id);
    } catch (error) {
      logger.warn("Voice capture result delivery failed; it will be retried.", { jobId: job.id, error: String(error) });
    }
  }
}

async function queueVoiceFromContext(
  ctx: Context,
  ai: AiProvider,
  botToken: string,
  media: VoiceMedia,
  existingUser?: Awaited<ReturnType<typeof ensureUser>>
): Promise<void> {
  if (!ctx.from || !ctx.chat || !ctx.message) return;
  if (!isSupportedVoiceMedia(media)) {
    await ctx.reply("I can transcribe FLAC, MP3, MP4/M4A, MPEG/MPGA, OGG, WAV, and WebM audio.");
    return;
  }
  const sizeError = voiceFileSizeError(media.fileSize);
  if (sizeError) {
    await ctx.reply(`${sizeError} Telegram's hosted Bot API can download at most 20 MB.`);
    return;
  }
  const user = existingUser ?? await ensureUser(ctx);
  const settings = user.settings;
  if (!settings) throw new Error("Voice settings are unavailable.");
  const queued = await queueVoiceTranscription({
    ...media,
    userId: user.id,
    requesterTelegramId: String(ctx.from.id),
    telegramChatId: String(ctx.chat.id),
    telegramMessageId: ctx.message.message_id,
    cleanupMode: settings.voiceCleanupMode,
    transcriptionModel: settings.voiceTranscriptionModel,
    languageHint: settings.voiceLanguageHint ?? undefined
  });
  if (!queued.created) return;
  const acknowledgement = await ctx.reply(
    `🎙️ Transcription started\nModel: ${settings.voiceTranscriptionModel}\nCleanup: ${settings.voiceCleanupMode === VoiceCleanupMode.VERBATIM ? "verbatim" : "light"}`
  );
  await saveVoiceAcknowledgement(queued.job.id, acknowledgement.message_id);
  void processVoiceTranscription(queued.job.id, ctx.api, botToken, ai)
    .catch((error) => logger.error("Immediate voice capture processing failed.", { jobId: queued.job.id, error: String(error) }));
}

function voiceResultKeyboard(jobId: string, noteId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Open note", `item:note:open:${noteId}`).text("View raw transcript", `voice:raw:${jobId}:0`).row()
    .text("Undo", `voice:undo:${jobId}`).text("Edit", `item:note:edit:body:${noteId}`).row()
    .text("Keep verbatim", `voice:verbatim:${jobId}`);
}

function rawTranscriptKeyboard(jobId: string, page: number, totalPages: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (page > 1) keyboard.text("‹ Previous", `voice:raw-page:${jobId}:${page - 1}`);
  if (page < totalPages) keyboard.text("Next ›", `voice:raw-page:${jobId}:${page + 1}`);
  return keyboard;
}
