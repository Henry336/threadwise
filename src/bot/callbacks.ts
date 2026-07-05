import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { completeTask, formatTaskCreated, snoozeTask, createTask } from "../services/tasks";
import { consumePendingCapture, ignorePendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { createNote, formatNoteCreated } from "../services/notes";
import { createReflection, formatReflection } from "../services/reflections";
import { formatPinResult, pinItem } from "../services/pins";
import { formatArchivedPage, listArchivedItems, parseArchiveKind } from "../services/archives";
import { cancelNoteMerge, confirmNoteMerge, formatNoteMergeConfirmed, formatNoteMergePreview, retryNoteMergePreview } from "../services/noteMerges";
import { bold, code, h, replyHtml } from "../utils/html";
import { archivedPageKeyboard, noteMergePreviewKeyboard, taskActionsKeyboard } from "./keyboards";

export function registerCallbacks(bot: Bot, ai: AiProvider): void {
  bot.callbackQuery(/^task:done:(.+)$/, async (ctx) => handleTaskDone(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:snooze:(.+)$/, async (ctx) => handleTaskSnooze(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:(pin|unpin):(.+)$/, async (ctx) => handleTaskPin(ctx, ctx.match[2], ctx.match[1] === "pin"));
  bot.callbackQuery(/^merge:(confirm|retry|cancel):(.+)$/, async (ctx) => handleNoteMergeCallback(ctx, ai, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^archived:(notes|ideas|tasks|reflections):(\d+)$/, async (ctx) => handleArchivedPage(ctx, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^capture:(task|idea|note|reflection|ignore):(.+)$/, async (ctx) => {
    await handleCapture(ctx, ai, ctx.match[1], ctx.match[2]);
  });
}

async function handleTaskDone(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const task = await completeTask(user.id, taskId);
  await ctx.answerCallbackQuery({ text: "Marked done" });
  await replyHtml(ctx, `${bold("Completed")} ${code(task.publicId)} ${h(task.title)}`);
}

async function handleTaskSnooze(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const task = await snoozeTask(user.id, taskId, "1h");
  await ctx.answerCallbackQuery({ text: "Snoozed 1 hour" });
  await replyHtml(ctx, `${bold("Snoozed")} ${code(task.publicId)} ${h(task.title)}`);
}

async function handleTaskPin(ctx: Context, taskId: string | undefined, shouldPin: boolean) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const item = await pinItem(user.id, taskId, shouldPin);
  await ctx.answerCallbackQuery({ text: shouldPin ? "Starred" : "Unstarred" });
  await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`);
}

async function handleNoteMergeCallback(ctx: Context, ai: AiProvider, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId) return;
  const user = await ensureUser(ctx);

  try {
    if (action === "cancel") {
      await cancelNoteMerge(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Canceled" });
      await ctx.reply("Merge canceled. Your notes are unchanged.");
      return;
    }

    if (action === "retry") {
      const result = await retryNoteMergePreview(user.id, pendingId, ai);
      await ctx.answerCallbackQuery({ text: "New preview" });
      await replyHtml(ctx, formatNoteMergePreview(result), { reply_markup: noteMergePreviewKeyboard(result.pendingId) });
      return;
    }

    const result = await confirmNoteMerge(user.id, pendingId, ai);
    await ctx.answerCallbackQuery({ text: "Merged" });
    await replyHtml(ctx, formatNoteMergeConfirmed(result));
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Could not finish merge" });
    await ctx.reply(error instanceof Error ? error.message : "I couldn't finish that merge. Try starting it again from /notes.");
  }
}

async function handleArchivedPage(ctx: Context, kindText: string | undefined, pageText: string | undefined) {
  const kind = kindText ? parseArchiveKind(kindText) : undefined;
  const page = Number(pageText);
  if (!kind || !Number.isInteger(page)) return;

  const user = await ensureUser(ctx);
  const archived = await listArchivedItems(user.id, kind, page);
  await ctx.answerCallbackQuery({ text: `Page ${archived.page}` });
  await replyHtml(ctx, formatArchivedPage(archived), {
    reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
  });
}

async function handleCapture(ctx: Context, ai: AiProvider, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId) return;

  const user = await ensureUser(ctx);
  if (action === "ignore") {
    await ignorePendingCapture(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: "Ignored" });
    await ctx.reply("Got it. I won't save that one.");
    return;
  }

  const pending = await consumePendingCapture(user.id, pendingId);
  await ctx.answerCallbackQuery({ text: "Saving" });

  if (action === "task") {
    const task = await createTask(user.id, pending.sourceText, ai);
    await replyHtml(ctx, `${formatTaskCreated(task, user.settings?.timezone)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: taskActionsKeyboard(task)
    });
    return;
  }

  if (action === "idea") {
    const idea = await createIdea(user.id, pending.sourceText, ai);
    await replyHtml(ctx, `${formatIdeaCreated(idea)}\n\n${code("/undo")} if this was the wrong bucket.`);
    return;
  }

  if (action === "note") {
    const note = await createNote(user.id, pending.sourceText, ai);
    await replyHtml(ctx, `${formatNoteCreated(note)}\n\n${code("/undo")} if this was the wrong bucket.`);
    return;
  }

  const reflection = await createReflection(user.id, pending.sourceText, ai);
  await replyHtml(ctx, `${formatReflection(reflection)}\n\n${code("/undo")} if this was the wrong bucket.`);
}
