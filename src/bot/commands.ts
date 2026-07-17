import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { formatCommandReference, formatHelpGuide, formatHelpTopic, formatPrivacyText, formatStartShortcutText } from "./help";
import { ensureUser } from "../services/users";
import { commandBody, normalizePublicId } from "../utils/text";
import {
  createIdea,
  createImplementationBrief,
  findIdeaReference,
  formatIdeaCreated,
  formatIdeaDetail,
  renameIdeaTitle,
  scoreIdea,
  updateIdeaConcept
} from "../services/ideas";
import {
  assignTask,
  cancelTask,
  createScheduledReminder,
  createTask,
  completeTask,
  findTaskReference,
  formatAssignee,
  formatTaskAlreadyCompleted,
  formatTaskCompleted,
  formatTaskCreated,
  renameTaskTitle,
  rescheduleTask,
  snoozeTask,
  unassignTask,
  updateTaskDescription
} from "../services/tasks";
import {
  analyzeNoteStyle,
  archiveNote,
  createNote,
  findAnyNote,
  findNoteReference,
  formatNoteAnalysis,
  formatNoteCreated,
  formatNoteDetail,
  formatRecentNotes,
  renameNoteTitle,
  searchNotes,
  updateNoteBody
} from "../services/notes";
import { buildReview } from "../services/review";
import { formatSettings, updateSetting } from "../services/settings";
import { createPendingSearch, parseSearchRequest, semanticSearch } from "../services/search";
import { formatPinnedItems, formatPinResult, listPinnedItems, pinItem } from "../services/pins";
import { undoLastAction } from "../services/undo";
import { formatArchivedPage, listArchivedItems, parseArchiveKind, restoreArchivedItem } from "../services/archives";
import { createNoteMergePreview, formatNoteMergePreview } from "../services/noteMerges";
import { createGmailConnectUrl, disconnectGmail, formatGmailStatus, gmailConfigured, scanGmailNow } from "../services/gmail";
import { calendarConfigured, createCalendarConnectUrl, disconnectCalendar, formatCalendarStatus } from "../services/googleCalendar";
import { getReminderDiagnostics } from "../services/reminders";
import { appVersion, formatVersionStatus } from "../services/version";
import { formatIdeaScore, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { bold, code, h, replyHtml } from "../utils/html";
import { archivedPageKeyboard, dashboardLinkKeyboard, helpTopicsKeyboard, ideaBriefKeyboard, itemActionsKeyboard, itemCreatedKeyboard, itemListKeyboard, noteMergePreviewKeyboard, privateMenuKeyboard, searchPageKeyboard, settingsModeKeyboard, storedImageDeleteKeyboard, taskActionsKeyboard, taskCreatedKeyboard, undoKeyboard } from "./keyboards";
import { carryRecurrenceToTaskText, formatDateTimeForUser, parseDueDate, splitReminderText } from "../utils/dates";
import { replyWithTaskCalendar } from "./calendarReplies";
import { parseNaturalHelpRequest } from "./naturalCommandParsing";
import { taskCreationOptionsFromContext } from "./taskMentions";
import { createPendingExpenseFromText, encodeExpenseFilter, formatExpenseCreated, formatExpensePage, formatPendingExpense, listExpenses, parseExpenseFilter, updateSavedExpense } from "../services/expenses";
import { createExpenseWorkbook, createMicrosoftConnectUrl, disconnectMicrosoft, exportExpensesWorkbook, formatExcelStatus, linkExpenseWorkbook, microsoftExcelConfigured, syncUnsyncedExpenses } from "../services/excel";
import { expenseConfirmationKeyboard, expensePageKeyboard, restoreCompletedTaskKeyboard } from "./keyboards";
import { allowedTelegramIds } from "../config/env";
import { isGroupChat, isTelegramContextAllowed, telegramGroupPrivacyEnabled } from "./groupRouting";
import { createBulkActionPreview, formatBulkActionPreview, parseBulkActionRequest, parseBulkReferences, type BulkActionRequest } from "../services/bulkActions";
import { bulkActionConfirmationKeyboard } from "./keyboards";
import { replyActiveList } from "./activeLists";
import { replyStoredImage, replyStoredImageList, replyStoredImageSearch } from "./storedImageReplies";
import { findStoredImageReference, updateStoredImageCaption } from "../services/storedImages";
import { showDashboardLink, showMainMenu } from "./menu";
import { replyControlCardHtml } from "./controlCards";

export function registerCommands(bot: Bot, ai: AiProvider): void {
  bot.command("start", async (ctx) => handleStart(ctx));
  bot.command("menu", async (ctx) => handleMenuCommand(ctx));
  bot.command("help", async (ctx) => handleHelp(ctx));
  bot.command("dashboard", async (ctx) => showDashboardLink(ctx));
  bot.command("privacy", async (ctx) => replyHtml(ctx, formatPrivacyText(), { reply_markup: dashboardLinkKeyboard() }));
  bot.command("commands", async (ctx) => replyHtml(ctx, formatCommandReference()));
  bot.command("idea", async (ctx) => handleIdea(ctx, ai));
  bot.command("ideas", async (ctx) => handleIdeas(ctx));
  bot.command("note", async (ctx) => handleNote(ctx, ai));
  bot.command("notes", async (ctx) => handleNotes(ctx));
  bot.command("note-analysis", async (ctx) => handleNoteAnalysis(ctx, ai));
  bot.command("merge", async (ctx) => handleMerge(ctx, ai));
  bot.command("review", async (ctx) => handleReview(ctx));
  bot.command("add", async (ctx) => handleAdd(ctx, ai));
  bot.command("remind", async (ctx) => handleRemind(ctx, ai));
  bot.command("tasks", async (ctx) => handleTasks(ctx));
  bot.command("task", async (ctx) => handleTaskDetail(ctx));
  bot.command("done", async (ctx) => handleDone(ctx));
  bot.command("snooze", async (ctx) => handleSnooze(ctx));
  bot.command(["reschedule", "move"], async (ctx) => handleReschedule(ctx));
  bot.command("assign", async (ctx) => handleAssign(ctx));
  bot.command("unassign", async (ctx) => handleUnassign(ctx));
  bot.command("undo", async (ctx) => handleUndo(ctx));
  bot.command(["rename", "edit"], async (ctx) => handleRename(ctx));
  bot.command(["pin", "star", "important"], async (ctx) => handlePin(ctx, true));
  bot.command(["unpin", "unstar"], async (ctx) => handlePin(ctx, false));
  bot.command("pins", async (ctx) => handlePins(ctx));
  bot.command(["archived", "archives"], async (ctx) => handleArchived(ctx));
  bot.command(["archive", "remove"], async (ctx) => handleArchive(ctx));
  bot.command("restore", async (ctx) => handleRestore(ctx));
  bot.command(["cancel", "delete"], async (ctx) => handleCancel(ctx));
  bot.command("settings", async (ctx) => handleSettings(ctx));
  bot.command("search", async (ctx) => handleSearch(ctx, ai));
  bot.command("score", async (ctx) => handleScore(ctx, ai));
  bot.command("brief", async (ctx) => handleBrief(ctx));
  bot.command("calendar", async (ctx) => handleCalendar(ctx, true));
  bot.command("googlecal", async (ctx) => handleCalendar(ctx, false));
  bot.command("gmail", async (ctx) => handleGmail(ctx, ai));
  bot.command("expense", async (ctx) => handleExpense(ctx));
  bot.command("expenses", async (ctx) => handleExpenses(ctx));
  bot.command("excel", async (ctx) => handleExcel(ctx));
  bot.command("images", async (ctx) => handleImages(ctx));
  bot.command("image", async (ctx) => handleImage(ctx));
  bot.command("version", async (ctx) => handleVersion(ctx, ai));
  bot.command("groupcheck", async (ctx) => handleGroupCheck(ctx));
}

async function handleHelp(ctx: Context) {
  const topicText = commandBody(ctx.message?.text ?? "", "help");
  const topic = topicText ? parseNaturalHelpRequest(`help ${topicText}`) : undefined;
  await replyHtml(ctx, topic ? formatHelpTopic(topic) : formatHelpGuide(), topic ? {} : { reply_markup: helpTopicsKeyboard() });
}

async function handleIdea(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "idea");
  if (!text) {
    await ctx.reply("Send it like this: /idea build a bot that...");
    return;
  }

  try {
    const idea = await createIdea(user.id, text, ai);
    await replyControlCardHtml(ctx, formatIdeaCreated(idea), { reply_markup: itemCreatedKeyboard("idea", idea) });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't save that idea. Try again in a moment.");
  }
}

