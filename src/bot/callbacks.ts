import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { completeTask, formatTaskCreated, snoozeTask, createTask } from "../services/tasks";
import { consumePendingCapture, ignorePendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { createNote, formatNoteCreated } from "../services/notes";
import { formatPinResult, pinItem } from "../services/pins";
import { formatArchivedPage, listArchivedItems, parseArchiveKind } from "../services/archives";
import { cancelNoteMerge, confirmNoteMerge, formatNoteMergeConfirmed, formatNoteMergePreview, retryNoteMergePreview } from "../services/noteMerges";
import { beginPendingItemEdit, formatEditStarted, type EditableItemField, type EditableItemKind } from "../services/itemEdits";
import { findPendingSearch, semanticSearch } from "../services/search";
import { formatSearchResultsPage } from "./formatters";
import { formatHelpPage, HELP_PAGE_SIZE, helpTotalPages } from "./help";
import { bold, code, h, replyHtml } from "../utils/html";
import { archivedPageKeyboard, helpPageKeyboard, itemActionsKeyboard, noteMergePreviewKeyboard, searchPageKeyboard, taskActionsKeyboard } from "./keyboards";

export function registerCallbacks(bot: Bot, ai: AiProvider): void {
  bot.callbackQuery(/^task:done:(.+)$/, async (ctx) => handleTaskDone(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:snooze:(.+)$/, async (ctx) => handleTaskSnooze(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:(pin|unpin):(.+)$/, async (ctx) => handleTaskPin(ctx, ctx.match[2], ctx.match[1] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):(pin|unpin):(.+)$/, async (ctx) => handleItemPin(ctx, ctx.match[1], ctx.match[3], ctx.match[2] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):edit:(title|description|body|concept):(.+)$/, async (ctx) => handleItemEdit(ctx, ctx.match[1], ctx.match[3], ctx.match[2]));
  bot.callbackQuery(/^item:(task|note|idea):edit:(.+)$/, async (ctx) => handleItemEdit(ctx, ctx.match[1], ctx.match[2], "title"));
  bot.callbackQuery(/^merge:(confirm|retry|cancel):(.+)$/, async (ctx) => handleNoteMergeCallback(ctx, ai, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^archived:(notes|ideas|tasks):(\d+)$/, async (ctx) => handleArchivedPage(ctx, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^search:([^:]+):(\d+)$/, async (ctx) => handleSearchPage(ctx, ai, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^help:(\d+)$/, async (ctx) => handleHelpPage(ctx, ctx.match[1]));
  bot.callbackQuery(/^capture:(task|idea|note|ignore):(.+)$/, async (ctx) => {
    await handleCapture(ctx, ai, ctx.match[1], ctx.match[2]);
  });
}

async function handleHelpPage(ctx: Context, pageText: string | undefined) {
  const page = Number(pageText);
  if (!Number.isInteger(page)) return;

  const totalPages = helpTotalPages(HELP_PAGE_SIZE);
  const safePage = Math.min(Math.max(1, page), totalPages);
  await ctx.answerCallbackQuery({ text: `Page ${safePage}` });
  await replyHtml(ctx, formatHelpPage(safePage), {
    reply_markup: helpPageKeyboard(safePage, totalPages)
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
  await ctx.answerCallbackQuery({ text: shouldPin ? "Marked important" : "No longer important" });
  await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`);
}

async function handleItemPin(ctx: Context, kind: string | undefined, itemId: string | undefined, shouldPin: boolean) {
  if (!isEditableItemKind(kind) || !itemId) return;
  const user = await ensureUser(ctx);
  const item = await pinItem(user.id, itemId, shouldPin);
  await ctx.answerCallbackQuery({
    text: kind === "task"
      ? shouldPin ? "Marked important" : "No longer important"
      : shouldPin ? "Starred" : "Unstarred"
  });
  await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`);
}

async function handleItemEdit(ctx: Context, kind: string | undefined, itemId: string | undefined, field: string | undefined) {
  if (!isEditableItemKind(kind) || !itemId) return;
  const user = await ensureUser(ctx);
  const item = await beginPendingItemEdit(user.id, kind, itemId, isEditableItemField(field) ? field : "title");
  await ctx.answerCallbackQuery({ text: "Ready to edit" });
  await replyHtml(ctx, formatEditStarted(item));
}

async function handleSearchPage(ctx: Context, ai: AiProvider, pendingId: string | undefined, pageText: string | undefined) {
  if (!pendingId || !pageText) return;
  const page = Number(pageText);
  if (!Number.isInteger(page) || page < 1) return;

  const user = await ensureUser(ctx);
  try {
    const parsed = await findPendingSearch(user.id, pendingId);
    const pageSize = 10;
    const results = await semanticSearch(user.id, parsed.query, ai, parsed.kinds, {
      includeDone: parsed.includeDone,
      doneOnly: parsed.doneOnly
    });
    const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
    await ctx.answerCallbackQuery({ text: `Page ${Math.min(page, totalPages)}` });
    await replyHtml(ctx, formatSearchResultsPage(results, page, pageSize, parsed.label), {
      reply_markup: searchPageKeyboard(pendingId, Math.min(page, totalPages), totalPages)
    });
  } catch {
    await ctx.answerCallbackQuery({ text: "Search expired" });
    await ctx.reply("That search expired. Run /search again when you need it.");
  }
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

function isEditableItemKind(kind: string | undefined): kind is EditableItemKind {
  return kind === "task" || kind === "note" || kind === "idea";
}

function isEditableItemField(field: string | undefined): field is EditableItemField {
  return field === "title" || field === "description" || field === "body" || field === "concept";
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
    await replyHtml(ctx, `${formatIdeaCreated(idea)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: itemActionsKeyboard("idea", idea)
    });
    return;
  }

  if (action === "note") {
    const note = await createNote(user.id, pending.sourceText, ai);
    await replyHtml(ctx, `${formatNoteCreated(note)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: itemActionsKeyboard("note", note)
    });
    return;
  }

  await ctx.reply("That capture type is no longer available.");
}
