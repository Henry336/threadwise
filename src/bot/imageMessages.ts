import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { createNote, formatNoteSavedAcknowledgement } from "../services/notes";
import { createScheduledReminder, createTask, formatTaskSavedAcknowledgement } from "../services/tasks";
import { createPendingExpenseFromText, formatPendingExpense } from "../services/expenses";
import { captionForStoredImage, createPendingImageCapture, extractTextFromImage, MAX_IMAGE_BYTES, parseImageCaptionIntent, type ImageIntent } from "../services/imageOcr";
import { consumePendingImageUpload, createPendingImageUpload, discardPendingImageUpload, formatStoredImageSaved, savePendingImageUpload, updateStoredImageOcr } from "../services/storedImages";
import { beginPendingItemEdit, formatEditStarted } from "../services/itemEdits";
import { ensureUser } from "../services/users";
import { parseDueDate } from "../utils/dates";
import { bold, editOrReplyHtml, editOrReplyText, h, replyHtml } from "../utils/html";
import { isGroupChat, messageTargetsBot, prepareNaturalLanguageText } from "./groupRouting";
import { editCancelKeyboard, expenseConfirmationKeyboard, imageReminderTimeKeyboard, imageTextActionsKeyboard, incomingImageKeyboard, menuBackKeyboard } from "./keyboards";
import { formatOcrLanguages, ocrLanguagesForCaption } from "../utils/ocrLanguages";
import { recordGroupTaskCreatedFromContext } from "../services/groupCollaboration";
import { userFacingError } from "./errorResponses";
import { editOrReplyQuietAcknowledgementHtml } from "./quietAcknowledgements";