async function handleNote(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "note");
  if (!text) {
    await ctx.reply("Send it like this: /note important thing I want to remember... or /note 1");
    return;
  }

  if (/^(\d+|NOTE-\d+)$/i.test(text)) {
    try {
      const note = await findNoteReference(user.id, normalizePublicId(text));
      await replyControlCardHtml(ctx, formatNoteDetail(note, user.settings?.timezone), { reply_markup: itemActionsKeyboard("note", note) });
    } catch {
      try {
        const archivedNote = await findAnyNote(user.id, normalizePublicId(text));
        await replyHtml(ctx, `${formatNoteDetail(archivedNote, user.settings?.timezone)}\n\n${code(archivedNote.archivedAt ? "/restore " + archivedNote.publicId : "/notes")}`);
      } catch {
        await ctx.reply("I couldn't find that note. /notes will show the recent ones.");
      }
    }
    return;
  }

  try {
    const note = await createNote(user.id, text, ai);
    await replyControlCardHtml(ctx, formatNoteCreated(note), { reply_markup: itemCreatedKeyboard("note", note) });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't save that note. Try again in a moment.");
  }
}

async function handleNotes(ctx: Context) {
  const user = await ensureUser(ctx);
  const query = commandBody(ctx.message?.text ?? "", "notes");
  if (!query) {
    await replyActiveList(ctx, user, "notes");
    return;
  }
  const notes = await searchNotes(user.id, query);
  const keyboard = itemListKeyboard("note", notes);
  await replyControlCardHtml(ctx, formatRecentNotes(notes), keyboard ? { reply_markup: keyboard } : undefined);
}

async function handleImages(ctx: Context) {
  const user = await ensureUser(ctx);
  const query = commandBody(ctx.message?.text ?? "", "images");
  if (query) {
    const scoped = query.match(/^(caption|captions|text|ocr)\s*[:\-]?\s*(.+)$/i);
    await replyStoredImageSearch(ctx, user.id, scoped?.[2] ?? query, user.settings?.timezone ?? "UTC", 1, undefined, scoped?.[1]?.toLowerCase().startsWith("caption") ? "caption" : scoped ? "text" : "all");
    return;
  }
  await replyStoredImageList(ctx, user.id, user.settings?.timezone ?? "UTC");
}

