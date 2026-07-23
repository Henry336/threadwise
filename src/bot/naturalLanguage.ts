import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { classifyMessageDeterministically } from "../ai/deterministic";
import { logger } from "../logger";
import { ensureUser } from "../services/users";
import { createPendingCapture } from "../services/pendingCaptures";
import { createIdea, findIdeaReference, formatIdeaSavedAcknowledgement, scoreIdea } from "../services/ideas";
import { createNote, formatNoteSavedAcknowledgement } from "../services/notes";
import { createScheduledReminder, createTask, formatTaskSavedAcknowledgement } from "../services/tasks";
import { applyPendingItemEdit, cancelPendingItemEdit } from "../services/itemEdits";
import { applyPendingExpenseEdit, createPendingExpenseFromText, formatPendingExpense } from "../services/expenses";
import { consumePendingImageCapture, discardPendingImageCapture, findPendingImageReminder } from "../services/imageOcr";
import { parseDueDate } from "../utils/dates";
import { bold, h, replyHtml } from "../utils/html";
import { isGroupChat, messageTargetsBot, prepareNaturalLanguageText } from "./groupRouting";
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

const AUTO_SAVE_CONFIDENCE = 0.88;

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
          await replyStoredImage(ctx, user.id, editResult.publicId);
          return;
        }
        const card = await buildItemCard(
          user.id,
          editResult.kind,
          editResult.publicId,
          user.settings?.timezone ?? "UTC",
          "✅ Updated",
          false
        );
        appendListOrigin(card.keyboard, user.id, editResult.kind);
        await replyControlCardHtml(ctx, card.text, { reply_markup: card.keyboard });
        return;
      }

      if (await handleNaturalCommand(ctx, ai, text)) {
        return;
      }

      const deterministicClassification = classifyMessageDeterministically(text, user.settings?.timezone ?? "UTC");
      if (!deterministicClassification) {
        const pending = await createPendingCapture(user.id, text, {
          kind: "noise",
          confidence: 0,
          reason: "The message needs an explicit capture choice."
        }, ctx.from?.id);
        logger.info("Natural-language message needs an explicit capture choice.", {
          source: "instant-fallback",
          addressedGroupMessage
        });
        await replyControlCardHtml(ctx, `${bold("Not sure what to do with that.")}\nChoose where it belongs.`, {
          reply_markup: captureConfirmationKeyboard(pending.id)
        });
        return;
      }

      const classification = deterministicClassification;
      logger.info("Classified natural-language message.", {
        source: "deterministic",
        kind: classification.kind,
        confidence: classification.confidence,
        reason: classification.reason
      });

      if (classification.kind === "noise" || classification.confidence < 0.45) {
        const pending = await createPendingCapture(user.id, text, classification, ctx.from?.id);
        await replyControlCardHtml(ctx, `${bold("Not sure what to do with that.")}\nChoose where it belongs.`, {
          reply_markup: captureConfirmationKeyboard(pending.id)
        });
        return;
      }

      if (shouldAutoSave(classification.kind, classification.confidence)) {
        if (classification.kind === "task") {
          const task = await createTask(user.id, text, ai, taskCreationOptionsFromContext(ctx, text));
          await recordGroupTaskCreatedFromContext(ctx, user.id, task);
          await replyQuietAcknowledgementHtml(ctx, formatTaskSavedAcknowledgement(task, user.settings?.timezone));
          return;
        }

        if (classification.kind === "idea") {
          const idea = await createIdea(user.id, text, ai);
          await replyQuietAcknowledgementHtml(ctx, formatIdeaSavedAcknowledgement(idea));
          return;
        }

        if (classification.kind === "note") {
          const note = await createNote(user.id, text, ai);
          await replyQuietAcknowledgementHtml(ctx, formatNoteSavedAcknowledgement(note));
          return;
        }
      }

      const pending = await createPendingCapture(user.id, text, classification, ctx.from?.id);
      const hasReminderTime =
        classification.kind === "task" &&
        Boolean(parseDueDate(classification.dueDateText ?? text, user.settings?.timezone ?? "UTC"));
      const label =
        hasReminderTime
          ? "a scheduled reminder"
          : classification.kind === "task"
            ? "a task"
            : classification.kind === "idea"
              ? "an idea"
              : "a note";

      await replyControlCardHtml(ctx, `${bold("Just checking")}\nThis sounds like ${bold(label)}. ${h("Would you like me to save it?")}`, {
        reply_markup: captureConfirmationKeyboard(pending.id)
      });
    } catch (error) {
      await replyHtml(ctx, h(userFacingError(error, "I couldn't handle that request. Try /help for examples.")));
    }
  });
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

function shouldAutoSave(kind: string, confidence: number): boolean {
  return confidence >= AUTO_SAVE_CONFIDENCE && (kind === "task" || kind === "idea" || kind === "note");
}