export function registerImageMessages(bot: Bot, ai: AiProvider, token: string): void {
  bot.on("message:photo", async (ctx) => handleImageMessage(ctx, ai, token));
  bot.on("message:document", async (ctx, next) => {
    if (!ctx.message.document.mime_type?.startsWith("image/")) {
      await next();
      return;
    }
    await handleImageMessage(ctx, ai, token);
  });
  bot.callbackQuery(/^image-upload:(save|caption|save-extract|extract|expense|discard):(.+)$/, async (ctx) => {
    try {
      await handleIncomingImageAction(ctx, ai, token, ctx.match[1], ctx.match[2]);
    } catch (error) {
      await ctx.answerCallbackQuery({ text: "This image choice expired or is no longer available.", show_alert: true });
    }
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
  const intent = parseImageCaptionIntent(preparedCaption);
  if (intent === "choose" || intent === "store" || intent === "store-extract") {
    const storedCaption = captionForStoredImage(preparedCaption) ?? (intent === "choose" && preparedCaption ? preparedCaption : undefined);
    const pending = await createPendingImageUpload({ userId: user.id, ...target, caption: storedCaption });
    if (intent === "store") {
      const saved = await savePendingImageUpload(user.id, pending.id);
      await replyHtml(ctx, formatStoredImageSaved(saved.image, saved.duplicate));
      return;
    }
    if (intent === "store-extract") {
      const saved = await savePendingImageUpload(user.id, pending.id);
      await replyHtml(ctx, formatStoredImageSaved(saved.image, saved.duplicate));
      await processImageOcr(ctx, ai, token, target, preparedCaption, "extract", user, saved.image.id);
      return;
    }
    await replyHtml(ctx, [
      bold("🖼️ Image received"),
      "Keep the original, add a caption, or extract searchable text.",
      "Nothing is saved until you choose."
    ].join("\n"), { reply_markup: incomingImageKeyboard(pending.id) });
    return;
  }

  await processImageOcr(ctx, ai, token, target, preparedCaption, intent, user);
}

async function handleIncomingImageAction(
  ctx: Context,
  ai: AiProvider,
  token: string,
  action: string | undefined,
  pendingId: string | undefined
): Promise<void> {
  if (!action || !pendingId) return;
  const user = await ensureUser(ctx);
  if (action === "discard") {
    await discardPendingImageUpload(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: "Discarded" });
    await editOrReplyText(ctx, "Got it—I left the image unsaved and did not extract anything.", { reply_markup: menuBackKeyboard() });
    return;
  }
  if (action === "save") {
    const saved = await savePendingImageUpload(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: saved.duplicate ? "Already saved" : "Image saved" });
    await editOrReplyHtml(ctx, formatStoredImageSaved(saved.image, saved.duplicate), { reply_markup: menuBackKeyboard() });
    return;
  }
  if (action === "caption") {
    const saved = await savePendingImageUpload(user.id, pendingId);
    const edit = await beginPendingItemEdit(user.id, "image", saved.image.id, "caption");
    await ctx.answerCallbackQuery({ text: saved.duplicate ? "Update its caption" : "Add a caption" });
    await editOrReplyHtml(ctx, `${formatStoredImageSaved(saved.image, saved.duplicate)}\n\n${formatEditStarted(edit)}`, { reply_markup: editCancelKeyboard() });
    return;
  }
  if (action === "save-extract") {
    const pending = await consumePendingImageUpload(user.id, pendingId);
    const savedPending = await createPendingImageUpload({
      userId: user.id,
      telegramFileId: pending.telegramFileId,
      telegramUniqueId: pending.telegramUniqueId ?? undefined,
      mediaKind: pending.mediaKind as "photo" | "document",
      mimeType: pending.mimeType ?? undefined,
      fileName: pending.fileName ?? undefined,
      caption: pending.caption ?? undefined,
      fileSize: pending.fileSize ?? undefined
    });
    const saved = await savePendingImageUpload(user.id, savedPending.id);
    await ctx.answerCallbackQuery({ text: "Saved — now extracting" });
    await editOrReplyHtml(ctx, formatStoredImageSaved(saved.image, saved.duplicate));
    await processImageOcr(ctx, ai, token, {
      telegramFileId: pending.telegramFileId,
      telegramUniqueId: pending.telegramUniqueId ?? undefined,
      mediaKind: pending.mediaKind as "photo" | "document",
      mimeType: pending.mimeType ?? undefined,
      fileName: pending.fileName ?? undefined,
      fileSize: pending.fileSize ?? undefined
    }, pending.caption ?? "", "extract", user, saved.image.id);
    return;
  }
  const pending = await consumePendingImageUpload(user.id, pendingId);
  await ctx.answerCallbackQuery({ text: action === "expense" ? "Reading receipt" : "Extracting text" });
  await processImageOcr(ctx, ai, token, {
    telegramFileId: pending.telegramFileId,
    telegramUniqueId: pending.telegramUniqueId ?? undefined,
    mediaKind: pending.mediaKind as "photo" | "document",
    mimeType: pending.mimeType ?? undefined,
    fileName: pending.fileName ?? undefined,
    fileSize: pending.fileSize ?? undefined
  }, pending.caption ?? "", action === "expense" ? "expense" : "extract", user);
}