async function handleImage(ctx: Context) {
  const user = await ensureUser(ctx);
  const reference = commandBody(ctx.message?.text ?? "", "image");
  if (!reference) {
    await ctx.reply("Try /image IMG-1, /image caption IMG-1 July electricity bill, /image delete IMG-1, or /images passport.");
    return;
  }
  try {
    const captionMatch = reference.match(/^(?:caption|label|rename)\s+(\d+|IMG-\d+)\s+(?:as\s+|to\s+)?(.+)$/i);
    if (captionMatch?.[1] && captionMatch[2]) {
      const image = await updateStoredImageCaption(user.id, normalizePublicId(captionMatch[1]), captionMatch[2]);
      await replyHtml(ctx, `${bold("✅ Caption updated")} ${code(image.publicId)} ${h(image.caption ?? captionMatch[2])}\n${code("/undo")} restores the previous caption.`, { reply_markup: undoKeyboard("↩️ Undo caption") });
      return;
    }
    const deleteMatch = reference.match(/^(?:delete|remove|forget)\s+(\d+|IMG-\d+)$/i);
    if (deleteMatch?.[1]) {
      const image = await findStoredImageReference(user.id, normalizePublicId(deleteMatch[1]));
      await replyHtml(ctx, `${bold("⚠️ Delete saved image?")}\n${code(image.publicId)} ${h(image.caption || image.fileName || "Saved image")}\nThis removes Threadwise's saved reference and searchable text.`, { reply_markup: storedImageDeleteKeyboard(image.id) });
      return;
    }
    await replyStoredImage(ctx, user.id, normalizePublicId(reference));
  } catch {
    await ctx.reply("I couldn't find that saved image. Use /images to see the current list.");
  }
}

async function handleIdeas(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "ideas");
  if (!body) {
    await replyActiveList(ctx, user, "ideas");
    return;
  }

  try {
    const idea = await findIdeaReference(user.id, normalizePublicId(body));
    await replyControlCardHtml(ctx, formatIdeaDetail(idea, user.settings?.timezone), { reply_markup: itemActionsKeyboard("idea", idea) });
  } catch {
    await ctx.reply("I couldn't find that idea. /ideas will show the recent ones.");
  }
}

async function handleNoteAnalysis(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const analysis = await analyzeNoteStyle(user.id, ai);
  await replyHtml(ctx, formatNoteAnalysis(analysis));
}

async function handleMerge(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "merge");
  const [kind, ...references] = body.split(/\s+/).filter(Boolean);
  if (kind?.toLowerCase() !== "notes" || references.length < 2) {
    await ctx.reply("Send it like this: /merge notes 1 2 3 or /merge notes NOTE-1 NOTE-2 NOTE-3");
    return;
  }

  try {
    const preview = await createNoteMergePreview(user.id, references.map(normalizePublicId), ai);
    await replyHtml(ctx, formatNoteMergePreview(preview), {
      reply_markup: noteMergePreviewKeyboard(preview.pendingId)
    });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that merge. Try /notes to check the note numbers.");
  }
}

async function handleReview(ctx: Context) {
  const user = await ensureUser(ctx);
  const review = await buildReview(user.id, user.settings?.timezone ?? "UTC");
  await replyHtml(ctx, review);
}

async function handleAdd(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "add");
  if (!text) {
    await ctx.reply("Send it like this: /add pay invoice tomorrow at 9am");
    return;
  }

  try {
    const task = await createTask(user.id, text, ai, taskCreationOptionsFromContext(ctx, text));
    await replyControlCardHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't add that task. Try again in a moment.");
  }
}

async function handleRemind(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "remind");
  if (!body) {
    await ctx.reply("Send it like this: /remind tomorrow at 9am | submit the form");
    return;
  }

  const parsed = splitReminderText(body);
  const settings = user.settings;
  if (!settings) {
    await ctx.reply("Your reminder settings are missing. Try /start once, then send the reminder again.");
    return;
  }

  const scheduledAt = parseDueDate(parsed?.whenText ?? body, settings.timezone);
  if (!parsed || !scheduledAt) {
    await ctx.reply(
      [
        "I couldn't find a reminder time in that.",
        "",
        "Try:",
        "/remind tomorrow at 9am | submit the form",
        "/remind next monday at 10 | review notes",
        "/remind 2026-07-08 14:30 | call the clinic",
        "/remind in 2 hours | check deployment"
      ].join("\n")
    );
    return;
  }

  if (scheduledAt.getTime() <= Date.now()) {
    await ctx.reply("That reminder time has already passed. Pick a future time and I'll catch it.");
    return;
  }

  try {
    const taskText = carryRecurrenceToTaskText(parsed.taskText, parsed.whenText);
    const task = await createScheduledReminder(user.id, taskText, scheduledAt, ai, taskCreationOptionsFromContext(ctx, taskText));
    await replyControlCardHtml(ctx, formatTaskCreated(task, settings.timezone), { reply_markup: taskCreatedKeyboard(task) });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't save that reminder. Try again in a moment.");
  }
}

async function handleTasks(ctx: Context) {
  const user = await ensureUser(ctx);
  await replyActiveList(ctx, user, "tasks");
}

