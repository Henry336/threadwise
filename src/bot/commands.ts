import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { HELP_TEXT } from "./help";
import { ensureUser } from "../services/users";
import { commandBody, normalizePublicId } from "../utils/text";
import { createIdea, createImplementationBrief, formatIdeaCreated, scoreIdea } from "../services/ideas";
import {
  cancelTask,
  createScheduledReminder,
  createTask,
  completeTask,
  findTaskReference,
  formatTaskCreated,
  listOpenTasks,
  renameTaskTitle,
  snoozeTask
} from "../services/tasks";
import {
  analyzeNoteStyle,
  createNote,
  findNote,
  formatNoteAnalysis,
  formatNoteCreated,
  formatNoteDetail,
  formatRecentNotes,
  listRecentNotes,
  renameNoteTitle,
  searchNotes
} from "../services/notes";
import { createReflection, formatReflection } from "../services/reflections";
import { buildReview } from "../services/review";
import { formatSettings, updateSetting } from "../services/settings";
import { parseSearchRequest, semanticSearch } from "../services/search";
import { formatPinnedItems, formatPinResult, listPinnedItems, pinItem } from "../services/pins";
import { undoLastAction } from "../services/undo";
import { createIcs } from "../services/calendar";
import { formatIdeaScore, formatOpenTasks, formatSearchResults, formatTaskDetail } from "./formatters";
import { bold, code, h, replyHtml } from "../utils/html";
import { taskActionsKeyboard, taskListKeyboard } from "./keyboards";
import { parseDueDate, splitReminderText } from "../utils/dates";

export function registerCommands(bot: Bot, ai: AiProvider): void {
  bot.command(["start", "help"], async (ctx) => replyHtml(ctx, HELP_TEXT));
  bot.command("idea", async (ctx) => handleIdea(ctx, ai));
  bot.command("note", async (ctx) => handleNote(ctx, ai));
  bot.command("notes", async (ctx) => handleNotes(ctx));
  bot.command("note-analysis", async (ctx) => handleNoteAnalysis(ctx, ai));
  bot.command("review", async (ctx) => handleReview(ctx));
  bot.command("add", async (ctx) => handleAdd(ctx, ai));
  bot.command("remind", async (ctx) => handleRemind(ctx, ai));
  bot.command("tasks", async (ctx) => handleTasks(ctx));
  bot.command("task", async (ctx) => handleTaskDetail(ctx));
  bot.command("done", async (ctx) => handleDone(ctx));
  bot.command("snooze", async (ctx) => handleSnooze(ctx));
  bot.command("undo", async (ctx) => handleUndo(ctx));
  bot.command(["rename", "edit"], async (ctx) => handleRename(ctx));
  bot.command(["pin", "star"], async (ctx) => handlePin(ctx, true));
  bot.command(["unpin", "unstar"], async (ctx) => handlePin(ctx, false));
  bot.command("pins", async (ctx) => handlePins(ctx));
  bot.command(["cancel", "delete"], async (ctx) => handleCancel(ctx));
  bot.command(["relationship", "reflect"], async (ctx) => handleRelationship(ctx, ai));
  bot.command("settings", async (ctx) => handleSettings(ctx));
  bot.command("search", async (ctx) => handleSearch(ctx, ai));
  bot.command("score", async (ctx) => handleScore(ctx, ai));
  bot.command("brief", async (ctx) => handleBrief(ctx));
  bot.command("calendar", async (ctx) => handleCalendar(ctx));
}

async function handleIdea(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "idea");
  if (!text) {
    await ctx.reply("Send it like this: /idea build a bot that...");
    return;
  }

  const idea = await createIdea(user.id, text, ai);
  await replyHtml(ctx, formatIdeaCreated(idea));
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
      await replyHtml(ctx, formatNoteDetail(note));
    } catch {
      await ctx.reply("I couldn't find that note. /notes will show the recent ones.");
    }
    return;
  }

  const note = await createNote(user.id, text, ai);
  await replyHtml(ctx, formatNoteCreated(note));
}

async function handleNotes(ctx: Context) {
  const user = await ensureUser(ctx);
  const query = commandBody(ctx.message?.text ?? "", "notes");
  const notes = query ? await searchNotes(user.id, query) : await listRecentNotes(user.id);
  await replyHtml(ctx, formatRecentNotes(notes));
}

async function handleNoteAnalysis(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const analysis = await analyzeNoteStyle(user.id, ai);
  await replyHtml(ctx, formatNoteAnalysis(analysis));
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

async function handleUndo(ctx: Context) {
  const user = await ensureUser(ctx);
  await replyHtml(ctx, await undoLastAction(user.id));
}

async function handleRename(ctx: Context) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/edit") ? "edit" : "rename";
  const body = commandBody(ctx.message?.text ?? "", command);
  const [reference, ...titleParts] = body.split(/\s+/).filter(Boolean);
  const title = titleParts.join(" ").trim();

  if (!reference || !title) {
    await ctx.reply(`Send it like this: /${command} 1 Follow up with Alex or /${command} NOTE-1 Deployment notes`);
    return;
  }

  try {
    if (/^\d+$/.test(reference) || reference.toUpperCase().startsWith("TASK-")) {
      const task = await renameTaskTitle(user.id, normalizePublicId(reference), title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} will put the old title back.`);
      return;
    }

    if (reference.toUpperCase().startsWith("NOTE-")) {
      const note = await renameNoteTitle(user.id, normalizePublicId(reference), title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} will put the old title back.`);
      return;
    }

    await ctx.reply("I can rename tasks and notes for now. Try /rename 1 New title or /rename NOTE-1 New title.");
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

async function handleRelationship(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/reflect") ? "reflect" : "relationship";
  const text = commandBody(ctx.message?.text ?? "", command);
  if (!text) {
    await ctx.reply("Send it like this: /relationship here is what happened...");
    return;
  }

  const reflection = await createReflection(user.id, text, ai);
  await replyHtml(ctx, formatReflection(reflection));
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

  const results = await semanticSearch(user.id, parsed.query, ai, parsed.kinds);
  await replyHtml(ctx, formatSearchResults(results, parsed.label));
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