async function processImageOcr(
  ctx: Context,
  ai: AiProvider,
  token: string,
  target: ImageTarget,
  preparedCaption: string,
  intent: Exclude<ImageIntent, "choose" | "store" | "store-extract">,
  user: Awaited<ReturnType<typeof ensureUser>>,
  storedImageId?: string
): Promise<void> {
  const ocrLanguages = ocrLanguagesForCaption(preparedCaption, user.settings?.ocrLanguages ?? "eng");
  const progressText = `Reading the image locally in ${formatOcrLanguages(ocrLanguages)}. The first scan can take a little longer.`;
  const progress = ctx.callbackQuery?.message
    ? undefined
    : await ctx.reply(progressText);
  if (ctx.callbackQuery?.message) await editOrReplyText(ctx, progressText);
  try {
    const buffer = await downloadTelegramFile(ctx, token, target.telegramFileId);
    const extracted = await extractTextFromImage(buffer, ocrLanguages);
    if (storedImageId) await updateStoredImageOcr(user.id, storedImageId, extracted.text, extracted.confidence);

    if (intent === "expense") {
      const pendingExpense = await createPendingExpenseFromText(user.id, extracted.text, user.settings?.timezone ?? "UTC", {
        sourceType: "receipt",
        receiptFileUniqueId: target.telegramUniqueId,
        ocrConfidence: extracted.confidence,
        defaultCurrency: user.settings?.expenseCurrency
      });
      await editOrReplyHtml(ctx, formatPendingExpense(pendingExpense, user.settings?.timezone ?? "UTC"), {
        reply_markup: expenseConfirmationKeyboard(pendingExpense.id)
      });
      return;
    }

    if (intent === "note") {
      const note = await createNote(user.id, extracted.text, ai);
      await editOrReplyQuietAcknowledgementHtml(ctx, formatNoteSavedAcknowledgement(note));
      return;
    }

    if (intent === "task") {
      const task = await createTask(user.id, extracted.text, ai);
      await recordGroupTaskCreatedFromContext(ctx, user.id, task);
      await editOrReplyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, user.settings?.timezone));
      return;
    }

    if (intent === "reminder") {
      const scheduledAt = parseDueDate(preparedCaption, user.settings?.timezone ?? "UTC");
      if (scheduledAt && scheduledAt.getTime() > Date.now()) {
        const task = await createScheduledReminder(user.id, extracted.text, scheduledAt, ai);
        await recordGroupTaskCreatedFromContext(ctx, user.id, task);
        await editOrReplyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, user.settings?.timezone));
        return;
      }
    }

    const pending = await createPendingImageCapture({
      userId: user.id,
      extractedText: extracted.text,
      caption: preparedCaption,
      telegramFileId: target.telegramFileId,
      telegramUniqueId: target.telegramUniqueId,
      confidence: extracted.confidence,
      awaitingAction: intent === "reminder" ? "reminder-time" : storedImageId ? "stored-image-saved" : undefined
    });

    if (intent === "reminder") {
      await editOrReplyText(ctx, "The text is ready. When should I bring it back? Try: tomorrow at 9am, in 2 hours, or next Monday at noon.", {
        reply_markup: imageReminderTimeKeyboard(pending.id)
      });
      return;
    }

    await editOrReplyHtml(ctx, formatImagePreview(extracted.text, extracted.confidence, Boolean(storedImageId)), {
      reply_markup: imageTextActionsKeyboard(pending.id)
    });
  } catch (error) {
    const detail = userFacingError(error, "I couldn't read that image. Try a clearer photo or screenshot.");
    await editOrReplyText(ctx, storedImageId ? `The original image is safely saved, but I couldn't extract its text. ${detail}` : detail, {
      reply_markup: menuBackKeyboard()
    });
  } finally {
    try {
      if (progress) await ctx.api.deleteMessage(ctx.chat?.id ?? 0, progress.message_id);
    } catch {
      // The progress message is harmless if Telegram does not allow deleting it.
    }
  }
}

type ImageTarget = {
  telegramFileId: string;
  telegramUniqueId?: string;
  mediaKind: "photo" | "document";
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
};

function imageTarget(ctx: Context): ImageTarget | undefined {
  const photo = ctx.message?.photo?.at(-1);
  if (photo) return { telegramFileId: photo.file_id, telegramUniqueId: photo.file_unique_id, mediaKind: "photo", mimeType: "image/jpeg", fileSize: photo.file_size };
  const document = ctx.message?.document;
  if (document?.mime_type?.startsWith("image/")) {
    return { telegramFileId: document.file_id, telegramUniqueId: document.file_unique_id, mediaKind: "document", mimeType: document.mime_type, fileName: document.file_name, fileSize: document.file_size };
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

function formatImagePreview(text: string, confidence: number, saved = false): string {
  const preview = text.length > 1400 ? `${text.slice(0, 1397)}…` : text;
  return [
    bold("🔎 Text extracted locally"),
    `OCR confidence: ${Math.round(confidence)}%`,
    saved ? "The original image and searchable OCR text are saved. You can also turn the text into another item." : "Nothing is saved yet. Choose what to do with it.",
    "",
    h(preview)
  ].join("\n");
}