async function handleTaskDetail(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "task");
  if (!id) {
    await ctx.reply("Send it like this: /task 1 or /task TASK-1");
    return;
  }

  try {
    const task = await findTaskReference(user.id, normalizePublicId(id));
    await replyControlCardHtml(
      ctx,
      formatTaskDetail(task, user.settings?.timezone, user.settings
        ? {
            reminderIntervalMinutes: user.settings.reminderIntervalMinutes,
            maxRemindersPerDay: user.settings.maxRemindersPerDay,
            quietHoursStart: user.settings.quietHoursStart,
            quietHoursEnd: user.settings.quietHoursEnd
          }
        : undefined),
      { reply_markup: taskActionsKeyboard(task) }
    );
  } catch (error) {
    await ctx.reply(taskLookupError(error));
  }
}

async function handleDone(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "done");
  if (!id) {
    await ctx.reply("Send it like this: /done 1, /done TASK-1, or /done 1 2 3 for a confirmation preview.");
    return;
  }

  const references = parseBulkReferences(id);
  if (references && references.length > 1) {
    await replyBulkActionPreview(ctx, user.id, { action: "complete", itemKind: "task", references });
    return;
  }

  try {
    const completion = await completeTask(user.id, normalizePublicId(id));
    if (completion.alreadyCompleted) {
      await replyHtml(ctx, formatTaskAlreadyCompleted(completion.task), { reply_markup: restoreCompletedTaskKeyboard(completion.task.id) });
      return;
    }
    await replyHtml(ctx, `${formatTaskCompleted(completion.task, user.settings?.timezone)}\n${code("/undo")} if that was too quick.`, { reply_markup: undoKeyboard("↩️ Undo complete") });
  } catch (error) {
    await ctx.reply(taskLookupError(error));
  }
}

async function handleSnooze(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "snooze");
  const [id, ...durationParts] = body.split(/\s+/).filter(Boolean);
  if (!id) {
    await ctx.reply("Send it like this: /snooze 1 1h or /snooze TASK-1 1h");
    return;
  }

  try {
    const task = await snoozeTask(user.id, normalizePublicId(id), durationParts.join(" "));
    await replyHtml(ctx, `${bold("⏰ Snoozed")} ${code(task.publicId)} ${h(task.title)}\nI’ll bring it back later. ${code("/undo")} restores the previous reminder time.`, { reply_markup: undoKeyboard("↩️ Undo snooze") });
  } catch (error) {
    await ctx.reply(taskLookupError(error));
  }
}

async function handleReschedule(ctx: Context) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/move") ? "move" : "reschedule";
  const body = commandBody(ctx.message?.text ?? "", command);
  const parsed = parseRescheduleBody(body);
  if (!parsed) {
    await ctx.reply(`Send it like this: /${command} 1 tomorrow at 10am, /${command} TASK-1 in 2 hours, or /${command} 1 no date`);
    return;
  }

  try {
    const task = await rescheduleTask(user.id, normalizePublicId(parsed.reference), parsed.whenText);
    await replyHtml(ctx, `${bold("📅 Schedule updated")} ${code(task.publicId)} ${h(task.title)}\n${task.dueAt ? `${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, user.settings?.timezone ?? task.timezone ?? "UTC"))}` : `${bold("Due")} none`}\n${code("/undo")} restores the previous schedule.`, { reply_markup: undoKeyboard("↩️ Undo reschedule") });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : taskLookupError(error));
  }
}

async function handleAssign(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "assign");
  const match = body.match(/^(?:task\s+)?(\S+)\s+(?:to\s+)?(.+)$/i);
  if (!match?.[1] || !match[2]) {
    await ctx.reply("Send it like this: /assign 1 @alex and @sam, or /assign TASK-1 Dad and @sam");
    return;
  }

  try {
    const task = await assignTask(user.id, normalizePublicId(match[1]), match[2], taskCreationOptionsFromContext(ctx, match[2]));
    await replyHtml(ctx, `${bold("👥 Assignees updated")} ${code(task.publicId)}\nNow with ${h(formatAssignee(task))}.${assigneeDmSetupLine(ctx)}`);
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : taskLookupError(error));
  }
}

async function handleUnassign(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "unassign");
  const match = body.match(/^(?:task\s+)?(\S+)(?:\s+(.+))?$/i);
  if (!match?.[1]) {
    await ctx.reply("Send it like this: /unassign 1 to clear everyone, or /unassign 1 @username to remove one person.");
    return;
  }

  try {
    const task = await unassignTask(user.id, normalizePublicId(match[1]), match[2], taskCreationOptionsFromContext(ctx, match[2] ?? ""));
    await replyHtml(ctx, `${bold("👥 Assignees updated")} ${code(task.publicId)} ${h(formatAssignee(task))}`);
  } catch (error) {
    await ctx.reply(taskLookupError(error));
  }
}

function assigneeDmSetupLine(ctx: Context): string {
  if (!isGroupChat(ctx) || !ctx.me.username) return "";
  return `\nPrivate nudges are opt-in: https://t.me/${ctx.me.username}?start=dm`;
}

async function handleUndo(ctx: Context) {
  const user = await ensureUser(ctx);
  await replyHtml(ctx, await undoLastAction(user.id));
}

