import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { classifyMessageDeterministically } from "../ai/deterministic";
import { logger } from "../logger";
import { ensureUser } from "../services/users";
import { createPendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { createNote, formatNoteCreated } from "../services/notes";
import { createTask, formatTaskCreated } from "../services/tasks";
import { applyPendingItemEdit, cancelPendingItemEdit } from "../services/itemEdits";
import { parseDueDate } from "../utils/dates";
import { bold, code, h, italic, replyHtml } from "../utils/html";
import { captureConfirmationKeyboard, itemActionsKeyboard, taskActionsKeyboard } from "./keyboards";
import { handleNaturalCommand } from "./naturalCommands";

const AUTO_SAVE_CONFIDENCE = 0.88;

export function registerNaturalLanguage(bot: Bot, ai: AiProvider): void {
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await next();
      return;
    }

    try {
      const user = await ensureUser(ctx);

      if (/^(cancel|stop)\s+edit$/i.test(text.trim())) {
        const canceled = await cancelPendingItemEdit(user.id);
        if (canceled) {
          await ctx.reply("Edit canceled. Nothing changed.");
          return;
        }
      }

      const editResult = await applyPendingItemEdit(user.id, text);
      if (editResult) {
        await replyHtml(ctx, editResult);
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
        return;
      }

      if (shouldAutoSave(classification.kind, classification.confidence)) {
        if (classification.kind === "task") {
          const task = await createTask(user.id, text, ai);
          await replyHtml(ctx, withAutoSaveNote(formatTaskCreated(task, user.settings?.timezone)), {
            reply_markup: taskActionsKeyboard(task)
          });
          return;
        }

        if (classification.kind === "idea") {
          const idea = await createIdea(user.id, text, ai);
          await replyHtml(ctx, withAutoSaveNote(formatIdeaCreated(idea)), {
            reply_markup: itemActionsKeyboard("idea", idea)
          });
          return;
        }

        if (classification.kind === "note") {
          const note = await createNote(user.id, text, ai);
          await replyHtml(ctx, withAutoSaveNote(formatNoteCreated(note)), {
            reply_markup: itemActionsKeyboard("note", note)
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

function shouldAutoSave(kind: string, confidence: number): boolean {
  return confidence >= AUTO_SAVE_CONFIDENCE && (kind === "task" || kind === "idea" || kind === "note");
}

function withAutoSaveNote(message: string): string {
  return [message, "", `${italic("I saved that automatically because it looked clear.")} ${code("/undo")} ${italic("if I guessed wrong.")}`].join("\n");
}
