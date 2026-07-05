import type { Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { HELP_TEXT } from "./help";
import { createIdea, createImplementationBrief, formatIdeaCreated, scoreIdea } from "../services/ideas";
import { createNote, findAnyNote, findNote, formatNoteAnalysis, formatNoteCreated, formatNoteDetail, formatRecentNotes, listRecentNotes, renameNoteTitle, searchNotes, analyzeNoteStyle } from "../services/notes";
import { cancelTask, completeTask, createScheduledReminder, createTask, findTaskReference, formatTaskCreated, listOpenTasks, renameTaskTitle, snoozeTask } from "../services/tasks";
import { createReflection, formatReflection } from "../services/reflections";
import { buildReview } from "../services/review";
import { formatSettings, updateSetting } from "../services/settings";
import { parseSearchRequest, semanticSearch } from "../services/search";
import { formatPinnedItems, formatPinResult, listPinnedItems, pinItem } from "../services/pins";
import { undoLastAction } from "../services/undo";
import { createIcs } from "../services/calendar";
import { formatArchivedPage, listArchivedItems, parseArchiveKind, restoreArchivedItem } from "../services/archives";
import { createNoteMergePreview, formatNoteMergePreview } from "../services/noteMerges";
import { formatIdeaScore, formatOpenTasks, formatSearchResults, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, noteMergePreviewKeyboard, taskActionsKeyboard, taskListKeyboard } from "./keyboards";
import { bold, code, h, replyHtml } from "../utils/html";
import { normalizePublicId } from "../utils/text";
import { parseDueDate, splitReminderText } from "../utils/dates";

export async function handleNaturalCommand(ctx: Context, ai: AiProvider, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const user = await ensureUser(ctx);

  if (lower === "help" || lower === "start") {
    await replyHtml(ctx, HELP_TEXT);
    return true;
  }

  if (lower === "undo") {
    await replyHtml(ctx, await undoLastAction(user.id));
    return true;
  }

  if (lower === "review" || lower === "show review") {
    await replyHtml(ctx, await buildReview(user.id, user.settings?.timezone ?? "UTC"));
    return true;
  }

  if (lower === "tasks" || lower === "show tasks" || lower === "list tasks") {
    const tasks = await listOpenTasks(user.id);
    const keyboard = taskListKeyboard(tasks);
    await replyHtml(ctx, formatOpenTasks(tasks, user.settings?.timezone), keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  }

  if (lower === "notes" || lower === "show notes" || lower === "list notes") {
    await replyHtml(ctx, formatRecentNotes(await listRecentNotes(user.id)));
    return true;
  }

  if (lower === "pins" || lower === "show pins" || lower === "pinned") {
    await replyHtml(ctx, formatPinnedItems(await listPinnedItems(user.id)));
    return true;
  }

  if (lower === "settings" || lower === "show settings") {
    await replyHtml(ctx, await formatSettings(user.id));
    return true;
  }

  const archivedMatch = lower.match(/^(?:show |view |list )?archived\s+(notes?|ideas?|tasks?|reflections?)(?:\s+(\d+))?$/);
  if (archivedMatch?.[1]) {
    const kind = parseArchiveKind(archivedMatch[1]);
    if (!kind) return false;
    const page = Number(archivedMatch[2] ?? "1");
    const archived = await listArchivedItems(user.id, kind, Number.isInteger(page) ? page : 1);
    await replyHtml(ctx, formatArchivedPage(archived), {
      reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
    });
    return true;
  }

  const mergeMatch = trimmed.match(/^merge\s+notes\s+(.+)$/i);
  if (mergeMatch?.[1]) {
    try {
      const preview = await createNoteMergePreview(user.id, mergeMatch[1].split(/\s+/).map(normalizePublicId), ai);
      await replyHtml(ctx, formatNoteMergePreview(preview), { reply_markup: noteMergePreviewKeyboard(preview.pendingId) });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that merge. Try /notes to check the note numbers.");
    }
    return true;
  }

  const restoreMatch = trimmed.match(/^restore\s+(\S+)$/i);
  if (restoreMatch?.[1]) {
    const message = await restoreArchivedItem(user.id, normalizePublicId(restoreMatch[1]));
    await replyHtml(ctx, message ?? "I couldn't find that archived item. Try archived notes, archived ideas, or archived tasks.");
    return true;
  }

  const searchMatch = trimmed.match(/^search\s+(.+)$/i);
  if (searchMatch?.[1]) {
    const parsed = parseSearchRequest(searchMatch[1]);
    if (!parsed.query) {
      await ctx.reply("Add a query after the filter, like search notes deployment or search tasks invoice.");
      return true;
    }
    await replyHtml(ctx, formatSearchResults(await semanticSearch(user.id, parsed.query, ai, parsed.kinds), parsed.label));
    return true;
  }

  const noteAnalysisMatch = lower === "note analysis" || lower === "analyze notes" || lower === "analyse notes";
  if (noteAnalysisMatch) {
    await replyHtml(ctx, formatNoteAnalysis(await analyzeNoteStyle(user.id, ai)));
    return true;
  }

  const viewNoteMatch = trimmed.match(/^note\s+(NOTE-\d+)$/i);
  if (viewNoteMatch?.[1]) {
    try {
      await replyHtml(ctx, formatNoteDetail(await findNote(user.id, normalizePublicId(viewNoteMatch[1]))));
    } catch {
      await replyHtml(ctx, formatNoteDetail(await findAnyNote(user.id, normalizePublicId(viewNoteMatch[1]))));
    }
    return true;
  }

  const noteSearchMatch = trimmed.match(/^notes\s+(.+)$/i);
  if (noteSearchMatch?.[1]) {
    await replyHtml(ctx, formatRecentNotes(await searchNotes(user.id, noteSearchMatch[1])));
    return true;
  }

  const taskDetailMatch = trimmed.match(/^(?:task|show task)\s+(\S+)$/i);
  if (taskDetailMatch?.[1]) {
    try {
      const task = await findTaskReference(user.id, normalizePublicId(taskDetailMatch[1]));
      await replyHtml(ctx, formatTaskDetail(task, user.settings?.timezone, user.settings
        ? {
            reminderIntervalMinutes: user.settings.reminderIntervalMinutes,
            maxRemindersPerDay: user.settings.maxRemindersPerDay,
            quietHoursStart: user.settings.quietHoursStart,
            quietHoursEnd: user.settings.quietHoursEnd
          }
        : undefined), { reply_markup: taskActionsKeyboard(task) });
    } catch {
      await ctx.reply("I couldn't find that task. tasks will show the current list.");
    }
    return true;
  }

  const doneMatch = trimmed.match(/^(?:done|complete)\s+(\S+)$/i);
  if (doneMatch?.[1]) {
    const task = await completeTask(user.id, normalizePublicId(doneMatch[1]));
    await replyHtml(ctx, `${bold("Done")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if that was too quick.`);
    return true;
  }

  const snoozeMatch = trimmed.match(/^snooze\s+(\S+)(?:\s+(.+))?$/i);
  if (snoozeMatch?.[1]) {
    const task = await snoozeTask(user.id, normalizePublicId(snoozeMatch[1]), snoozeMatch[2] ?? "1h");
    await replyHtml(ctx, `${bold("Snoozed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} restores the previous reminder time.`);
    return true;
  }

  const cancelMatch = trimmed.match(/^(?:cancel|delete)\s+(\S+)$/i);
  if (cancelMatch?.[1]) {
    const task = await cancelTask(user.id, normalizePublicId(cancelMatch[1]));
    await replyHtml(ctx, `${bold("Canceled")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if you still need it.`);
    return true;
  }

  const pinMatch = trimmed.match(/^(pin|star|unpin|unstar)\s+(\S+)$/i);
  if (pinMatch?.[1] && pinMatch[2]) {
    const shouldPin = pinMatch[1].toLowerCase() === "pin" || pinMatch[1].toLowerCase() === "star";
    const item = await pinItem(user.id, normalizePublicId(pinMatch[2]), shouldPin);
    await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`);
    return true;
  }

  const renameMatch = trimmed.match(/^(?:rename|edit)\s+(\S+)\s+(.+)$/i);
  if (renameMatch?.[1] && renameMatch[2]) {
    if (renameMatch[1].toUpperCase().startsWith("NOTE-")) {
      const note = await renameNoteTitle(user.id, normalizePublicId(renameMatch[1]), renameMatch[2]);
      await replyHtml(ctx, `${bold("Renamed")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} will put the old title back.`);
      return true;
    }

    const task = await renameTaskTitle(user.id, normalizePublicId(renameMatch[1]), renameMatch[2]);
    await replyHtml(ctx, `${bold("Renamed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} will put the old title back.`);
    return true;
  }

  const scoreMatch = trimmed.match(/^score\s+(IDEA-\d+)$/i);
  if (scoreMatch?.[1]) {
    const result = await scoreIdea(user.id, normalizePublicId(scoreMatch[1]), ai);
    await replyHtml(ctx, formatIdeaScore(result.publicId, result.score));
    return true;
  }

  const briefMatch = trimmed.match(/^brief\s+(IDEA-\d+)$/i);
  if (briefMatch?.[1]) {
    const result = await createImplementationBrief(user.id, normalizePublicId(briefMatch[1]));
    await replyInChunks(ctx, [`Implementation prompt for ${result.publicId}:`, "", result.prompt].join("\n"));
    return true;
  }

  const calendarMatch = trimmed.match(/^calendar\s+(\S+)$/i);
  if (calendarMatch?.[1]) {
    const task = await findTaskReference(user.id, normalizePublicId(calendarMatch[1]));
    if (!task.dueAt) {
      await ctx.reply(`${task.publicId} does not have a due date yet, so there is nothing calendar-shaped to export.`);
      return true;
    }
    const ics = createIcs({
      title: task.title,
      details: task.description ?? task.sourceText,
      dueAt: task.dueAt,
      timezone: task.timezone ?? user.settings?.timezone ?? "UTC"
    });
    await replyHtml(ctx, [`${bold("Calendar options")} ${code(task.publicId)}`, task.calendarUrl ? `${bold("Google Calendar")} ${h(task.calendarUrl)}` : undefined].filter(Boolean).join("\n"));
    await ctx.replyWithDocument(new InputFile(Buffer.from(ics), `${task.publicId}.ics`));
    return true;
  }

  const settingsMatch = trimmed.match(/^(?:settings|set)\s+(.+)$/i);
  if (settingsMatch?.[1]) {
    const result = await updateSetting(user.id, settingsMatch[1].split(/\s+/));
    await ctx.reply(result.message);
    return true;
  }

  const remindMatch = trimmed.match(/^remind\s+(.+)$/i);
  if (remindMatch?.[1]) {
    const parsed = splitReminderText(remindMatch[1]);
    const scheduledAt = parseDueDate(parsed?.whenText ?? remindMatch[1], user.settings?.timezone ?? "UTC");
    if (!parsed || !scheduledAt || scheduledAt.getTime() <= Date.now()) {
      return false;
    }
    const task = await createScheduledReminder(user.id, parsed.taskText, scheduledAt, ai);
    await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskActionsKeyboard(task) });
    return true;
  }

  const ideaMatch = trimmed.match(/^idea\s+(.+)$/i);
  if (ideaMatch?.[1]) {
    await replyHtml(ctx, formatIdeaCreated(await createIdea(user.id, ideaMatch[1], ai)));
    return true;
  }

  const addMatch = trimmed.match(/^(?:add|todo|task)\s+(.+)$/i);
  if (addMatch?.[1]) {
    const task = await createTask(user.id, addMatch[1], ai);
    await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskActionsKeyboard(task) });
    return true;
  }

  const noteMatch = trimmed.match(/^(?:note|save note)\s+(.+)$/i);
  if (noteMatch?.[1]) {
    await replyHtml(ctx, formatNoteCreated(await createNote(user.id, noteMatch[1], ai)));
    return true;
  }

  const reflectionMatch = trimmed.match(/^(?:relationship|reflect)\s+(.+)$/i);
  if (reflectionMatch?.[1]) {
    await replyHtml(ctx, formatReflection(await createReflection(user.id, reflectionMatch[1], ai)));
    return true;
  }

  return false;
}

async function replyInChunks(ctx: Context, text: string) {
  const maxLength = 3800;
  for (let start = 0; start < text.length; start += maxLength) {
    await ctx.reply(text.slice(start, start + maxLength));
  }
}