async function handleRename(ctx: Context) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/edit") ? "edit" : "rename";
  const body = commandBody(ctx.message?.text ?? "", command);
  const parsed = parseReferenceAndTitle(body);
  const reference = parsed?.reference;
  const title = parsed?.title ?? "";

  if (!reference || !title) {
    await ctx.reply(`Send it like this: /${command} 1 Follow up with Alex, /${command} note 2 Deployment notes, or /${command} IDEA-1 Better title`);
    return;
  }

  try {
    if (parsed?.field === "description") {
      const taskReference = reference.toLowerCase().startsWith("task ") ? reference.slice(5) : reference;
      const task = await updateTaskDescription(user.id, normalizePublicId(taskReference), title);
      await replyHtml(ctx, `${bold("✅ Task details updated")} ${code(task.publicId)}\n${code("/undo")} restores the previous version.`, { reply_markup: undoKeyboard("↩️ Undo edit") });
      return;
    }

    if (/^\d+$/.test(reference) || reference.toUpperCase().startsWith("TASK-") || reference.toLowerCase().startsWith("task ")) {
      const taskReference = reference.toLowerCase().startsWith("task ") ? reference.slice(5) : reference;
      const task = await renameTaskTitle(user.id, normalizePublicId(taskReference), title);
      await replyHtml(ctx, `${bold("✅ Task renamed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} puts the old title back.`, { reply_markup: undoKeyboard("↩️ Undo rename") });
      return;
    }

    if (reference.toUpperCase().startsWith("NOTE-") || reference.toLowerCase().startsWith("note ")) {
      const noteReference = reference.toLowerCase().startsWith("note ") ? reference.slice(5) : reference;
      const noteTarget = await findNoteReference(user.id, normalizePublicId(noteReference));
      if (parsed?.field === "body") {
        const note = await updateNoteBody(user.id, noteTarget.publicId, title);
        await replyHtml(ctx, `${bold("✅ Note updated")} ${code(note.publicId)}\n${code("/undo")} restores the previous version.`, { reply_markup: undoKeyboard("↩️ Undo edit") });
        return;
      }

      const note = await renameNoteTitle(user.id, noteTarget.publicId, title);
      await replyHtml(ctx, `${bold("✅ Note renamed")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} puts the old title back.`, { reply_markup: undoKeyboard("↩️ Undo rename") });
      return;
    }

    if (reference.toUpperCase().startsWith("IDEA-") || reference.toLowerCase().startsWith("idea ")) {
      const ideaReference = reference.toLowerCase().startsWith("idea ") ? reference.slice(5) : reference;
      const ideaTarget = await findIdeaReference(user.id, normalizePublicId(ideaReference));
      if (parsed?.field === "concept") {
        const idea = await updateIdeaConcept(user.id, ideaTarget.publicId, title);
        await replyHtml(ctx, `${bold("✅ Idea updated")} ${code(idea.publicId)}\n${code("/undo")} restores the previous version.`, { reply_markup: undoKeyboard("↩️ Undo edit") });
        return;
      }

      const idea = await renameIdeaTitle(user.id, ideaTarget.publicId, title);
      await replyHtml(ctx, `${bold("✅ Idea renamed")} ${code(idea.publicId)} ${h(idea.title)}\n${code("/undo")} puts the old title back.`, { reply_markup: undoKeyboard("↩️ Undo rename") });
      return;
    }

    await ctx.reply("I can rename tasks, notes, and ideas. Try /rename 1 New title, /rename note 2 New title, or /rename IDEA-1 New title.");
  } catch (error) {
    await ctx.reply(taskOrNoteLookupError(error));
  }
}

async function handlePin(ctx: Context, shouldPin: boolean) {
  const user = await ensureUser(ctx);
  const command = shouldPin
    ? ctx.message?.text?.startsWith("/star") ? "star" : ctx.message?.text?.startsWith("/important") ? "important" : "pin"
    : ctx.message?.text?.startsWith("/unstar") ? "unstar" : "unpin";
  const reference = commandBody(ctx.message?.text ?? "", command);
  if (!reference) {
    await ctx.reply(`Send it like this: /${command} 1, /${command} NOTE-1, or /${command} IDEA-1`);
    return;
  }

  try {
    const item = await pinItem(user.id, normalizePublicId(reference), shouldPin);
    await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? { reply_markup: undoKeyboard("Undo") } : undefined);
  } catch {
    await ctx.reply("I couldn't find that item. Use /tasks, /notes, /pins, or the public ID like IDEA-1.");
  }
}

async function handlePins(ctx: Context) {
  const user = await ensureUser(ctx);
  await replyHtml(ctx, formatPinnedItems(await listPinnedItems(user.id)));
}

async function handleArchived(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", ctx.message?.text?.startsWith("/archives") ? "archives" : "archived");
  const [kindText, pageText] = body.split(/\s+/).filter(Boolean);
  const kind = parseArchiveKind(kindText ?? "");
  if (!kind) {
    await ctx.reply("Send it like this: /archived notes, /archived ideas, or /archived tasks");
    return;
  }

  const page = Number(pageText ?? "1");
  const archived = await listArchivedItems(user.id, kind, Number.isInteger(page) ? page : 1);
  await replyHtml(ctx, formatArchivedPage(archived, user.settings?.timezone), {
    reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
  });
}

async function handleArchive(ctx: Context) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/remove") ? "remove" : "archive";
  const body = commandBody(ctx.message?.text ?? "", command);
  const bulkRequest = parseBulkActionRequest(`${command} ${body}`);
  if (bulkRequest) {
    await replyBulkActionPreview(ctx, user.id, bulkRequest);
    return;
  }
  const noteMatch = body.match(/^(?:note\s+)?(.+)$/i);
  const reference = noteMatch?.[1]?.trim();
  if (!reference) {
    await ctx.reply(`Send it like this: /${command} note 1, /${command} notes 1 2 3, or /${command} ideas 1 2 3`);
    return;
  }

  try {
    const note = await archiveNote(user.id, normalizePublicId(reference));
    await replyHtml(ctx, `${bold("🗃️ Note archived")} ${code(note.publicId)} ${h(note.title)}\nIt is out of the way, not gone. ${code("/undo")} brings it back.`, {
      reply_markup: undoKeyboard("↩️ Undo archive")
    });
  } catch {
    await ctx.reply("I couldn't find that note. /notes will show the recent ones.");
  }
}

