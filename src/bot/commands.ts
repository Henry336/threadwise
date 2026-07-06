import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { formatHelpPage, formatStartText, helpTotalPages, HELP_PAGE_SIZE } from "./help";
import { ensureUser } from "../services/users";
import { commandBody, normalizePublicId } from "../utils/text";
import {
  createIdea,
  createImplementationBrief,
  findIdeaReference,
  formatIdeaCreated,
  formatIdeaDetail,
  formatRecentIdeas,
  listRecentIdeas,
  renameIdeaTitle,
  scoreIdea,
  updateIdeaConcept
} from "../services/ideas";
import {
  cancelTask,
  createScheduledReminder,
  createTask,
  completeTask,
  findTaskReference,
  formatTaskCreated,
  listOpenTasks,
  renameTaskTitle,
  rescheduleTask,
  snoozeTask,
  updateTaskDescription
} from "../services/tasks";
import {
  analyzeNoteStyle,
  createNote,
  findAnyNote,
  findNote,
  findNoteReference,
  formatNoteAnalysis,
  formatNoteCreated,
  formatNoteDetail,
  formatRecentNotes,
  listRecentNotes,
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
import { createIcs } from "../services/calendar";
import { createGmailConnectUrl, disconnectGmail, formatGmailStatus, gmailConfigured, scanGmailNow } from "../services/gmail";
import { formatIdeaScore, formatOpenTasks, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { bold, code, h, replyHtml } from "../utils/html";
import { archivedPageKeyboard, helpPageKeyboard, itemActionsKeyboard, itemListKeyboard, noteMergePreviewKeyboard, searchPageKeyboard, taskActionsKeyboard, taskListKeyboard } from "./keyboards";
import { parseDueDate, splitReminderText } from "../utils/dates";

export function registerCommands(bot: Bot, ai: AiProvider): void {
  bot.command("start", async (ctx) => {
    const user = await ensureUser(ctx);
    await replyHtml(ctx, formatStartText(user.settings?.timezone ?? "Asia/Singapore"));
  });
  bot.command("help", async (ctx) => replyHtml(ctx, formatHelpPage(1), { reply_markup: helpPageKeyboard(1, helpTotalPages(HELP_PAGE_SIZE)) }));
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
  bot.command("undo", async (ctx) => handleUndo(ctx));
  bot.command(["rename", "edit"], async (ctx) => handleRename(ctx));
  bot.command(["pin", "star"], async (ctx) => handlePin(ctx, true));
  bot.command(["unpin", "unstar"], async (ctx) => handlePin(ctx, false));
  bot.command("pins", async (ctx) => handlePins(ctx));
  bot.command(["archived", "archives"], async (ctx) => handleArchived(ctx));
  bot.command("restore", async (ctx) => handleRestore(ctx));
  bot.command(["cancel", "delete"], async (ctx) => handleCancel(ctx));
  bot.command("settings", async (ctx) => handleSettings(ctx));
  bot.command("search", async (ctx) => handleSearch(ctx, ai));
  bot.command("score", async (ctx) => handleScore(ctx, ai));
  bot.command("brief", async (ctx) => handleBrief(ctx));
  bot.command("calendar", async (ctx) => handleCalendar(ctx));
  bot.command("gmail", async (ctx) => handleGmail(ctx, ai));
}

async function handleIdea(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "idea");
  if (!text) {
    await ctx.reply("Send it like this: /idea build a bot that...");
    return;
  }

  const idea = await createIdea(user.id, text, ai);
  await replyHtml(ctx, formatIdeaCreated(idea), { reply_markup: itemActionsKeyboard("idea", idea) });
}

async function handleNote(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "note");
  if (!text) {
    await ctx.reply("Send it like this: /note important thing I want to remember... or /note NOTE-1");
    return;
  }

  if (/^NOTE-\d+$/i.test(text)) {
    try {
      const note = await findNote(user.id, normalizePublicId(text));
      await replyHtml(ctx, formatNoteDetail(note), { reply_markup: itemActionsKeyboard("note", note) });
    } catch {
      try {
        const archivedNote = await findAnyNote(user.id, normalizePublicId(text));
        await replyHtml(ctx, `${formatNoteDetail(archivedNote)}\n\n${code(archivedNote.archivedAt ? "/restore " + archivedNote.publicId : "/notes")}`);
      } catch {
        await ctx.reply("I couldn't find that note. /notes will show the recent ones.");
      }
    }
    return;
  }

  const note = await createNote(user.id, text, ai);
  await replyHtml(ctx, formatNoteCreated(note), { reply_markup: itemActionsKeyboard("note", note) });
}

async function handleNotes(ctx: Context) {
  const user = await ensureUser(ctx);
  const query = commandBody(ctx.message?.text ?? "", "notes");
  const notes = query ? await searchNotes(user.id, query) : await listRecentNotes(user.id);
  const keyboard = itemListKeyboard("note", notes);
  await replyHtml(ctx, formatRecentNotes(notes), keyboard ? { reply_markup: keyboard } : undefined);
}

async function handleIdeas(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "ideas");
  const ideas = await listRecentIdeas(user.id);
  if (!body) {
    const keyboard = itemListKeyboard("idea", ideas);
    await replyHtml(ctx, formatRecentIdeas(ideas), keyboard ? { reply_markup: keyboard } : undefined);
    return;
  }

  try {
    const idea = await findIdeaReference(user.id, normalizePublicId(body));
    await replyHtml(ctx, formatIdeaDetail(idea), { reply_markup: itemActionsKeyboard("idea", idea) });
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

  const task = await createTask(user.id, text, ai);
  await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskActionsKeyboard(task) });
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

  const task = await createScheduledReminder(user.id, parsed.taskText, scheduledAt, ai);
  await replyHtml(ctx, formatTaskCreated(task, settings.timezone), { reply_markup: taskActionsKeyboard(task) });
}

