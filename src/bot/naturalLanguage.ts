import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { createPendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { createNote, formatNoteCreated } from "../services/notes";
import { createTask, formatTaskCreated } from "../services/tasks";
import { parseDueDate } from "../utils/dates";
import { bold, code, h, italic, replyHtml } from "../utils/html";
import { captureConfirmationKeyboard, taskActionsKeyboard } from "./keyboards";

const AUTO_SAVE_CONFIDENCE = 0.88;

export function registerNaturalLanguage(bot: Bot, ai: AiProvider): void {
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await next();
      return;
    }

    const user = await ensureUser(ctx);
    const classification = await ai.classifyMessage(text);

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
        await replyHtml(ctx, withAutoSaveNote(formatIdeaCreated(idea)));
        return;
      }

      if (classification.kind === "note") {
        const note = await createNote(user.id, text, ai);
        await replyHtml(ctx, withAutoSaveNote(formatNoteCreated(note)));
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
            : classification.kind === "note"
              ? "a note"
              : "a relationship reflection";

    await replyHtml(ctx, `This sounds like ${bold(label)}.\n${h("Save it?")}`, {
      reply_markup: captureConfirmationKeyboard(pending.id)
    });
  });
}

function shouldAutoSave(kind: string, confidence: number): boolean {
  return confidence >= AUTO_SAVE_CONFIDENCE && (kind === "task" || kind === "idea" || kind === "note");
}

function withAutoSaveNote(message: string): string {
  return [message, "", `${italic("I saved that automatically because it looked clear.")} ${code("/undo")} ${italic("if I guessed wrong.")}`].join("\n");
}