async function handleRestore(ctx: Context) {
  const user = await ensureUser(ctx);
  const reference = commandBody(ctx.message?.text ?? "", "restore");
  if (!reference) {
    await ctx.reply("Send it like this: /restore NOTE-1, /restore IDEA-1, or /restore TASK-1");
    return;
  }

  const message = await restoreArchivedItem(user.id, normalizePublicId(reference));
  await replyHtml(ctx, message ?? "I couldn't find that archived item. Try /archived notes, /archived ideas, or /archived tasks.");
}

async function handleCancel(ctx: Context) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/delete") ? "delete" : "cancel";
  const id = commandBody(ctx.message?.text ?? "", command);
  if (!id) {
    await ctx.reply(`Send it like this: /${command} 1, /${command} 1 2 3, or /delete notes 1 2 3`);
    return;
  }

  const parsedBulk = parseBulkActionRequest(`${command} ${id}`);
  const references = parseBulkReferences(id);
  const bulkRequest = parsedBulk ?? (references && references.length > 1
    ? { action: "delete" as const, itemKind: "task" as const, references }
    : undefined);
  if (bulkRequest) {
    await replyBulkActionPreview(ctx, user.id, bulkRequest);
    return;
  }

  try {
    const task = await cancelTask(user.id, normalizePublicId(id));
  await replyHtml(ctx, `${bold("🗑️ Task canceled")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} brings it back if you still need it.`, { reply_markup: undoKeyboard("↩️ Undo cancel") });
  } catch (error) {
    await ctx.reply(taskLookupError(error));
  }
}

async function handleSettings(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "settings");
  if (!body) {
    await replyControlCardHtml(ctx, await formatSettings(user.id), { reply_markup: settingsModeKeyboard() });
    return;
  }

  const result = await updateSetting(user.id, body.split(/\s+/));
  await ctx.reply(result.message);
}

async function handleSearch(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const query = commandBody(ctx.message?.text ?? "", "search");
  if (!query) {
    await ctx.reply("Send it like this: /search reminder bot ideas or /search notes deployment");
    return;
  }

  const imageSearch = query.match(/^(?:images?|photos?|pictures?|screenshots?)\s+(.+)$/i);
  if (imageSearch?.[1]) {
    const scoped = imageSearch[1].match(/^(caption|captions|text|ocr)\s*[:\-]?\s*(.+)$/i);
    await replyStoredImageSearch(ctx, user.id, scoped?.[2] ?? imageSearch[1], user.settings?.timezone ?? "UTC", 1, undefined, scoped?.[1]?.toLowerCase().startsWith("caption") ? "caption" : scoped ? "text" : "all");
    return;
  }

  const parsed = parseSearchRequest(query);
  if (!parsed.query) {
    await ctx.reply("Add a query after the filter, like /search notes deployment or /search tasks invoice.");
    return;
  }

  const results = await semanticSearch(user.id, parsed.query, ai, parsed.kinds, {
    includeDone: parsed.includeDone,
    doneOnly: parsed.doneOnly
  });
  const pending = await createPendingSearch(user.id, parsed);
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  await replyHtml(ctx, formatSearchResultsPage(results, 1, pageSize, parsed.label), {
    reply_markup: searchPageKeyboard(pending.id, 1, totalPages)
  });
}

async function handleScore(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "score");
  if (!id) {
    await ctx.reply("Send it like this: /score IDEA-1");
    return;
  }

  const result = await scoreIdea(user.id, normalizePublicId(id), ai);
  await replyControlCardHtml(ctx, formatIdeaScore(result.publicId, result.score), {
    reply_markup: ideaBriefKeyboard(result.publicId)
  });
}

async function handleBrief(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "brief");
  if (!id) {
    await ctx.reply("Send it like this: /brief IDEA-1");
    return;
  }

  const result = await createImplementationBrief(user.id, normalizePublicId(id));
  await replyInChunks(ctx, [`Implementation prompt for ${result.publicId}:`, "", result.prompt].join("\n"));
}

async function handleCalendar(ctx: Context, includeIcs: boolean) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/googlecal") ? "googlecal" : "calendar";
  const id = commandBody(ctx.message?.text ?? "", command);
  const action = id.toLowerCase();

  if (command === "calendar" && (!id || action === "status")) {
    await replyHtml(ctx, await formatCalendarStatus(user.id));
    return;
  }

  if (command === "calendar" && action === "connect") {
    if (!calendarConfigured()) {
      await ctx.reply("Google Calendar OAuth is not configured on the server yet. Add the Google OAuth redirect and token encryption settings first.");
      return;
    }
    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createCalendarConnectUrl(user.id, chatId);
    await replyHtml(ctx, [bold("Connect Google Calendar"), "Open this Google OAuth link and approve Calendar event access.", "", h(url)].join("\n"));
    return;
  }

  if (command === "calendar" && action === "disconnect") {
    await replyHtml(ctx, await disconnectCalendar(user.id));
    return;
  }

  if (!id) {
    await ctx.reply(`Send it like this: /${command} TASK-1 or /${command} 1`);
    return;
  }

  await replyWithTaskCalendar(ctx, {
    userId: user.id,
    reference: id,
    timezone: user.settings?.timezone,
    includeIcs
  });
}

