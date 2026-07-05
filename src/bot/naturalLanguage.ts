import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { createPendingCapture } from "../services/pendingCaptures";
import { parseDueDate } from "../utils/dates";
import { bold, h, replyHtml } from "../utils/html";
import { captureConfirmationKeyboard } from "./keyboards";

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
