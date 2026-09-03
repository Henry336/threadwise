import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { classifyMessageDeterministically } from "../ai/deterministic";
import { logger } from "../logger";
import { ensureUser } from "../services/users";
import {
  consumePendingCapture,
  createPendingCapture,
  findPendingCaptureReminderReply,
  ignorePendingCapture,
  rememberPendingCaptureReminderPrompt,
} from "../services/pendingCaptures";
import { createIdea, findIdeaReference, formatIdeaSavedAcknowledgement, scoreIdea } from "../services/ideas";
import { createNote, formatNoteSavedAcknowledgement } from "../services/notes";
import { createScheduledReminder, createTask, formatTaskSavedAcknowledgement } from "../services/tasks";
import { applyPendingItemEdit, cancelPendingItemEdit } from "../services/itemEdits";
import { applyPendingExpenseEdit, createPendingExpenseFromText, formatPendingExpense } from "../services/expenses";
import { consumePendingImageCapture, discardPendingImageCapture, findPendingImageReminder } from "../services/imageOcr";
import { parseDueDate } from "../utils/dates";
import { bold, h, replyHtml } from "../utils/html";
import { isGroupChat, messageTargetsBot, prepareNaturalLanguageText } from "./groupRouting";
import { groupWorkspaceForContext } from "../services/groupWorkspaces";
import { captureConfirmationKeyboard, expenseConfirmationKeyboard, ideaBriefKeyboard, regionSettingsKeyboard, reminderSettingsKeyboard } from "./keyboards";
import { PRIVATE_MENU_LABELS } from "./keyboards";
import { showDashboardLink, showMainMenu } from "./menu";
import { handleNaturalCommand } from "./naturalCommands";
import { taskCreationOptionsFromContext } from "./taskMentions";
import { clearMenuInput, pendingMenuInput, type MenuInputAction } from "./menuInputs";
import { buildItemCard } from "./itemCards";
import { replyStoredImage } from "./storedImageReplies";
import { appendListOrigin } from "./navigationState";
import { replyControlCardHtml } from "./controlCards";
import { formatIdeaScore } from "./formatters";
import { formatRegionSettings, formatReminderSettings, updateSetting } from "../services/settings";
import { recordGroupTaskCreatedFromContext } from "../services/groupCollaboration";
import { userFacingError } from "./errorResponses";
import { replyQuietAcknowledgementHtml } from "./quietAcknowledgements";
import {
  applyPendingImageUploadBatchCaption,
  formatImageUploadBatchReview,
  imageUploadBatchKeyboard,
} from "../services/imageUploadBatches";
import { formatCaptureReview, formatReminderTimePrompt, suggestedCaptureKind } from "./captureReview";