async function handleGmail(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "gmail").toLowerCase();

  if (!body || body === "status") {
    await replyHtml(ctx, await formatGmailStatus(user.id));
    return;
  }

  if (body === "connect") {
    if (!gmailConfigured()) {
      await ctx.reply("Gmail is not configured on the server yet. Add Google OAuth env vars first.");
      return;
    }

    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createGmailConnectUrl(user.id, chatId);
    await replyHtml(ctx, [`${bold("Connect Gmail")}`, "Open this Google OAuth link, approve Gmail read-only access, then return here.", "", h(url)].join("\n"));
    return;
  }

  if (body === "scan") {
    const result = await scanGmailNow(user.id, ai);
    await replyHtml(ctx, result.message);
    return;
  }

  if (body === "disconnect") {
    await replyHtml(ctx, await disconnectGmail(user.id));
    return;
  }

  await ctx.reply("Try /gmail, /gmail connect, /gmail scan, or /gmail disconnect.");
}

async function handleStart(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "start");
  if (/^(?:dm|nudges?|private)$/i.test(body)) {
    if (isGroupChat(ctx)) {
      await ctx.reply(`Open Threadwise privately and press Start to enable personal assignment nudges: https://t.me/${ctx.me.username}?start=dm`);
      return;
    }
    const result = await updateSetting(user.id, ["dm", "on"]);
    await ctx.reply(result.message);
    return;
  }
  const timezone = user.settings?.timezone ?? "Asia/Singapore";
  if (!isGroupChat(ctx)) {
    await ctx.reply(formatStartShortcutText(), {
      reply_markup: privateMenuKeyboard()
    });
  }
  await showMainMenu(ctx, timezone, user.id, ctx.from?.id);
}

async function handleMenuCommand(ctx: Context) {
  const user = await ensureUser(ctx);
  if (!ctx.from) return;
  await showMainMenu(ctx, user.settings?.timezone ?? "Asia/Singapore", user.id, ctx.from.id);
}

async function handleGroupCheck(ctx: Context) {
  if (!isGroupChat(ctx)) {
    await ctx.reply("/groupcheck is for Telegram groups. Add or open the bot in a group, then run it there.");
    return;
  }
  const allowlist = allowedTelegramIds();
  const privacyEnabled = telegramGroupPrivacyEnabled(ctx);
  const username = ctx.me.username ? `@${ctx.me.username}` : "the bot";
  await replyHtml(ctx, [
    bold("Threadwise group check"),
    `${bold("Version")} ${code(`v${appVersion()}`)}`,
    `${bold("Bot username")} ${h(ctx.me.username ? `@${ctx.me.username}` : "unavailable")}`,
    `${bold("Group chat ID")} ${code(String(ctx.chat?.id ?? "unknown"))}`,
    `${bold("Your Telegram ID")} ${code(String(ctx.from?.id ?? "unknown"))}`,
    `${bold("Allowlist")} ${!allowlist?.size ? "open" : isTelegramContextAllowed(ctx, allowlist) ? "allowed" : "blocked"}`,
    `${bold("Telegram group privacy")} ${privacyEnabled ? "enabled" : "disabled"}`,
    "",
    privacyEnabled
      ? `Ordinary @mention sentences are not delivered to privacy-enabled bots. In BotFather, run /setprivacy, select ${username}, and choose Disable. If Telegram does not apply it immediately, remove and re-add the bot to this group.`
      : "Direct @mentions can be delivered. Threadwise will still ignore ordinary group conversation unless it mentions or replies to the bot."
  ].join("\n"));
}

async function handleExpense(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "expense");
  if (!body) {
    await ctx.reply("Send it like this: /expense spent $18.40 on lunch at Toast Box today using Visa. You can also send a clear receipt photo with the caption 'save as expense'.");
    return;
  }
  const editMatch = body.match(/^edit\s+(\S+)\s+(.+)$/i);
  if (editMatch?.[1] && editMatch[2]) {
    try {
      const expense = await updateSavedExpense(user.id, normalizePublicId(editMatch[1]), editMatch[2], user.settings?.timezone ?? "UTC");
      await replyHtml(ctx, `${formatExpenseCreated(expense, user.settings?.timezone ?? "UTC")}\nUpdated. Future exports use the correction. If this row was already sent to a linked Excel workbook, edit or remove that old Excel row manually.`);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't update that expense.");
    }
    return;
  }
  try {
    const pending = await createPendingExpenseFromText(user.id, body, user.settings?.timezone ?? "UTC", { sourceType: "manual", defaultCurrency: user.settings?.expenseCurrency });
    await replyHtml(ctx, formatPendingExpense(pending, user.settings?.timezone ?? "UTC"), {
      reply_markup: expenseConfirmationKeyboard(pending.id)
    });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that expense.");
  }
}

async function handleExpenses(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "expenses");
  const filter = parseExpenseFilter(body || "all", user.settings?.timezone ?? "UTC");
  if (!filter) {
    await ctx.reply("Try /expenses, /expenses today, /expenses 2026-07-12, /expenses this month, /expenses June 2026, or /expenses 2026.");
    return;
  }
  const result = await listExpenses(user.id, filter, 1, user.settings?.timezone ?? "UTC");
  await replyHtml(ctx, formatExpensePage(result, user.settings?.timezone ?? "UTC"), {
    reply_markup: expensePageKeyboard(encodeExpenseFilter(filter), result.page, result.totalPages)
  });
}

