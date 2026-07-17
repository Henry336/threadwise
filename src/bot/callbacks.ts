import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { cancelTask, completeTask, formatTaskAlreadyCompleted, formatTaskCompleted, formatTaskCreated, restoreCompletedTask, snoozeTask, createTask } from "../services/tasks";
import { consumePendingCapture, ignorePendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { archiveNote, createNote, formatNoteCreated } from "../services/notes";
import { formatPinResult, pinItem } from "../services/pins";
import { formatArchivedPage, listArchivedItems, parseArchiveKind } from "../services/archives";
import { cancelNoteMerge, confirmNoteMerge, formatNoteMergeConfirmed, formatNoteMergePreview, retryNoteMergePreview } from "../services/noteMerges";
import { beginPendingItemEdit, cancelPendingItemEdit, formatEditStarted, type EditableItemField, type EditableItemKind } from "../services/itemEdits";
import { findPendingSearch, semanticSearch } from "../services/search";
import { undoLastAction } from "../services/undo";
import { formatSearchResultsPage } from "./formatters";
import { awaitImageReminderTime, consumePendingImageCapture, discardPendingImageCapture, findPendingImageCapture } from "../services/imageOcr";
import { beginExpenseEdit, cancelPendingExpense, confirmPendingExpense, createPendingExpenseFromText, decodeExpenseFilter, encodeExpenseFilter, findPendingExpense, formatExpenseCreated, formatExpensePage, formatPendingExpense, listExpenses } from "../services/expenses";
import { syncExpenseToExcel } from "../services/excel";
import { bold, code, editOrReplyHtml, editOrReplyText, h } from "../utils/html";
import { archivedPageKeyboard, editCancelKeyboard, expenseConfirmationKeyboard, expensePageKeyboard, helpTopicsKeyboard, imageReminderTimeKeyboard, itemActionsKeyboard, itemCreatedKeyboard, menuBackKeyboard, noteMergePreviewKeyboard, restoreCompletedTaskKeyboard, searchPageKeyboard, startMenuKeyboard, storedImageDeleteKeyboard, taskActionsKeyboard, taskCreatedKeyboard, undoKeyboard } from "./keyboards";
import { cancelBulkAction, confirmBulkAction, formatBulkActionResult } from "../services/bulkActions";
import { isActiveListKind, replyActiveList } from "./activeLists";
import { replyStoredImage, replyStoredImageList, replyStoredImageSearch } from "./storedImageReplies";
import { deleteStoredImage, findStoredImageById } from "../services/storedImages";
import { formatHelpGuide, formatHelpTopic, formatStartText } from "./help";
import { formatSettings } from "../services/settings";

export function registerCallbacks(bot: Bot, ai: AiProvider): void {
  bot.callbackQuery(/^task:done:(.+)$/, async (ctx) => handleTaskDone(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:restore:(.+)$/, async (ctx) => handleTaskRestore(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:snooze:(.+)$/, async (ctx) => handleTaskSnooze(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:cancel:(.+)$/, async (ctx) => handleTaskCancel(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:(pin|unpin):(.+)$/, async (ctx) => handleTaskPin(ctx, ctx.match[2], ctx.match[1] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):(pin|unpin):(.+)$/, async (ctx) => handleItemPin(ctx, ctx.match[1], ctx.match[3], ctx.match[2] === "pin"));
  bot.callbackQuery(/^item:note:archive:(.+)$/, async (ctx) => handleNoteArchive(ctx, ctx.match[1]));
  bot.callbackQuery(/^item:(task|note|idea):edit:(title|description|body|concept):(.+)$/, async (ctx) => handleItemEdit(ctx, ctx.match[1], ctx.match[3], ctx.match[2]));
  bot.callbackQuery(/^item:(task|note|idea):edit:(.+)$/, async (ctx) => handleItemEdit(ctx, ctx.match[1], ctx.match[2], "title"));
  bot.callbackQuery(/^merge:(confirm|retry|cancel):(.+)$/, async (ctx) => handleNoteMergeCallback(ctx, ai, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^archived:(notes|ideas|tasks):(\d+)$/, async (ctx) => handleArchivedPage(ctx, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^search:([^:]+):(\d+)$/, async (ctx) => handleSearchPage(ctx, ai, ctx.match[1], ctx.match[2]));
  bot.callbackQuery("undo:last", async (ctx) => handleUndoLast(ctx));
  bot.callbackQuery("edit:cancel", async (ctx) => handleEditCancel(ctx));
  bot.callbackQuery(/^capture:(task|idea|note|ignore):(.+)$/, async (ctx) => {
    await handleCapture(ctx, ai, ctx.match[1], ctx.match[2]);
  });
  bot.callbackQuery(/^image:(note|task|reminder|expense|text|discard):(.+)$/, async (ctx) => {
    await handleImageAction(ctx, ai, ctx.match[1], ctx.match[2]);
  });
  bot.callbackQuery(/^expense:(save|excel|edit|discard):(.+)$/, async (ctx) => {
    await handleExpenseAction(ctx, ctx.match[1], ctx.match[2]);
  });
  bot.callbackQuery(/^expense:page:(all|day|month|year):([^:]+):(\d+)$/, async (ctx) => {
    await handleExpensePage(ctx, `${ctx.match[1]}:${ctx.match[2]}`, ctx.match[3]);
  });
  bot.callbackQuery(/^bulk:(confirm|cancel):(.+)$/, async (ctx) => {
    await handleBulkAction(ctx, ctx.match[1], ctx.match[2]);
  });
  bot.callbackQuery(/^list:(tasks|notes|ideas):(\d+)$/, async (ctx) => {
    await handleActiveListPage(ctx, ctx.match[1], ctx.match[2]);
  });
  bot.callbackQuery(/^stored-image:page:(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const page = await replyStoredImageList(ctx, user.id, user.settings?.timezone ?? "UTC", Number(ctx.match[1]), true);
    await ctx.answerCallbackQuery({ text: `Page ${page}` });
  });
  bot.callbackQuery(/^stored-image:search:([^:]+):(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const result = await replyStoredImageSearch(ctx, user.id, "", user.settings?.timezone ?? "UTC", Number(ctx.match[2]), ctx.match[1], "all", true);
    await ctx.answerCallbackQuery({ text: `Page ${result.page}` });
  });
  bot.callbackQuery(/^stored-image:open:(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.answerCallbackQuery({ text: "Opening image" });
    await replyStoredImage(ctx, user.id, ctx.match[1] ?? "", true);
  });
  bot.callbackQuery(/^stored-image:caption:(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const item = await beginPendingItemEdit(user.id, "image", ctx.match[1] ?? "", "caption");
    await ctx.answerCallbackQuery({ text: "Send the new caption" });
    await editOrReplyHtml(ctx, formatEditStarted(item), { reply_markup: editCancelKeyboard() });
  });
  bot.callbackQuery(/^stored-image:delete:(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const image = await findStoredImageById(user.id, ctx.match[1] ?? "");
    await ctx.answerCallbackQuery({ text: "Please confirm" });
    await editOrReplyHtml(ctx, `${bold("⚠️ Delete saved image?")}\n${code(image.publicId)} ${h(image.caption || image.fileName || "Saved image")}\nThis removes Threadwise's saved reference and searchable text.`, {
      reply_markup: storedImageDeleteKeyboard(image.id)
    });
  });
  bot.callbackQuery(/^stored-image:delete-(confirm|cancel):(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    if (ctx.match[1] === "cancel") {
      await ctx.answerCallbackQuery({ text: "Image kept" });
      await editOrReplyText(ctx, "Kept it. Nothing changed.", { reply_markup: menuBackKeyboard() });
      return;
    }
    const image = await deleteStoredImage(user.id, ctx.match[2] ?? "");
    await ctx.answerCallbackQuery({ text: "Image deleted" });
    await editOrReplyHtml(ctx, `${bold("🗑️ Image deleted")} ${code(image.publicId)}\nThe original Telegram message is untouched.`, { reply_markup: menuBackKeyboard() });
  });
  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => handleMenu(ctx, ctx.match[1]));
}

async function handleMenu(ctx: Context, action: string | undefined) {
  if (!action) return;
  const user = await ensureUser(ctx);
  await ctx.answerCallbackQuery();
  if (action === "home") {
    await editOrReplyHtml(ctx, formatStartText(user.settings?.timezone ?? "Asia/Singapore"), {
      reply_markup: startMenuKeyboard()
    });
    return;
  }
  if (action === "tasks" || action === "notes" || action === "ideas") {
    await replyActiveList(ctx, user, action, 1, true);
    return;
  }
  if (action === "images") {
    await replyStoredImageList(ctx, user.id, user.settings?.timezone ?? "UTC", 1, true);
    return;
  }
  if (action === "settings") {
    await editOrReplyHtml(ctx, await formatSettings(user.id), { reply_markup: menuBackKeyboard() });
    return;
  }
  if (action === "help") {
    await editOrReplyHtml(ctx, formatHelpGuide(), { reply_markup: helpTopicsKeyboard() });
    return;
  }
  if (action === "integrations") {
    await editOrReplyHtml(ctx, `${formatHelpTopic("excel")}\n\n${bold("📅 Google Calendar")}\nConnect it with ${code("/calendar connect")}, then add a dated task with ${code("/calendar 1")}.`, { reply_markup: menuBackKeyboard() });
    return;
  }
  const topics: Record<string, "reminders" | "notes" | "ideas" | "images" | "expenses" | "excel" | "search" | "commands"> = {
    reminders: "reminders",
    "notes-help": "notes",
    "ideas-help": "ideas",
    "images-help": "images",
    expenses: "expenses",
    excel: "excel",
    search: "search",
    commands: "commands"
  };
  const topic = topics[action];
  if (topic) await editOrReplyHtml(ctx, formatHelpTopic(topic), { reply_markup: menuBackKeyboard() });
}

async function handleActiveListPage(ctx: Context, kindText: string | undefined, pageText: string | undefined) {
  if (!isActiveListKind(kindText) || !pageText) return;
  const requestedPage = Number(pageText);
  if (!Number.isInteger(requestedPage) || requestedPage < 1) return;
  const user = await ensureUser(ctx);
  const page = await replyActiveList(ctx, user, kindText, requestedPage, true);
  await ctx.answerCallbackQuery({ text: `Page ${page}` });
}

async function handleBulkAction(ctx: Context, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId || !ctx.from?.id) return;
  const user = await ensureUser(ctx);
  try {
    if (action === "cancel") {
      await cancelBulkAction(user.id, pendingId, String(ctx.from.id));
      await ctx.answerCallbackQuery({ text: "Canceled" });
      await editOrReplyText(ctx, "Canceled. Everything is still where you left it.", { reply_markup: menuBackKeyboard() });
      return;
    }
    const result = await confirmBulkAction(user.id, pendingId, String(ctx.from.id));
    await ctx.answerCallbackQuery({ text: "Bulk action complete" });
    await editOrReplyHtml(ctx, formatBulkActionResult(result), { reply_markup: undoKeyboard() });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Could not complete action" });
    await editOrReplyText(ctx, error instanceof Error ? error.message : "I couldn't complete that bulk action.", { reply_markup: menuBackKeyboard() });
  }
}

async function handleImageAction(ctx: Context, ai: AiProvider, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId) return;
  const user = await ensureUser(ctx);
  try {
    const pending = await findPendingImageCapture(user.id, pendingId);
    if (action === "discard") {
      await discardPendingImageCapture(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Discarded" });
      await editOrReplyText(ctx, pending.awaitingAction === "stored-image-saved" ? "Discarded the extracted-text preview. Your original image and its searchable OCR text are still saved." : "Discarded. Nothing was saved.", { reply_markup: menuBackKeyboard() });
      return;
    }
    if (action === "text") {
      await ctx.answerCallbackQuery({ text: "Full text" });
      await replyInChunks(ctx, pending.extractedText);
      return;
    }
    if (action === "reminder") {
      await awaitImageReminderTime(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Choose a time" });
      await editOrReplyText(ctx, "When should I remind you? Try: tomorrow at 9am, in 2 hours, or next Monday at noon.", { reply_markup: imageReminderTimeKeyboard(pendingId) });
      return;
    }
    if (action === "expense") {
      const expense = await createPendingExpenseFromText(user.id, pending.extractedText, user.settings?.timezone ?? "UTC", {
        sourceType: "receipt",
        receiptFileUniqueId: pending.telegramUniqueId ?? undefined,
        ocrConfidence: pending.confidence ?? undefined,
        defaultCurrency: user.settings?.expenseCurrency
      });
      await consumePendingImageCapture(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Expense preview" });
      await editOrReplyHtml(ctx, formatPendingExpense(expense, user.settings?.timezone ?? "UTC"), {
        reply_markup: expenseConfirmationKeyboard(expense.id)
      });
      return;
    }
    const consumed = await consumePendingImageCapture(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: "Saving" });
    if (action === "note") {
      const note = await createNote(user.id, consumed.extractedText, ai);
      await editOrReplyHtml(ctx, formatNoteCreated(note), { reply_markup: itemCreatedKeyboard("note", note) });
      return;
    }
    const task = await createTask(user.id, consumed.extractedText, ai);
    await editOrReplyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Action expired or failed" });
    await editOrReplyText(ctx, error instanceof Error ? error.message : "I couldn't finish that image action.", { reply_markup: menuBackKeyboard() });
  }
}

async function handleExpenseAction(ctx: Context, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId) return;
  const user = await ensureUser(ctx);
  try {
    if (action === "discard") {
      await cancelPendingExpense(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Discarded" });
      await editOrReplyText(ctx, "Got it—I left that expense unsaved.", { reply_markup: menuBackKeyboard() });
      return;
    }
    if (action === "edit") {
      await beginExpenseEdit(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Ready to edit" });
      await editOrReplyText(ctx, "Send the fields to change, for example: total 12.50, merchant Toast Box, category Food, date today. Send 'cancel expense edit' to stop.");
      return;
    }
    const expense = await confirmPendingExpense(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: action === "excel" ? "Saving and syncing" : "Saved" });
    let syncMessage = "";
    if (action === "excel") {
      try {
        await syncExpenseToExcel(user.id, expense.id, user.settings?.timezone ?? "UTC");
        syncMessage = "\nExcel: synced";
      } catch (error) {
        syncMessage = `\nExcel: not synced (${error instanceof Error ? error.message : "sync failed"})`;
      }
    }
    await editOrReplyHtml(ctx, `${formatExpenseCreated(expense, user.settings?.timezone ?? "UTC")}${h(syncMessage)}`, { reply_markup: menuBackKeyboard() });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Could not save" });
    await editOrReplyText(ctx, error instanceof Error ? error.message : "I couldn't save that expense.", { reply_markup: menuBackKeyboard() });
  }
}

async function handleExpensePage(ctx: Context, encoded: string, pageText: string | undefined) {
  const page = Number(pageText);
  const filter = decodeExpenseFilter(encoded);
  if (!filter || !Number.isInteger(page) || page < 1) return;
  const user = await ensureUser(ctx);
  const result = await listExpenses(user.id, filter, page, user.settings?.timezone ?? "UTC");
  await ctx.answerCallbackQuery({ text: `Page ${result.page}` });
  await editOrReplyHtml(ctx, formatExpensePage(result, user.settings?.timezone ?? "UTC"), {
    reply_markup: expensePageKeyboard(encodeExpenseFilter(filter), result.page, result.totalPages)
  });
}

async function replyInChunks(ctx: Context, text: string) {
  const maxLength = 3800;
  for (let start = 0; start < text.length; start += maxLength) {
    await ctx.reply(text.slice(start, start + maxLength));
  }
}

async function handleTaskDone(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const completion = await completeTask(user.id, taskId);
  if (completion.alreadyCompleted) {
    await ctx.answerCallbackQuery({ text: "Already completed" });
    await editOrReplyHtml(ctx, formatTaskAlreadyCompleted(completion.task), {
      reply_markup: restoreCompletedTaskKeyboard(completion.task.id)
    });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Completed" });
  await editOrReplyHtml(ctx, formatTaskCompleted(completion.task, user.settings?.timezone), {
    reply_markup: undoKeyboard("↩️ Undo complete")
  });
}

async function handleTaskRestore(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const result = await restoreCompletedTask(user.id, taskId);
  if (!result.restored) {
    await ctx.answerCallbackQuery({ text: "Task is already open" });
    await editOrReplyHtml(ctx, `${bold("Task already open")} ${code(result.task.publicId)} ${h(result.task.title)}`, {
      reply_markup: taskActionsKeyboard(result.task)
    });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Restored" });
  await editOrReplyHtml(ctx, `${bold("↩️ Task restored")} ${code(result.task.publicId)} ${h(result.task.title)}\n${code("/undo")} puts it back if needed.`, {
    reply_markup: taskActionsKeyboard(result.task).row().text("↩️ Undo restore", "undo:last")
  });
}

async function handleTaskSnooze(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const task = await snoozeTask(user.id, taskId, "1h");
  await ctx.answerCallbackQuery({ text: "Snoozed 1 hour" });
  await editOrReplyHtml(ctx, `${bold("⏰ Snoozed for an hour")} ${code(task.publicId)} ${h(task.title)}`, {
    reply_markup: undoKeyboard("↩️ Undo snooze")
  });
}

async function handleTaskCancel(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const task = await cancelTask(user.id, taskId);
  await ctx.answerCallbackQuery({ text: "Canceled task" });
  await editOrReplyHtml(ctx, `${bold("🗑️ Task canceled")} ${code(task.publicId)} ${h(task.title)}`, {
    reply_markup: undoKeyboard("↩️ Undo cancel")
  });
}

async function handleTaskPin(ctx: Context, taskId: string | undefined, shouldPin: boolean) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const item = await pinItem(user.id, taskId, shouldPin);
  await ctx.answerCallbackQuery({ text: shouldPin ? "Marked important" : "No longer important" });
  await editOrReplyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? {
    reply_markup: undoKeyboard("↩️ Undo")
  } : { reply_markup: menuBackKeyboard() });
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
  await editOrReplyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? {
    reply_markup: undoKeyboard("↩️ Undo")
  } : { reply_markup: menuBackKeyboard() });
}

async function handleItemEdit(ctx: Context, kind: string | undefined, itemId: string | undefined, field: string | undefined) {
  if (!isEditableItemKind(kind) || !itemId) return;
  const user = await ensureUser(ctx);
  const item = await beginPendingItemEdit(user.id, kind, itemId, isEditableItemField(field) ? field : "title");
  await ctx.answerCallbackQuery({ text: "Ready to edit" });
  await editOrReplyHtml(ctx, formatEditStarted(item), { reply_markup: editCancelKeyboard() });
}

async function handleNoteArchive(ctx: Context, noteId: string | undefined) {
  if (!noteId) return;
  const user = await ensureUser(ctx);
  const note = await archiveNote(user.id, noteId);
  await ctx.answerCallbackQuery({ text: "Archived note" });
  await editOrReplyHtml(ctx, `${bold("🗃️ Note archived")} ${code(note.publicId)} ${h(note.title)}\nIt is out of the way, not gone. ${code("/undo")} brings it back.`, {
    reply_markup: undoKeyboard("↩️ Undo archive")
  });
}

async function handleUndoLast(ctx: Context) {
  const user = await ensureUser(ctx);
  await ctx.answerCallbackQuery({ text: "Undoing" });
  await editOrReplyHtml(ctx, await undoLastAction(user.id), { reply_markup: menuBackKeyboard() });
}

async function handleEditCancel(ctx: Context) {
  const user = await ensureUser(ctx);
  const canceled = await cancelPendingItemEdit(user.id);
  await ctx.answerCallbackQuery({ text: canceled ? "Edit canceled" : "No edit pending" });
  await editOrReplyText(ctx, canceled ? "Edit canceled. Everything is unchanged." : "There isn’t an edit waiting right now.", { reply_markup: menuBackKeyboard() });
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
    await editOrReplyHtml(ctx, formatSearchResultsPage(results, page, pageSize, parsed.label), {
      reply_markup: searchPageKeyboard(pendingId, Math.min(page, totalPages), totalPages)
    });
  } catch {
    await ctx.answerCallbackQuery({ text: "Search expired" });
    await editOrReplyText(ctx, "That search has gone stale. Run /search again and I’ll fetch a fresh page.", { reply_markup: menuBackKeyboard() });
  }
}

async function handleNoteMergeCallback(ctx: Context, ai: AiProvider, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId) return;
  const user = await ensureUser(ctx);

  try {
    if (action === "cancel") {
      await cancelNoteMerge(user.id, pendingId);
      await ctx.answerCallbackQuery({ text: "Canceled" });
      await editOrReplyText(ctx, "Merge canceled. Your original notes are untouched.", { reply_markup: menuBackKeyboard() });
      return;
    }

    if (action === "retry") {
      const result = await retryNoteMergePreview(user.id, pendingId, ai);
      await ctx.answerCallbackQuery({ text: "New preview" });
      await editOrReplyHtml(ctx, formatNoteMergePreview(result), { reply_markup: noteMergePreviewKeyboard(result.pendingId) });
      return;
    }

    const result = await confirmNoteMerge(user.id, pendingId, ai);
    await ctx.answerCallbackQuery({ text: "Merged" });
    await editOrReplyHtml(ctx, formatNoteMergeConfirmed(result), { reply_markup: undoKeyboard() });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Could not finish merge" });
    await editOrReplyText(ctx, error instanceof Error ? error.message : "I couldn't finish that merge. Try starting it again from /notes.", { reply_markup: menuBackKeyboard() });
  }
}

function isEditableItemKind(kind: string | undefined): kind is EditableItemKind {
  return kind === "task" || kind === "note" || kind === "idea" || kind === "image";
}

function isEditableItemField(field: string | undefined): field is EditableItemField {
  return field === "title" || field === "description" || field === "body" || field === "concept" || field === "caption";
}

async function handleArchivedPage(ctx: Context, kindText: string | undefined, pageText: string | undefined) {
  const kind = kindText ? parseArchiveKind(kindText) : undefined;
  const page = Number(pageText);
  if (!kind || !Number.isInteger(page)) return;

  const user = await ensureUser(ctx);
  const archived = await listArchivedItems(user.id, kind, page);
  await ctx.answerCallbackQuery({ text: `Page ${archived.page}` });
  await editOrReplyHtml(ctx, formatArchivedPage(archived, user.settings?.timezone), {
    reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
  });
}

async function handleCapture(ctx: Context, ai: AiProvider, action: string | undefined, pendingId: string | undefined) {
  if (!action || !pendingId) return;

  const user = await ensureUser(ctx);
  if (action === "ignore") {
    await ignorePendingCapture(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: "Ignored" });
    await editOrReplyText(ctx, "Got it—I’ll leave that one alone.", { reply_markup: menuBackKeyboard() });
    return;
  }

  const pending = await consumePendingCapture(user.id, pendingId);
  await ctx.answerCallbackQuery({ text: "Saving" });

  if (action === "task") {
    const task = await createTask(user.id, pending.sourceText, ai);
    await editOrReplyHtml(ctx, `${formatTaskCreated(task, user.settings?.timezone)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: taskCreatedKeyboard(task)
    });
    return;
  }

  if (action === "idea") {
    const idea = await createIdea(user.id, pending.sourceText, ai);
    await editOrReplyHtml(ctx, `${formatIdeaCreated(idea)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: itemCreatedKeyboard("idea", idea)
    });
    return;
  }

  if (action === "note") {
    const note = await createNote(user.id, pending.sourceText, ai);
    await editOrReplyHtml(ctx, `${formatNoteCreated(note)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: itemCreatedKeyboard("note", note)
    });
    return;
  }

  await editOrReplyText(ctx, "That capture type is no longer available.", { reply_markup: menuBackKeyboard() });
}
