import type { Bot, Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { cancelTask, completeTask, formatTaskCreated, restoreCompletedTask, snoozeTask, createTask } from "../services/tasks";
import { consumePendingCapture, ignorePendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated } from "../services/ideas";
import { archiveNote, createNote, formatNoteCreated } from "../services/notes";
import { formatPinnedItems, listPinnedItems, pinItem } from "../services/pins";
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
import { archivedKindsKeyboard, archivedPageKeyboard, editCancelKeyboard, expenseConfirmationKeyboard, expensePageKeyboard, expensesModeKeyboard, helpTopicsKeyboard, ideasModeKeyboard, imageReminderTimeKeyboard, imagesModeKeyboard, itemCreatedKeyboard, menuBackKeyboard, menuInputCancelKeyboard, notesModeKeyboard, noteMergePreviewKeyboard, restoreCompletedTaskKeyboard, searchModeKeyboard, searchPageKeyboard, settingsModeKeyboard, startMenuKeyboard, storedImageDeleteKeyboard, taskCreatedKeyboard, tasksModeKeyboard, undoKeyboard } from "./keyboards";
import { cancelBulkAction, confirmBulkAction, formatBulkActionResult } from "../services/bulkActions";
import { isActiveListKind, replyActiveList } from "./activeLists";
import { replyStoredImage, replyStoredImageList, replyStoredImageSearch } from "./storedImageReplies";
import { deleteStoredImage, findStoredImageById } from "../services/storedImages";
import { formatHelpGuide, formatHelpTopic, formatMainMenuText, formatPrivacyText } from "./help";
import { formatSettings } from "../services/settings";
import { beginMenuInput, clearMenuInput, type MenuInputAction } from "./menuInputs";
import { rememberCallbackControlCard } from "./controlCards";
import { buildItemCard } from "./itemCards";
import { appendListOrigin, listOrigin, rememberListOrigin } from "./navigationState";
import { cancelTransientInteractions } from "./interactions";

export function registerCallbacks(bot: Bot, ai: AiProvider): void {
  bot.callbackQuery(/^task:done:(.+)$/, async (ctx) => handleTaskDone(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:restore:(.+)$/, async (ctx) => handleTaskRestore(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:snooze:(.+)$/, async (ctx) => handleTaskSnooze(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:cancel:(.+)$/, async (ctx) => handleTaskCancel(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:(pin|unpin):(.+)$/, async (ctx) => handleTaskPin(ctx, ctx.match[2], ctx.match[1] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):(pin|unpin):(.+)$/, async (ctx) => handleItemPin(ctx, ctx.match[1], ctx.match[3], ctx.match[2] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):open:([^:]+)(?::(\d+))?$/, async (ctx) => handleItemOpen(ctx, ctx.match[1], ctx.match[2], ctx.match[3]));
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
  if (!ctx.from) return;
  await cancelTransientInteractions(user.id, ctx.from.id);
  await ctx.answerCallbackQuery();
  rememberCallbackControlCard(ctx);
  if (action === "home") {
    await editOrReplyHtml(ctx, formatMainMenuText(user.settings?.timezone ?? "Asia/Singapore"), {
      reply_markup: startMenuKeyboard()
    });
    return;
  }
  if (action === "tasks") {
    await editOrReplyHtml(ctx, `${bold("📋 Tasks")}\nTasks are the things you want to do. Add a due time when you also want a reminder.`, { reply_markup: tasksModeKeyboard() });
    return;
  }
  if (action === "notes") {
    await editOrReplyHtml(ctx, `${bold("📝 Notes")}\nSave reference material, thoughts, and anything you want to find later.`, { reply_markup: notesModeKeyboard() });
    return;
  }
  if (action === "ideas") {
    await editOrReplyHtml(ctx, `${bold("💡 Ideas")}\nCapture an idea now; shape, score, or build it later.`, { reply_markup: ideasModeKeyboard() });
    return;
  }
  if (action === "images") {
    await editOrReplyHtml(ctx, `${bold("🖼️ Images")}\nBrowse saved images here, or open the visual gallery on the dashboard.`, { reply_markup: imagesModeKeyboard() });
    return;
  }
  if (action === "expenses") {
    await editOrReplyHtml(ctx, `${bold("💰 Expenses")}\nRecord spending, review recent entries, or export to Excel.`, { reply_markup: expensesModeKeyboard() });
    return;
  }
  if (action === "search") {
    await editOrReplyHtml(ctx, `${bold("🔎 Search")}\nFind anything across tasks, notes, ideas, and saved images.`, { reply_markup: searchModeKeyboard() });
    return;
  }
  if (action === "settings") {
    await editOrReplyHtml(ctx, `${bold("⚙️ Settings")}\nPreferences, integrations, and privacy controls live here.`, { reply_markup: settingsModeKeyboard() });
    return;
  }
  if (action === "tasks-list" || action === "notes-list" || action === "ideas-list") {
    await replyActiveList(ctx, user, action.slice(0, -5) as "tasks" | "notes" | "ideas", 1, true);
    return;
  }
  if (action === "images-list") {
    await replyStoredImageList(ctx, user.id, user.settings?.timezone ?? "UTC", 1, true);
    return;
  }
  if (action === "expenses-list") {
    const filter = decodeExpenseFilter("all:all");
    if (!filter) return;
    const result = await listExpenses(user.id, filter, 1, user.settings?.timezone ?? "UTC");
    await editOrReplyHtml(ctx, formatExpensePage(result, user.settings?.timezone ?? "UTC"), {
      reply_markup: expensePageKeyboard(encodeExpenseFilter(filter), result.page, result.totalPages)
    });
    return;
  }
  if (action === "preferences") {
    await editOrReplyHtml(ctx, await formatSettings(user.id), { reply_markup: menuBackKeyboard("‹ Settings", "menu:settings") });
    return;
  }
  if (action === "help") {
    await editOrReplyHtml(ctx, formatHelpGuide(), { reply_markup: helpTopicsKeyboard() });
    return;
  }
  if (action === "integrations") {
    await editOrReplyHtml(ctx, `${formatHelpTopic("excel")}\n\n${bold("📅 Google Calendar")}\nConnect it with ${code("/calendar connect")}, then add a dated task with ${code("/calendar 1")}.`, { reply_markup: menuBackKeyboard("‹ Settings", "menu:settings") });
    return;
  }
  if (action === "privacy") {
    await editOrReplyHtml(ctx, formatPrivacyText(), { reply_markup: settingsModeKeyboard() });
    return;
  }
  if (action === "important") {
    await editOrReplyHtml(ctx, formatPinnedItems(await listPinnedItems(user.id)), { reply_markup: searchModeKeyboard() });
    return;
  }
  if (action === "archived") {
    await editOrReplyHtml(ctx, `${bold("🗃️ Archived")}\nChoose what you want to review.`, { reply_markup: archivedKindsKeyboard() });
    return;
  }
  const archivedKind = action.match(/^(tasks|notes|ideas)-archived$/)?.[1] as "tasks" | "notes" | "ideas" | undefined;
  if (archivedKind) {
    const archived = await listArchivedItems(user.id, archivedKind, 1);
    await editOrReplyHtml(ctx, formatArchivedPage(archived, user.settings?.timezone), {
      reply_markup: archivedPageKeyboard(archivedKind, archived.page, archived.totalPages)
    });
    return;
  }
  const inputs: Record<string, { action: MenuInputAction; title: string; prompt: string; back: string }> = {
    "tasks-add": { action: "task", title: "＋ Add task", prompt: "What needs doing? A due date is optional.", back: "tasks" },
    "tasks-reminder": { action: "reminder", title: "⏰ Set reminder", prompt: "What should I remind you about, and when?", back: "tasks" },
    "notes-add": { action: "note", title: "＋ Add note", prompt: "Send the note you want to keep.", back: "notes" },
    "ideas-add": { action: "idea", title: "＋ Add idea", prompt: "Send the idea you want to capture.", back: "ideas" },
    "search-input": { action: "search", title: "🔎 Search", prompt: "What are you looking for?", back: "search" },
    "notes-search": { action: "note-search", title: "🔎 Search notes", prompt: "What should I look for in your notes?", back: "notes" },
    "ideas-search": { action: "idea-search", title: "🔎 Search ideas", prompt: "What should I look for in your ideas?", back: "ideas" },
    "images-search": { action: "image-search", title: "🔎 Find an image", prompt: "Describe the caption, filename, or text inside it.", back: "images" },
    "expenses-add": { action: "expense", title: "＋ Add expense", prompt: "Describe the expense, including the amount. You can add merchant, date, category, or payment method too.", back: "expenses" }
  };
  const input = inputs[action];
  if (input) {
    beginMenuInput(user.id, ctx.from.id, input.action);
    await editOrReplyHtml(ctx, `${bold(input.title)}\n${h(input.prompt)}\n\nSend your answer as the next message.`, {
      reply_markup: menuInputCancelKeyboard(input.back)
    });
    return;
  }
  if (action === "cancel-input") {
    clearMenuInput(user.id, ctx.from.id);
    await editOrReplyHtml(ctx, `${bold("Canceled")}\nNothing was changed.`, { reply_markup: startMenuKeyboard() });
    return;
  }
  const topics: Record<string, "reminders" | "notes" | "ideas" | "images" | "expenses" | "excel" | "search" | "commands"> = {
    reminders: "reminders",
    "notes-help": "notes",
    "ideas-help": "ideas",
    "images-help": "images",
    excel: "excel",
    commands: "commands"
  };
  const topic = topics[action];
  if (topic) {
    const parentLabel = action === "excel" ? "‹ Expenses" : "‹ Help";
    const parentCallback = action === "excel" ? "menu:expenses" : "menu:help";
    await editOrReplyHtml(ctx, formatHelpTopic(topic), { reply_markup: menuBackKeyboard(parentLabel, parentCallback) });
  }
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
    await editOrReplyHtml(ctx, `${bold("Already complete")}\n${h(completion.task.title)}\nNeed it back? Restore it below.`, { reply_markup: restoreCompletedTaskKeyboard(completion.task.id) });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Completed" });
  await replyActiveList(ctx, user, "tasks", listOrigin(user.id, "task") ?? 1, true, {
    label: "↩️ Undo complete",
    callbackData: "undo:last"
  });
}

async function handleTaskRestore(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const result = await restoreCompletedTask(user.id, taskId);
  if (!result.restored) {
    await ctx.answerCallbackQuery({ text: "Task is already open" });
    const card = await buildItemCard(user.id, "task", result.task.publicId, user.settings?.timezone ?? "UTC", "Task already open");
    appendListOrigin(card.keyboard, user.id, "task");
    await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Restored" });
  const card = await buildItemCard(user.id, "task", result.task.publicId, user.settings?.timezone ?? "UTC", "↩️ Task restored");
  appendListOrigin(card.keyboard, user.id, "task");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard.row().text("↩️ Undo restore", "undo:last") });
}

async function handleTaskSnooze(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const task = await snoozeTask(user.id, taskId, "1h");
  await ctx.answerCallbackQuery({ text: "Snoozed 1 hour" });
  const card = await buildItemCard(user.id, "task", task.publicId, user.settings?.timezone ?? "UTC", "⏰ Snoozed for an hour");
  appendListOrigin(card.keyboard, user.id, "task");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard.row().text("↩️ Undo snooze", "undo:last") });
}

async function handleTaskCancel(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  await cancelTask(user.id, taskId);
  await ctx.answerCallbackQuery({ text: "Canceled task" });
  await replyActiveList(ctx, user, "tasks", listOrigin(user.id, "task") ?? 1, true, {
    label: "↩️ Undo cancel",
    callbackData: "undo:last"
  });
}

async function handleTaskPin(ctx: Context, taskId: string | undefined, shouldPin: boolean) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const item = await pinItem(user.id, taskId, shouldPin);
  await ctx.answerCallbackQuery({ text: shouldPin ? "Marked important" : "No longer important" });
  const card = await buildItemCard(user.id, "task", item.publicId, user.settings?.timezone ?? "UTC", shouldPin ? "⭐ Marked important" : "☆ Removed from important");
  appendListOrigin(card.keyboard, user.id, "task");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
}

async function handleItemPin(ctx: Context, kind: string | undefined, itemId: string | undefined, shouldPin: boolean) {
  if (!isEditableItemKind(kind) || kind === "image" || !itemId) return;
  const user = await ensureUser(ctx);
  const item = await pinItem(user.id, itemId, shouldPin);
  await ctx.answerCallbackQuery({
    text: kind === "task"
      ? shouldPin ? "Marked important" : "No longer important"
      : shouldPin ? "Starred" : "Unstarred"
  });
  const card = await buildItemCard(user.id, kind, item.publicId, user.settings?.timezone ?? "UTC", shouldPin ? "⭐ Starred" : "☆ Unstarred");
  appendListOrigin(card.keyboard, user.id, kind);
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
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
  await archiveNote(user.id, noteId);
  await ctx.answerCallbackQuery({ text: "Archived note" });
  await replyActiveList(ctx, user, "notes", listOrigin(user.id, "note") ?? 1, true, {
    label: "↩️ Undo archive",
    callbackData: "undo:last"
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
    const pageSize = 5;
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

async function handleItemOpen(ctx: Context, kind: string | undefined, itemId: string | undefined, pageText: string | undefined) {
  if (!isEditableItemKind(kind) || !itemId || kind === "image") return;
  const user = await ensureUser(ctx);
  const card = await buildItemCard(user.id, kind, itemId, user.settings?.timezone ?? "UTC");
  const page = Math.max(1, Number(pageText) || 1);
  const listKind = kind === "task" ? "tasks" : kind === "note" ? "notes" : "ideas";
  rememberListOrigin(user.id, kind, page);
  card.keyboard.row().text(`‹ Back to page ${page}`, `list:${listKind}:${page}`);
  await ctx.answerCallbackQuery({ text: "Opened" });
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
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