async function handleExcel(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "excel").trim();
  const lower = body.toLowerCase();
  if (!body || lower === "status") {
    await replyHtml(ctx, await formatExcelStatus(user.id));
    return;
  }
  if (lower === "connect") {
    if (!microsoftExcelConfigured()) {
      await ctx.reply("Excel OAuth is not configured on the server yet. The setup instructions are in README.md.");
      return;
    }
    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createMicrosoftConnectUrl(user.id, chatId);
    await replyHtml(ctx, [bold("Connect Microsoft Excel"), "Open this Microsoft link and approve access to files you can already use.", "", h(url)].join("\n"));
    return;
  }
  if (lower === "create" || lower === "setup" || lower === "set up") {
    try {
      const item = await createExpenseWorkbook(user.id, user.settings?.timezone ?? "UTC");
      await replyHtml(ctx, [bold("✅ Excel workbook ready"), h(item.name ?? "Threadwise Expenses.xlsx"), item.webUrl ? h(item.webUrl) : undefined, "", "New expenses can now use Save + sync Excel."].filter(Boolean).join("\n"));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't create the workbook.");
    }
    return;
  }
  if (lower.startsWith("use ")) {
    try {
      const item = await linkExpenseWorkbook(user.id, body.slice(4).trim());
      await replyHtml(ctx, `${bold("✅ Excel workbook linked")}\n${h(item.name ?? "Workbook")}\n${h(item.webUrl ?? "")}\nNew expense syncs now have a home.`);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't link that workbook.");
    }
    return;
  }
  if (lower === "sync" || lower === "sync expenses") {
    try {
      const count = await syncUnsyncedExpenses(user.id, user.settings?.timezone ?? "UTC");
      await ctx.reply(count ? `Synced ${count} expense${count === 1 ? "" : "s"} to Excel.` : "Everything is already synced to Excel.");
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Excel sync failed.");
    }
    return;
  }
  if (lower === "export" || lower === "download") {
    const workbook = await exportExpensesWorkbook(user.id, user.settings?.timezone ?? "UTC");
    await ctx.replyWithDocument(new InputFile(workbook, "Threadwise Expenses.xlsx"));
    return;
  }
  if (lower === "disconnect") {
    await replyHtml(ctx, await disconnectMicrosoft(user.id));
    return;
  }
  await ctx.reply("Try /excel, /excel connect, /excel create, /excel sync, /excel export, /excel use <OneDrive link>, or /excel disconnect.");
}

async function handleVersion(ctx: Context, ai: AiProvider) {
  await replyHtml(ctx, formatVersionStatus({
    ai: ai.getStatus(),
    gmailConfigured: gmailConfigured(),
    calendarConfigured: calendarConfigured(),
    excelConfigured: microsoftExcelConfigured(),
    reminders: getReminderDiagnostics()
  }));
}

async function replyBulkActionPreview(ctx: Context, userId: string, request: BulkActionRequest) {
  if (!ctx.from?.id) {
    await ctx.reply("I couldn't identify who requested that bulk action.");
    return;
  }
  try {
    const preview = await createBulkActionPreview(userId, String(ctx.from.id), request);
    await replyHtml(ctx, formatBulkActionPreview(preview), {
      reply_markup: bulkActionConfirmationKeyboard(preview.pending.id)
    });
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that bulk action.");
  }
}

async function replyInChunks(ctx: Context, text: string) {
  const maxLength = 3800;
  for (let start = 0; start < text.length; start += maxLength) {
    await ctx.reply(text.slice(start, start + maxLength));
  }
}

function taskLookupError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("No open task numbered")) {
    return error.message;
  }

  return "I couldn't find that task. /tasks will show the current list.";
}

function taskOrNoteLookupError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("No open task numbered")) {
    return error.message;
  }

  return "I couldn't find that task or note. Try /tasks or /notes to check the ID.";
}

function parseReferenceAndTitle(body: string): { reference: string; title: string; field?: "title" | "description" | "body" | "concept" } | undefined {
  const parts = body.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }

  const first = parts[0]?.toLowerCase();
  const second = parts[1];
  if ((first === "task" || first === "note" || first === "idea") && second && /^(\d+|TASK-\d+|NOTE-\d+|IDEA-\d+)$/i.test(second)) {
    const field = editableField(parts[2]);
    return {
      reference: `${first} ${second}`,
      field,
      title: parts.slice(field ? 3 : 2).join(" ").trim()
    };
  }

  const field = editableField(parts[1]);
  return {
    reference: parts[0] ?? "",
    field,
    title: parts.slice(field ? 2 : 1).join(" ").trim()
  };
}

function editableField(value?: string): "title" | "description" | "body" | "concept" | undefined {
  const lower = value?.toLowerCase();
  if (lower === "title") return "title";
  if (lower === "details" || lower === "detail" || lower === "description") return "description";
  if (lower === "body") return "body";
  if (lower === "concept") return "concept";
  return undefined;
}

function parseRescheduleBody(body: string): { reference: string; whenText: string } | undefined {
  const trimmed = body.trim();
  const match = trimmed.match(/^(\S+)\s+(?:to\s+)?(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    reference: match[1],
    whenText: match[2].trim()
  };
}
