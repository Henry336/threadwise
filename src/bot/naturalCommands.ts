import type { Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { formatHelpPage, formatStartText, helpTotalPages, HELP_PAGE_SIZE } from "./help";
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
import { archiveNote, createNote, findAnyNote, formatNoteAnalysis, formatNoteCreated, formatNoteDetail, formatRecentNotes, listRecentNotes, renameNoteTitle, searchNotes, analyzeNoteStyle } from "../services/notes";
import { findNoteReference, updateNoteBody } from "../services/notes";
import { cancelTask, completeTask, createScheduledReminder, createTask, findTaskReference, formatTaskCreated, listOpenTasks, renameTaskTitle, rescheduleTask, snoozeTask, updateTaskDescription } from "../services/tasks";
import { buildReview } from "../services/review";
import { formatSettings, updateSetting } from "../services/settings";
import { createPendingSearch, parseSearchRequest, semanticSearch } from "../services/search";
import { formatPinnedItems, formatPinResult, listPinnedItems, pinItem } from "../services/pins";
import { undoLastAction } from "../services/undo";
import { createIcs } from "../services/calendar";
import { createGmailConnectUrl, disconnectGmail, formatGmailStatus, gmailConfigured, scanGmailNow } from "../services/gmail";
import { formatArchivedPage, listArchivedItems, parseArchiveKind, restoreArchivedItem } from "../services/archives";
import { createNoteMergePreview, formatNoteMergePreview } from "../services/noteMerges";
import { formatIdeaScore, formatOpenTasks, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, helpPageKeyboard, itemActionsKeyboard, itemCreatedKeyboard, itemListKeyboard, noteMergePreviewKeyboard, searchPageKeyboard, taskActionsKeyboard, taskCreatedKeyboard, taskListKeyboard, undoKeyboard } from "./keyboards";
import { bold, code, h, replyHtml } from "../utils/html";
import { normalizePublicId } from "../utils/text";
import { formatDateTimeForUser, parseDueDate, splitReminderText } from "../utils/dates";
import { parseListRequest, parseNaturalReminderBody, parseNaturalSettingChange } from "./naturalCommandParsing";

export async function handleNaturalCommand(ctx: Context, ai: AiProvider, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const user = await ensureUser(ctx);

  if (lower === "help") {
    await replyHtml(ctx, formatHelpPage(1), { reply_markup: helpPageKeyboard(1, helpTotalPages(HELP_PAGE_SIZE)) });
    return true;
  }

  if (lower === "start") {
    await replyHtml(ctx, formatStartText(user.settings?.timezone ?? "Asia/Singapore"));
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

  const listKind = parseListRequest(lower);
  if (listKind === "tasks") {
    const tasks = await listOpenTasks(user.id);
    const keyboard = taskListKeyboard(tasks);
    await replyHtml(ctx, formatOpenTasks(tasks, user.settings?.timezone), keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  }

  if (listKind === "notes") {
    const notes = await listRecentNotes(user.id);
    const keyboard = itemListKeyboard("note", notes);
    await replyHtml(ctx, formatRecentNotes(notes), keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  }

  if (listKind === "ideas") {
    const ideas = await listRecentIdeas(user.id);
    const keyboard = itemListKeyboard("idea", ideas);
    await replyHtml(ctx, formatRecentIdeas(ideas), keyboard ? { reply_markup: keyboard } : undefined);
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

  const settingChange = parseNaturalSettingChange(trimmed);
  if (settingChange) {
    const result = await updateSetting(user.id, settingChange);
    await ctx.reply(result.message);
    return true;
  }

  if (lower === "gmail" || lower === "gmail status") {
    await replyHtml(ctx, await formatGmailStatus(user.id));
    return true;
  }

  if (lower === "gmail connect" || lower === "connect gmail") {
    if (!gmailConfigured()) {
      await ctx.reply("Gmail is not configured on the server yet. Add Google OAuth env vars first.");
      return true;
    }

    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createGmailConnectUrl(user.id, chatId);
    await replyHtml(ctx, [`${bold("Connect Gmail")}`, "Open this Google OAuth link, approve Gmail read-only access, then return here.", "", h(url)].join("\n"));
    return true;
  }

  if (lower === "gmail scan" || lower === "scan gmail" || lower === "scan unread gmail") {
    const result = await scanGmailNow(user.id, ai);
    await replyHtml(ctx, result.message);
    return true;
  }

  if (lower === "gmail disconnect" || lower === "disconnect gmail") {
    await replyHtml(ctx, await disconnectGmail(user.id));
    return true;
  }

  const archivedMatch = lower.match(/^(?:show |view |list )?archived\s+(notes?|ideas?|tasks?)(?:\s+(\d+))?$/);
  if (archivedMatch?.[1]) {
    const kind = parseArchiveKind(archivedMatch[1]);
    if (!kind) return false;
    const page = Number(archivedMatch[2] ?? "1");
    const archived = await listArchivedItems(user.id, kind, Number.isInteger(page) ? page : 1);
    await replyHtml(ctx, formatArchivedPage(archived, user.settings?.timezone), {
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
    return true;
  }

  const noteAnalysisMatch = lower === "note analysis" || lower === "analyze notes" || lower === "analyse notes";
  if (noteAnalysisMatch) {
    await replyHtml(ctx, formatNoteAnalysis(await analyzeNoteStyle(user.id, ai)));
    return true;
  }

  const viewNoteMatch = trimmed.match(/^(?:(?:show|view|open)\s+(?:me\s+)?(?:the\s+)?)?note\s+(\d+|NOTE-\d+)$/i);
  if (viewNoteMatch?.[1]) {
    try {
      const note = await findNoteReference(user.id, normalizePublicId(viewNoteMatch[1]));
      await replyHtml(ctx, formatNoteDetail(note, user.settings?.timezone), { reply_markup: itemActionsKeyboard("note", note) });
    } catch {
      try {
        await replyHtml(ctx, formatNoteDetail(await findAnyNote(user.id, normalizePublicId(viewNoteMatch[1])), user.settings?.timezone));
      } catch {
        await ctx.reply("I couldn't find that note. Show notes will list the recent ones.");
      }
    }
    return true;
  }

  const viewIdeaMatch = trimmed.match(/^(?:idea|show idea)\s+(\S+)$/i);
  if (viewIdeaMatch?.[1] && /^(\d+|IDEA-\d+)$/i.test(viewIdeaMatch[1])) {
    try {
      const idea = await findIdeaReference(user.id, normalizePublicId(viewIdeaMatch[1]));
      await replyHtml(ctx, formatIdeaDetail(idea, user.settings?.timezone), { reply_markup: itemActionsKeyboard("idea", idea) });
    } catch {
      await ctx.reply("I couldn't find that idea. ideas will show the recent list.");
    }
    return true;
  }

  const noteSearchMatch = trimmed.match(/^notes\s+(.+)$/i);
  if (noteSearchMatch?.[1]) {
    const notes = await searchNotes(user.id, noteSearchMatch[1]);
    const keyboard = itemListKeyboard("note", notes);
    await replyHtml(ctx, formatRecentNotes(notes), keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  }

  const ideaListMatch = trimmed.match(/^ideas\s+(\d+|IDEA-\d+)$/i);
  if (ideaListMatch?.[1]) {
    try {
      const idea = await findIdeaReference(user.id, normalizePublicId(ideaListMatch[1]));
      await replyHtml(ctx, formatIdeaDetail(idea, user.settings?.timezone), { reply_markup: itemActionsKeyboard("idea", idea) });
    } catch {
      await ctx.reply("I couldn't find that idea. ideas will show the recent list.");
    }
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
    await replyHtml(ctx, `${bold("Completed task")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if that was too quick.`, { reply_markup: undoKeyboard("Undo complete") });
    return true;
  }

  const snoozeMatch = trimmed.match(/^snooze\s+(\S+)(?:\s+(.+))?$/i);
  if (snoozeMatch?.[1]) {
    const task = await snoozeTask(user.id, normalizePublicId(snoozeMatch[1]), snoozeMatch[2] ?? "1h");
    await replyHtml(ctx, `${bold("Snoozed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} restores the previous reminder time.`, { reply_markup: undoKeyboard("Undo snooze") });
    return true;
  }

  const rescheduleMatch = trimmed.match(/^(?:reschedule|move)\s+(?:task\s+)?(\S+)\s+(?:to\s+)?(.+)$/i);
  if (rescheduleMatch?.[1] && rescheduleMatch[2]) {
    const task = await rescheduleTask(user.id, normalizePublicId(rescheduleMatch[1]), rescheduleMatch[2]);
    await replyHtml(ctx, `${bold("Rescheduled")} ${code(task.publicId)} ${h(task.title)}\n${task.dueAt ? `${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, user.settings?.timezone ?? task.timezone ?? "UTC"))}` : `${bold("Due")} none`}\n${code("/undo")} restores the previous schedule.`, { reply_markup: undoKeyboard("Undo reschedule") });
    return true;
  }

  const cancelMatch = trimmed.match(/^(?:cancel|delete)\s+(\S+)$/i);
  if (cancelMatch?.[1]) {
    const task = await cancelTask(user.id, normalizePublicId(cancelMatch[1]));
    await replyHtml(ctx, `${bold("Canceled task")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if you still need it.`, { reply_markup: undoKeyboard("Undo cancel") });
    return true;
  }

  const pinMatch = trimmed.match(/^(pin|star|important|unpin|unstar)\s+(.+)$/i);
  if (pinMatch?.[1] && pinMatch[2]) {
    const shouldPin = ["pin", "star", "important"].includes(pinMatch[1].toLowerCase());
    const item = await pinItem(user.id, normalizePublicId(pinMatch[2]), shouldPin);
    await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? { reply_markup: undoKeyboard("Undo") } : undefined);
    return true;
  }

  const archiveNoteMatch = trimmed.match(/^(?:archive|remove|delete)\s+note\s+(\S+)$/i);
  if (archiveNoteMatch?.[1]) {
    const note = await archiveNote(user.id, normalizePublicId(archiveNoteMatch[1]));
    await replyHtml(ctx, `${bold("Archived note")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} restores it if that was a mistake.`, {
      reply_markup: undoKeyboard("Undo archive")
    });
    return true;
  }

  const renameMatch = trimmed.match(/^(?:rename|edit)\s+(.+)$/i);
  const renameParsed = renameMatch?.[1] ? parseReferenceAndTitle(renameMatch[1]) : undefined;
  if (renameParsed) {
    if (renameParsed.field === "description") {
      const taskReference = renameParsed.reference.toLowerCase().startsWith("task ") ? renameParsed.reference.slice(5) : renameParsed.reference;
      const task = await updateTaskDescription(user.id, normalizePublicId(taskReference), renameParsed.title);
      await replyHtml(ctx, `${bold("Updated")} ${code(task.publicId)} details\n${code("/undo")} will restore the previous version.`, { reply_markup: undoKeyboard("Undo edit") });
      return true;
    }

    if (renameParsed.reference.toUpperCase().startsWith("NOTE-") || renameParsed.reference.toLowerCase().startsWith("note ")) {
      const noteReference = renameParsed.reference.toLowerCase().startsWith("note ") ? renameParsed.reference.slice(5) : renameParsed.reference;
      const noteTarget = await findNoteReference(user.id, normalizePublicId(noteReference));
      if (renameParsed.field === "body") {
        const note = await updateNoteBody(user.id, noteTarget.publicId, renameParsed.title);
        await replyHtml(ctx, `${bold("Updated")} ${code(note.publicId)} body\n${code("/undo")} will restore the previous version.`, { reply_markup: undoKeyboard("Undo edit") });
        return true;
      }
      const note = await renameNoteTitle(user.id, noteTarget.publicId, renameParsed.title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} will put the old title back.`, { reply_markup: undoKeyboard("Undo rename") });
      return true;
    }

    if (renameParsed.reference.toUpperCase().startsWith("IDEA-") || renameParsed.reference.toLowerCase().startsWith("idea ")) {
      const ideaReference = renameParsed.reference.toLowerCase().startsWith("idea ") ? renameParsed.reference.slice(5) : renameParsed.reference;
      const ideaTarget = await findIdeaReference(user.id, normalizePublicId(ideaReference));
      if (renameParsed.field === "concept") {
        const idea = await updateIdeaConcept(user.id, ideaTarget.publicId, renameParsed.title);
        await replyHtml(ctx, `${bold("Updated")} ${code(idea.publicId)} concept\n${code("/undo")} will restore the previous version.`, { reply_markup: undoKeyboard("Undo edit") });
        return true;
      }
      const idea = await renameIdeaTitle(user.id, ideaTarget.publicId, renameParsed.title);
      await replyHtml(ctx, `${bold("Renamed")} ${code(idea.publicId)} ${h(idea.title)}\n${code("/undo")} will put the old title back.`, { reply_markup: undoKeyboard("Undo rename") });
      return true;
    }

    const taskReference = renameParsed.reference.toLowerCase().startsWith("task ") ? renameParsed.reference.slice(5) : renameParsed.reference;
    const task = await renameTaskTitle(user.id, normalizePublicId(taskReference), renameParsed.title);
    await replyHtml(ctx, `${bold("Renamed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} will put the old title back.`, { reply_markup: undoKeyboard("Undo rename") });
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

  const settingsMatch = trimmed.match(/^settings\s+(.+)$/i);
  if (settingsMatch?.[1]) {
    const result = await updateSetting(user.id, settingsMatch[1].split(/\s+/));
    await ctx.reply(result.message);
    return true;
  }

  const reminderBody = parseNaturalReminderBody(trimmed);
  if (reminderBody) {
    const parsed = splitReminderText(reminderBody);
    const scheduledAt = parseDueDate(parsed?.whenText ?? reminderBody, user.settings?.timezone ?? "UTC");
    if (!parsed || !scheduledAt || scheduledAt.getTime() <= Date.now()) {
      return false;
    }
    const task = await createScheduledReminder(user.id, parsed.taskText, scheduledAt, ai);
    await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
    return true;
  }

  const ideaMatch = trimmed.match(/^idea\s+(.+)$/i);
  if (ideaMatch?.[1]) {
    const idea = await createIdea(user.id, ideaMatch[1], ai);
    await replyHtml(ctx, formatIdeaCreated(idea), { reply_markup: itemCreatedKeyboard("idea", idea) });
    return true;
  }

  const addMatch = trimmed.match(/^(?:add|todo|task)\s+(.+)$/i);
  if (addMatch?.[1]) {
    const task = await createTask(user.id, addMatch[1], ai);
    await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
    return true;
  }

  const noteMatch = trimmed.match(/^(?:note|save note)\s+(.+)$/i);
  if (noteMatch?.[1]) {
    const note = await createNote(user.id, noteMatch[1], ai);
    await replyHtml(ctx, formatNoteCreated(note), { reply_markup: itemCreatedKeyboard("note", note) });
    return true;
  }

  return false;
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

async function replyInChunks(ctx: Context, text: string) {
  const maxLength = 3800;
  for (let start = 0; start < text.length; start += maxLength) {
    await ctx.reply(text.slice(start, start + maxLength));
  }
}