export function registerNaturalLanguage(bot: Bot, ai: AiProvider): void {
  bot.on("message:text", async (ctx, next) => {
    const rawText = ctx.message.text;
    if (rawText.startsWith("/")) {
      await next();
      return;
    }

    try {
      const addressedGroupMessage = isGroupChat(ctx) && messageTargetsBot(ctx, rawText);
      const text = prepareNaturalLanguageText(ctx, rawText);
      if (!text) {
        if (addressedGroupMessage) {
          await ctx.reply("I’m here. Tell me what to save, find, change, or remind the group about. For example: remind us to take out the trash every Friday at 7pm.");
        }
        return;
      }

      const user = await ensureUser(ctx);

      if (await handlePendingCaptureReminderReply(ctx, ai, user, text)) return;

      const captionedImageBatch = await applyPendingImageUploadBatchCaption(user.id, text);
      if (captionedImageBatch) {
        const options = {
          parse_mode: "HTML" as const,
          reply_markup: imageUploadBatchKeyboard(captionedImageBatch.token),
        };
        if (captionedImageBatch.reviewMessageId) {
          try {
            await ctx.api.editMessageText(
              captionedImageBatch.chatId,
              captionedImageBatch.reviewMessageId,
              formatImageUploadBatchReview(captionedImageBatch),
              options,
            );
          } catch {
            await replyHtml(ctx, formatImageUploadBatchReview(captionedImageBatch), options);
          }
        } else {
          await replyHtml(ctx, formatImageUploadBatchReview(captionedImageBatch), options);
        }
        return;
      }

      if (!isGroupChat(ctx)) {
        if (text === PRIVATE_MENU_LABELS.menu) {
          await showMainMenu(ctx, user.settings?.timezone ?? "Asia/Singapore", user.id, ctx.from.id);
          return;
        }
        if (text === PRIVATE_MENU_LABELS.dashboard) {
          await showDashboardLink(ctx);
          return;
        }
      }

      if (await handlePendingMenuInput(ctx, ai, user, text)) return;

      const expenseEdit = await applyPendingExpenseEdit(user.id, text, user.settings?.timezone ?? "UTC");
      if (expenseEdit) {
        if (expenseEdit.canceled) {
          await ctx.reply("Expense edit canceled. The preview is still exactly as it was.");
        } else if (expenseEdit.message) {
          await ctx.reply(expenseEdit.message);
        } else {
          await replyControlCardHtml(ctx, formatPendingExpense(expenseEdit.pending, user.settings?.timezone ?? "UTC"), {
            reply_markup: expenseConfirmationKeyboard(expenseEdit.pending.id)
          });
        }
        return;
      }

      const pendingImageReminder = await findPendingImageReminder(user.id);
      if (pendingImageReminder) {
        if (/^(?:cancel|stop|discard)(?:\s+(?:image\s+)?reminder)?$/i.test(text.trim())) {
          await discardPendingImageCapture(user.id, pendingImageReminder.id);
          await ctx.reply("Image reminder canceled. I left it unsaved.");
          return;
        }
        const dueAt = parseDueDate(text, user.settings?.timezone ?? "UTC");
        if (!dueAt || dueAt.getTime() <= Date.now()) {
          await ctx.reply("I still need a future reminder time. Try: tomorrow at 9am, in 2 hours, or next Monday at noon. Send 'cancel image reminder' to stop.");
          return;
        }
        const task = await createScheduledReminder(user.id, pendingImageReminder.extractedText, dueAt, ai);
        await recordGroupTaskCreatedFromContext(ctx, user.id, task);
        await consumePendingImageCapture(user.id, pendingImageReminder.id);
        await replyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, user.settings?.timezone));
        return;
      }

      if (/^(cancel|stop)\s+edit$/i.test(text.trim())) {
        const canceled = await cancelPendingItemEdit(user.id);
        if (canceled) {
          await ctx.reply("Edit canceled. Everything is unchanged.");
          return;
        }
      }

      const editResult = await applyPendingItemEdit(user.id, text);
      if (editResult) {
        if (editResult.kind === "image") {
          await replyStoredImage(ctx, editResult.ownerUserId, editResult.publicId);
          return;
        }
        const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
        const card = await buildItemCard(
          editResult.ownerUserId,
          editResult.kind,
          editResult.publicId,
          user.settings?.timezone ?? "UTC",
          "✅ Updated",
          false,
          1,
          workspace?.id,
        );
        appendListOrigin(card.keyboard, user.id, editResult.kind);
        await replyControlCardHtml(ctx, card.text, { reply_markup: card.keyboard });
        return;
      }

      if (await handleNaturalCommand(ctx, ai, text)) {
        return;
      }

      const deterministicClassification = classifyMessageDeterministically(text, user.settings?.timezone ?? "UTC");
      const classification = deterministicClassification ?? {
        kind: "noise" as const,
        confidence: 0,
        reason: "The message needs an explicit capture choice."
      };
      logger.info("Classified natural-language message.", {
        source: deterministicClassification ? "deterministic" : "instant-fallback",
        kind: classification.kind,
        confidence: classification.confidence,
        reason: classification.reason,
        addressedGroupMessage,
      });

      const pending = await createPendingCapture(user.id, text, classification, ctx.from?.id);
      const suggestedKind = suggestedCaptureKind(classification, text, user.settings?.timezone ?? "UTC");
      await replyControlCardHtml(ctx, formatCaptureReview(text, suggestedKind), {
        reply_markup: captureConfirmationKeyboard(pending.id, suggestedKind)
      });
    } catch (error) {
      await replyHtml(ctx, h(userFacingError(error, "I couldn't handle that request. Try /help for examples.")));
    }
  });
}

async function handlePendingCaptureReminderReply(
  ctx: Context,
  ai: AiProvider,
  user: Awaited<ReturnType<typeof ensureUser>>,
  text: string,
): Promise<boolean> {
  const actorTelegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const replyToMessageId = ctx.message?.reply_to_message?.message_id;
  if (actorTelegramId === undefined || chatId === undefined || replyToMessageId === undefined) return false;

  const pending = await findPendingCaptureReminderReply(
    user.id,
    actorTelegramId,
    chatId,
    replyToMessageId,
  );
  if (!pending) return false;

  if (/^(?:cancel|stop|discard)$/i.test(text.trim())) {
    await ignorePendingCapture(user.id, pending.id, actorTelegramId);
    await replyHtml(ctx, "Canceled. Nothing was saved.");
    return true;
  }

  const timezone = user.settings?.timezone ?? "UTC";
  const dueAt = parseDueDate(text, timezone);
  if (!dueAt || dueAt.getTime() <= Date.now()) {
    const prompt = await ctx.reply(formatReminderTimePrompt(pending.sourceText), {
      parse_mode: "HTML",
      reply_markup: {
        force_reply: true,
        selective: true,
        input_field_placeholder: "Tomorrow at 9am…",
      },
    });
    await rememberPendingCaptureReminderPrompt(user.id, pending.id, actorTelegramId, chatId, prompt.message_id);
    return true;
  }

  const claimed = await consumePendingCapture(user.id, pending.id, actorTelegramId);
  if (!claimed) {
    await replyHtml(ctx, "That capture was already handled or expired. Send it again if needed.");
    return true;
  }
  const task = await createScheduledReminder(user.id, claimed.sourceText, dueAt, ai);
  await recordGroupTaskCreatedFromContext(ctx, user.id, task);
  await replyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, timezone));
  return true;
}