async function handleTasks(ctx: Context) {
  const user = await ensureUser(ctx);
  const tasks = await listOpenTasks(user.id);
  const keyboard = taskListKeyboard(tasks);
  await replyHtml(ctx, formatOpenTasks(tasks, user.settings?.timezone), keyboard ? { reply_markup: keyboard } : undefined);
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
    await replyHtml(
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
    await ctx.reply("Send it like this: /done 1 or /done TASK-1");
    return;
  }

  try {
    const task = await completeTask(user.id, normalizePublicId(id));
    await replyHtml(ctx, `${bold("Done")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if that was too quick.`);
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
    await replyHtml(ctx, `${bold("Snoozed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} restores the previous reminder time.`);
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
    await replyHtml(ctx, `${bold("Rescheduled")} ${code(task.publicId)} ${h(task.title)}\n${task.dueAt ? `${bold("Due")} ${h(task.dueAt.toLocaleString())}` : `${bold("Due")} none`}\n${code("/undo")} restores the previous schedule.`);
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : taskLookupError(error));
  }
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
      await replyHtml(ctx, `${bold("Updated")} ${code(task.publicId)} details\n${code("/undo")} will restore the previous version.`);
      return;
    }

    if (/^\d+$/.test(reference) || reference.toUpperCase().startsWith("TASK-") || reference.toLowerCase().startsWith("task ")) {
      const taskReference = reference.toLowerCase().startsWith("task ") ? reference.slice(5) : reference;
      const task = await renameTaskTitle(user.id, normalizePublicId(taskReference), title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} will put the old title back.`);
      return;
    }

    if (reference.toUpperCase().startsWith("NOTE-") || reference.toLowerCase().startsWith("note ")) {
      const noteReference = reference.toLowerCase().startsWith("note ") ? reference.slice(5) : reference;
      const noteTarget = await findNoteReference(user.id, normalizePublicId(noteReference));
      if (parsed?.field === "body") {
        const note = await updateNoteBody(user.id, noteTarget.publicId, title);
        await replyHtml(ctx, `${bold("Updated")} ${code(note.publicId)} body\n${code("/undo")} will restore the previous version.`);
        return;
      }

      const note = await renameNoteTitle(user.id, noteTarget.publicId, title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} will put the old title back.`);
      return;
    }

    if (reference.toUpperCase().startsWith("IDEA-") || reference.toLowerCase().startsWith("idea ")) {
      const ideaReference = reference.toLowerCase().startsWith("idea ") ? reference.slice(5) : reference;
      const ideaTarget = await findIdeaReference(user.id, normalizePublicId(ideaReference));
      if (parsed?.field === "concept") {
        const idea = await updateIdeaConcept(user.id, ideaTarget.publicId, title);
        await replyHtml(ctx, `${bold("Updated")} ${code(idea.publicId)} concept\n${code("/undo")} will restore the previous version.`);
        return;
      }

      const idea = await renameIdeaTitle(user.id, ideaTarget.publicId, title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(idea.publicId)} ${h(idea.title)}\n${code("/undo")} will put the old title back.`);
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
    ? ctx.message?.text?.startsWith("/star") ? "star" : "pin"
    : ctx.message?.text?.startsWith("/unstar") ? "unstar" : "unpin";
  const reference = commandBody(ctx.message?.text ?? "", command);
  if (!reference) {
    await ctx.reply(`Send it like this: /${command} 1, /${command} NOTE-1, or /${command} IDEA-1`);
    return;
  }

  try {
    const item = await pinItem(user.id, normalizePublicId(reference), shouldPin);
    await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`);
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
  await replyHtml(ctx, formatArchivedPage(archived), {
    reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
  });
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
    await ctx.reply(`Send it like this: /${command} 1 or /${command} TASK-1`);
    return;
  }

  try {
    const task = await cancelTask(user.id, normalizePublicId(id));
    await replyHtml(ctx, `${bold("Canceled")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if you still need it.`);
  } catch (error) {
    await ctx.reply(taskLookupError(error));
  }
}

async function handleSettings(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "settings");
  if (!body) {
    await replyHtml(ctx, await formatSettings(user.id));
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
  const pageSize = 10;
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
  await replyHtml(ctx, formatIdeaScore(result.publicId, result.score));
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

async function handleCalendar(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "calendar");
  if (!id) {
    await ctx.reply("Send it like this: /calendar TASK-1 or /calendar 1");
    return;
  }

  let task;
  try {
    task = await findTaskReference(user.id, normalizePublicId(id));
  } catch (error) {
    await ctx.reply(taskLookupError(error));
    return;
  }

  if (!task.dueAt) {
    await ctx.reply(`${task.publicId} does not have a due date yet, so there is nothing calendar-shaped to export.`);
    return;
  }

  const ics = createIcs({
    title: task.title,
    details: task.description ?? task.sourceText,
    dueAt: task.dueAt,
    timezone: task.timezone ?? user.settings?.timezone ?? "UTC"
  });

  await replyHtml(
    ctx,
    [`${bold("Calendar options")} ${code(task.publicId)}`, task.calendarUrl ? `${bold("Google Calendar")} ${h(task.calendarUrl)}` : undefined]
      .filter(Boolean)
      .join("\n")
  );
  await ctx.replyWithDocument(new InputFile(Buffer.from(ics), `${task.publicId}.ics`));
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
