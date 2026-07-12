import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { createNote, formatNoteCreated } from "../services/notes";
import { createScheduledReminder, createTask, formatTaskCreated } from "../services/tasks";
import { createPendingExpenseFromText, formatPendingExpense } from "../services/expenses";
import { createPendingImageCapture, extractTextFromImage, MAX_IMAGE_BYTES, parseImageCaptionIntent } from "../services/imageOcr";
import { ensureUser } from "../services/users";
import { parseDueDate } from "../utils/dates";
import { bold, h, replyHtml } from "../utils/html";
import { isGroupChat, messageTargetsBot, prepareNaturalLanguageText } from "./groupRouting";
import { expenseConfirmationKeyboard, imageTextActionsKeyboard, itemCreatedKeyboard, taskCreatedKeyboard } from "./keyboards";
import { formatOcrLanguages, ocrLanguagesForCaption } from "../utils/ocrLanguages";

export function registerImageMessages(bot: Bot, ai: AiProvider, token: string): void {
  bot.on("message:photo", async (ctx) => handleImageMessage(ctx, ai, token));
  bot.on("message:document", async (ctx, next) => {
    if (!ctx.message.document.mime_type?.startsWith("image/")) {
      await next();
      return;
    }
    await handleImageMessage(ctx, ai, token);
  });
}

async function handleImageMessage(ctx: Context, ai: AiProvider, token: string): Promise<void> {
  const caption = ctx.message?.caption ?? "";
  const addressedGroupImage = isGroupChat(ctx) && messageTargetsBot(ctx, caption);
  const preparedCaption = prepareNaturalLanguageText(ctx, caption) ?? (addressedGroupImage ? "" : undefined);
  if (preparedCaption === undefined) return;

  const target = imageTarget(ctx);
  if (!target) return;
  if (target.fileSize && target.fileSize > MAX_IMAGE_BYTES) {
    await ctx.reply("That image is larger than 10 MB. Send a smaller or compressed copy.");
    return;
  }

  const user = await ensureUser(ctx);
  const ocrLanguages = ocrLanguagesForCaption(preparedCaption, user.settings?.ocrLanguages ?? "eng");
  const progress = await ctx.reply(`Reading the image locally (${formatOcrLanguages(ocrLanguages)})... This can take a little while on the first image.`);
  try {
    const buffer = await downloadTelegramFile(ctx, token, target.fileId);
    const extracted = await extractTextFromImage(buffer, ocrLanguages);
    const intent = parseImageCaptionIntent(preparedCaption);

    if (intent === "expense") {
      const pendingExpense = await createPendingExpenseFromText(user.id, extracted.text, user.settings?.timezone ?? "UTC", {
        sourceType: "receipt",
        receiptFileUniqueId: target.uniqueId,
        ocrConfidence: extracted.confidence,
        defaultCurrency: user.settings?.expenseCurrency
      });
      await replyHtml(ctx, formatPendingExpense(pendingExpense, user.settings?.timezone ?? "UTC"), {
        reply_markup: expenseConfirmationKeyboard(pendingExpense.id)
      });
      return;
    }

    if (intent === "note") {
      const note = await createNote(user.id, extracted.text, ai);
      await replyHtml(ctx, formatNoteCreated(note), { reply_markup: itemCreatedKeyboard("note", note) });
      return;
    }

    if (intent === "task") {
      const task = await createTask(user.id, extracted.text, ai);
      await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
      return;
    }

    if (intent === "reminder") {
      const scheduledAt = parseDueDate(preparedCaption, user.settings?.timezone ?? "UTC");
      if (scheduledAt && scheduledAt.getTime() > Date.now()) {
        const task = await createScheduledReminder(user.id, extracted.text, scheduledAt, ai);
        await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
        return;
      }
    }

    const pending = await createPendingImageCapture({
      userId: user.id,
      extractedText: extracted.text,
      caption: preparedCaption,
      telegramFileId: target.fileId,
      telegramUniqueId: target.uniqueId,
      confidence: extracted.confidence,
      awaitingAction: intent === "reminder" ? "reminder-time" : undefined
    });

    if (intent === "reminder") {
      await ctx.reply("I extracted the text. When should I remind you? Try: tomorrow at 9am, in 2 hours, or next Monday at noon.");
      return;
    }

    await replyHtml(ctx, formatImagePreview(extracted.text, extracted.confidence), {
      reply_markup: imageTextActionsKeyboard(pending.id)
    });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't read that image. Try a clearer photo or screenshot.");
  } finally {
    try {
      await ctx.api.deleteMessage(ctx.chat?.id ?? 0, progress.message_id);
    } catch {
      // The progress message is harmless if Telegram does not allow deleting it.
    }
  }
}

function imageTarget(ctx: Context): { fileId: string; uniqueId?: string; fileSize?: number } | undefined {
  const photo = ctx.message?.photo?.at(-1);
  if (photo) return { fileId: photo.file_id, uniqueId: photo.file_unique_id, fileSize: photo.file_size };
  const document = ctx.message?.document;
  if (document?.mime_type?.startsWith("image/")) {
    return { fileId: document.file_id, uniqueId: document.file_unique_id, fileSize: document.file_size };
  }
  return undefined;
}

async function downloadTelegramFile(ctx: Context, token: string, fileId: string): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram did not provide an image download path.");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Telegram image download failed: ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_IMAGE_BYTES) throw new Error("That image is larger than 10 MB.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("That image is larger than 10 MB.");
  return buffer;
}

function formatImagePreview(text: string, confidence: number): string {
  const preview = text.length > 1400 ? `${text.slice(0, 1397)}…` : text;
  return [
    bold("Text extracted locally"),
    `OCR confidence: ${Math.round(confidence)}%`,
    "Nothing is saved yet. Choose what to do with it.",
    "",
    h(preview)
  ].join("\n");
}