async function handlePendingMenuInput(
  ctx: Context,
  ai: AiProvider,
  user: Awaited<ReturnType<typeof ensureUser>>,
  text: string
): Promise<boolean> {
  const actorId = ctx.from?.id;
  if (actorId === undefined) return false;
  const action = pendingMenuInput(user.id, actorId);
  if (!action) return false;

  if (/^(?:cancel|never mind|nevermind|stop)$/i.test(text.trim())) {
    clearMenuInput(user.id, actorId);
    await replyHtml(ctx, "Canceled. Nothing was changed.");
    return true;
  }

  if (action === "task") {
    const task = await createTask(user.id, text, ai, taskCreationOptionsFromContext(ctx, text));
    await recordGroupTaskCreatedFromContext(ctx, user.id, task);
    clearMenuInput(user.id, actorId);
    await replyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, user.settings?.timezone));
    return true;
  }

  if (action === "reminder") {
    const dueAt = parseDueDate(text, user.settings?.timezone ?? "UTC");
    if (!dueAt || dueAt.getTime() <= Date.now()) {
      await replyHtml(ctx, "I still need a future time. Try: call Mum tomorrow at 9am, submit the form in 2 hours, or review notes Friday at noon.");
      return true;
    }
    const task = await createScheduledReminder(user.id, text, dueAt, ai, taskCreationOptionsFromContext(ctx, text));
    await recordGroupTaskCreatedFromContext(ctx, user.id, task);
    clearMenuInput(user.id, actorId);
    await replyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, user.settings?.timezone));
    return true;
  }

  if (action === "note") {
    const note = await createNote(user.id, text, ai);
    clearMenuInput(user.id, actorId);
    await replyQuietAcknowledgementHtml(ctx, formatNoteSavedAcknowledgement(note));
    return true;
  }

  if (action === "idea") {
    const idea = await createIdea(user.id, text, ai);
    clearMenuInput(user.id, actorId);
    await replyQuietAcknowledgementHtml(ctx, formatIdeaSavedAcknowledgement(idea));
    return true;
  }

  if (action === "idea-brief") {
    const idea = await findIdeaReference(user.id, text);
    const result = await scoreIdea(user.id, idea.publicId, ai);
    clearMenuInput(user.id, actorId);
    await replyControlCardHtml(ctx, formatIdeaScore(result.publicId, result.score), {
      reply_markup: ideaBriefKeyboard(result.publicId)
    });
    return true;
  }

  const settingInputs: Partial<Record<MenuInputAction, { field: string; parent: "reminders" | "region" }>> = {
    "setting-interval": { field: "interval", parent: "reminders" },
    "setting-quiet": { field: "quiet", parent: "reminders" },
    "setting-due-nudge": { field: "due-nudge", parent: "reminders" },
    "setting-max": { field: "max", parent: "reminders" },
    "setting-timezone": { field: "timezone", parent: "region" },
    "setting-currency": { field: "currency", parent: "region" }
  };
  const settingInput = settingInputs[action];
  if (settingInput) {
    const args = settingInput.field === "quiet" ? [settingInput.field, ...text.trim().split(/\s+/)] : [settingInput.field, text];
    const result = await updateSetting(user.id, args);
    clearMenuInput(user.id, actorId);
    const panel = settingInput.parent === "region"
      ? await formatRegionSettings(user.id)
      : await formatReminderSettings(user.id);
    const invalid = /^(?:I don't|Choose|Pick|Send it|Try:)/i.test(result.message);
    await replyControlCardHtml(ctx, invalid ? `${panel}\n\n${bold("Could not apply that")}\n${h(result.message)}` : panel, {
      reply_markup: settingInput.parent === "region" ? regionSettingsKeyboard() : reminderSettingsKeyboard()
    });
    return true;
  }

  if (action === "expense") {
    const pending = await createPendingExpenseFromText(user.id, text, user.settings?.timezone ?? "UTC", {
      sourceType: "manual",
      defaultCurrency: user.settings?.expenseCurrency
    });
    clearMenuInput(user.id, actorId);
    await replyControlCardHtml(ctx, formatPendingExpense(pending, user.settings?.timezone ?? "UTC"), {
      reply_markup: expenseConfirmationKeyboard(pending.id)
    });
    return true;
  }

  const prefix = action === "note-search"
    ? "search notes "
    : action === "idea-search"
      ? "search ideas "
      : action === "image-search"
        ? "search images "
        : "search ";
  clearMenuInput(user.id, actorId);
  return handleNaturalCommand(ctx, ai, `${prefix}${text}`);
}
