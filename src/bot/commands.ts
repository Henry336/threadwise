import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { HELP_TEXT } from "./help";
import { ensureUser } from "../services/users";
import { commandBody, normalizePublicId } from "../utils/text";
import { createIdea, createImplementationBrief, formatIdeaCreated, scoreIdea } from "../services/ideas";
import { createScheduledReminder, createTask, completeTask, findTask, formatTaskCreated, listOpenTasks, snoozeTask } from "../services/tasks";
import { analyzeNoteStyle, createNote, formatNoteAnalysis, formatNoteCreated, formatRecentNotes, listRecentNotes } from "../services/notes";
import { createReflection, formatReflection } from "../services/reflections";
import { formatSettings, updateSetting } from "../services/settings";
import { semanticSearch } from "../services/search";
import { createIcs } from "../services/calendar";
import { formatIdeaScore, formatOpenTasks, formatSearchResults } from "./formatters";
import { taskActionsKeyboard } from "./keyboards";
import { parseDueDate, splitReminderText } from "../utils/dates";

export function registerCommands(bot: Bot, ai: AiProvider): void {
  bot.command(["start", "help"], async (ctx) => ctx.reply(HELP_TEXT));
  bot.command("idea", async (ctx) => handleIdea(ctx, ai));
  bot.command("note", async (ctx) => handleNote(ctx, ai));
  bot.command("notes", async (ctx) => handleNotes(ctx));
  bot.command("note-analysis", async (ctx) => handleNoteAnalysis(ctx, ai));
  bot.command("add", async (ctx) => handleAdd(ctx, ai));
  bot.command("remind", async (ctx) => handleRemind(ctx, ai));
  bot.command("tasks", async (ctx) => handleTasks(ctx));
  bot.command("done", async (ctx) => handleDone(ctx));
  bot.command("snooze", async (ctx) => handleSnooze(ctx));
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
    await ctx.reply("Usage: /idea build a bot that...");
    return;
  }

  const idea = await createIdea(user.id, text, ai);
  await ctx.reply(formatIdeaCreated(idea));
}

async function handleNote(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "note");
  if (!text) {
    await ctx.reply("Usage: /note important thing I want to remember...");
    return;
  }

  const note = await createNote(user.id, text, ai);
  await ctx.reply(formatNoteCreated(note));
}

async function handleNotes(ctx: Context) {
  const user = await ensureUser(ctx);
  const notes = await listRecentNotes(user.id);
  await ctx.reply(formatRecentNotes(notes));
}

async function handleNoteAnalysis(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const analysis = await analyzeNoteStyle(user.id, ai);
  await ctx.reply(formatNoteAnalysis(analysis));
}

async function handleAdd(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const text = commandBody(ctx.message?.text ?? "", "add");
  if (!text) {
    await ctx.reply("Usage: /add pay invoice tomorrow at 9am");
    return;
  }

  const task = await createTask(user.id, text, ai);
  await ctx.reply(formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskActionsKeyboard(task.id) });
}

async function handleRemind(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "remind");
  if (!body) {
    await ctx.reply("Usage: /remind tomorrow at 9am | submit the form");
    return;
  }

  const parsed = splitReminderText(body);
  const settings = user.settings;
  if (!settings) {
    await ctx.reply("Your reminder settings are missing. Try /start once, then /remind again.");
    return;
  }

  const scheduledAt = parseDueDate(parsed?.whenText ?? body, settings.timezone);
  if (!parsed || !scheduledAt) {
    await ctx.reply(
      [
        "I couldn't find a reminder time.",
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
    await ctx.reply("That reminder time is in the past. Pick a future time.");
    return;
  }

  const task = await createScheduledReminder(user.id, parsed.taskText, scheduledAt, ai);
  await ctx.reply(formatTaskCreated(task, settings.timezone), { reply_markup: taskActionsKeyboard(task.id) });
}

async function handleTasks(ctx: Context) {
  const user = await ensureUser(ctx);
  const tasks = await listOpenTasks(user.id);
  await ctx.reply(formatOpenTasks(tasks, user.settings?.timezone));
}

async function handleDone(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "done");
  if (!id) {
    await ctx.reply("Usage: /done TASK-1");
    return;
  }

  const task = await completeTask(user.id, normalizePublicId(id));
  await ctx.reply(`Completed ${task.publicId}: ${task.title}`);
}

async function handleSnooze(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "snooze");
  const [id, ...durationParts] = body.split(/\s+/).filter(Boolean);
  if (!id) {
    await ctx.reply("Usage: /snooze TASK-1 1h");
    return;
  }

  const task = await snoozeTask(user.id, normalizePublicId(id), durationParts.join(" "));
  await ctx.reply(`Snoozed ${task.publicId}: ${task.title}`);
}

async function handleRelationship(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const command = ctx.message?.text?.startsWith("/reflect") ? "reflect" : "relationship";
  const text = commandBody(ctx.message?.text ?? "", command);
  if (!text) {
    await ctx.reply("Usage: /relationship here is what happened...");
    return;
  }

  const reflection = await createReflection(user.id, text, ai);
  await ctx.reply(formatReflection(reflection));
}

async function handleSettings(ctx: Context) {
  const user = await ensureUser(ctx);
  const body = commandBody(ctx.message?.text ?? "", "settings");
  if (!body) {
    await ctx.reply(await formatSettings(user.id));
    return;
  }

  const result = await updateSetting(user.id, body.split(/\s+/));
  await ctx.reply(result.message);
}

async function handleSearch(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const query = commandBody(ctx.message?.text ?? "", "search");
  if (!query) {
    await ctx.reply("Usage: /search reminder bot ideas");
    return;
  }

  const results = await semanticSearch(user.id, query, ai);
  await ctx.reply(formatSearchResults(results));
}

async function handleScore(ctx: Context, ai: AiProvider) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "score");
  if (!id) {
    await ctx.reply("Usage: /score IDEA-1");
    return;
  }

  const result = await scoreIdea(user.id, normalizePublicId(id), ai);
  await ctx.reply(formatIdeaScore(result.publicId, result.score));
}

async function handleBrief(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "brief");
  if (!id) {
    await ctx.reply("Usage: /brief IDEA-1");
    return;
  }

  const result = await createImplementationBrief(user.id, normalizePublicId(id));
  await replyInChunks(ctx, [`Implementation prompt for ${result.publicId}:`, "", result.prompt].join("\n"));
}

async function handleCalendar(ctx: Context) {
  const user = await ensureUser(ctx);
  const id = commandBody(ctx.message?.text ?? "", "calendar");
  if (!id) {
    await ctx.reply("Usage: /calendar TASK-1");
    return;
  }

  const task = await findTask(user.id, normalizePublicId(id));
  if (!task.dueAt) {
    await ctx.reply(`${task.publicId} does not have a due date yet.`);
    return;
  }

  const ics = createIcs({
    title: task.title,
    details: task.description ?? task.sourceText,
    dueAt: task.dueAt,
    timezone: task.timezone ?? user.settings?.timezone ?? "UTC"
  });

  await ctx.reply([`Calendar options for ${task.publicId}`, task.calendarUrl ? `Google Calendar: ${task.calendarUrl}` : undefined].filter(Boolean).join("\n"));
  await ctx.replyWithDocument(new InputFile(Buffer.from(ics), `${task.publicId}.ics`));
}

async function replyInChunks(ctx: Context, text: string) {
  const maxLength = 3800;
  for (let start = 0; start < text.length; start += maxLength) {
    await ctx.reply(text.slice(start, start + maxLength));
  }
}
