import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { classifyMessageDeterministically } from "../ai/deterministic";
import { logger } from "../logger";
import { ensureUser } from "../services/users";
import { createPendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { createNote, formatNoteCreated } from "../services/notes";
import { createScheduledReminder, createTask, formatTaskCreated } from "../services/tasks";
import { applyPendingItemEdit, cancelPendingItemEdit } from "../services/itemEdits";
import { applyPendingExpenseEdit, formatPendingExpense } from "../services/expenses";
import { consumePendingImageCapture, discardPendingImageCapture, findPendingImageReminder } from "../services/imageOcr";
import { parseDueDate } from "../utils/dates";
import { bold, code, h, italic, replyHtml } from "../utils/html";
import { isGroupChat, messageTargetsBot, prepareNaturalLanguageText } from "./groupRouting";
import { captureConfirmationKeyboard, expenseConfirmationKeyboard, itemCreatedKeyboard, taskCreatedKeyboard, undoKeyboard } from "./keyboards";
import { PRIVATE_MENU_LABELS } from "./keyboards";
import { hidePrivateMenu } from "./menu";
import { handleNaturalCommand } from "./naturalCommands";
import { taskCreationOptionsFromContext } from "./taskMentions";

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
          await ctx.reply("I'm here. Tell me what to save, find, change, or remind the group about. Try: remind us to take out the trash every Friday at 7pm.");
        }
        return;
      }

      const user = await ensureUser(ctx);

      if (!isGroupChat(ctx)) {
        if (text === PRIVATE_MENU_LABELS.hide) {
          await hidePrivateMenu(ctx);
          return;
        }
        const menuAction = privateMenuAction(text);
        if (menuAction) {
          await handleNaturalCommand(ctx, ai, menuAction);
          return;
        }
      }

      const expenseEdit = await applyPendingExpenseEdit(user.id, text, user.settings?.timezone ?? "UTC");
      if (expenseEdit) {
        if (expenseEdit.canceled) {
          await ctx.reply("Expense edit canceled. The preview is unchanged.");
        } else if (expenseEdit.message) {
          await ctx.reply(expenseEdit.message);
        } else {
          await replyHtml(ctx, formatPendingExpense(expenseEdit.pending, user.settings?.timezone ?? "UTC"), {
            reply_markup: expenseConfirmationKeyboard(expenseEdit.pending.id)
          });
        }
        return;
      }

      const pendingImageReminder = await findPendingImageReminder(user.id);
      if (pendingImageReminder) {
        if (/^(?:cancel|stop|discard)(?:\s+(?:image\s+)?reminder)?$/i.test(text.trim())) {
          await discardPendingImageCapture(user.id, pendingImageReminder.id);
          await ctx.reply("Image reminder canceled. Nothing was saved.");
          return;
        }
        const dueAt = parseDueDate(text, user.settings?.timezone ?? "UTC");
        if (!dueAt || dueAt.getTime() <= Date.now()) {
          await ctx.reply("I still need a future reminder time. Try: tomorrow at 9am, in 2 hours, or next Monday at noon. Send 'cancel image reminder' to stop.");
          return;
        }
        const task = await createScheduledReminder(user.id, pendingImageReminder.extractedText, dueAt, ai);
        await consumePendingImageCapture(user.id, pendingImageReminder.id);
        await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
        return;
      }

      if (/^(cancel|stop)\s+edit$/i.test(text.trim())) {
        const canceled = await cancelPendingItemEdit(user.id);
        if (canceled) {
          await ctx.reply("Edit canceled. Nothing changed.");
          return;
        }
      }

      const editResult = await applyPendingItemEdit(user.id, text);
      if (editResult) {
        await replyHtml(ctx, editResult, { reply_markup: undoKeyboard("Undo edit") });
        return;
      }

      if (await handleNaturalCommand(ctx, ai, text)) {
        return;
      }

      const deterministicClassification = classifyMessageDeterministically(text, user.settings?.timezone ?? "UTC");
      const classification = deterministicClassification ?? await ai.classifyMessage(text);
      logger.info("Classified natural-language message.", {
        source: deterministicClassification ? "deterministic" : "ai",
        kind: classification.kind,
        confidence: classification.confidence,
        reason: classification.reason
      });

      if (classification.kind === "noise" || classification.confidence < 0.45) {
        if (addressedGroupMessage) {
          await ctx.reply("I saw your mention, but I'm not sure what you want me to do. Try a full request, or send /help for examples.");
        }
        return;
      }

      if (shouldAutoSave(classification.kind, classification.confidence)) {
        if (classification.kind === "task") {
          const task = await createTask(user.id, text, ai, taskCreationOptionsFromContext(ctx, text));
          await replyHtml(ctx, withAutoSaveNote(formatTaskCreated(task, user.settings?.timezone)), {
            reply_markup: taskCreatedKeyboard(task)
          });
          return;
        }

        if (classification.kind === "idea") {
          const idea = await createIdea(user.id, text, ai);
          await replyHtml(ctx, withAutoSaveNote(formatIdeaCreated(idea)), {
            reply_markup: itemCreatedKeyboard("idea", idea)
          });
          return;
        }

        if (classification.kind === "note") {
          const note = await createNote(user.id, text, ai);
          await replyHtml(ctx, withAutoSaveNote(formatNoteCreated(note)), {
            reply_markup: itemCreatedKeyboard("note", note)
          });
          return;
        }
      }

      const pending = await createPendingCapture(user.id, text, classification);
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

      await replyHtml(ctx, `This sounds like ${bold(label)}.\n${h("Save it?")}`, {
        reply_markup: captureConfirmationKeyboard(pending.id)
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't handle that request. Try /help for examples.");
    }
  });
}

function privateMenuAction(text: string): string | undefined {
  const actions: Record<string, string> = {
    [PRIVATE_MENU_LABELS.tasks]: "show my tasks",
    [PRIVATE_MENU_LABELS.reminders]: "help reminders",
    [PRIVATE_MENU_LABELS.notes]: "show my notes",
    [PRIVATE_MENU_LABELS.ideas]: "show my ideas",
    [PRIVATE_MENU_LABELS.images]: "show my images",
    [PRIVATE_MENU_LABELS.expenses]: "show my expenses",
    [PRIVATE_MENU_LABELS.search]: "help search",
    [PRIVATE_MENU_LABELS.settings]: "settings",
    [PRIVATE_MENU_LABELS.help]: "help"
  };
  return actions[text];
}

function shouldAutoSave(kind: string, confidence: number): boolean {
  return confidence >= AUTO_SAVE_CONFIDENCE && (kind === "task" || kind === "idea" || kind === "note");
}

function withAutoSaveNote(message: string): string {
  return [message, "", `${italic("I saved that automatically because it looked clear.")} ${code("/undo")} ${italic("if I guessed wrong.")}`].join("\n");
}
