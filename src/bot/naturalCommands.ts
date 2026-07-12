import type { Context } from "grammy";
import { InputFile } from "grammy";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { formatCommandReference, formatHelpGuide, formatHelpTopic, formatStartText } from "./help";
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
import { archiveNote, createNote, findAnyNote, formatNoteAnalysis, formatNoteCreated, formatNoteDetail, formatRecentNotes, renameNoteTitle, searchNotes, analyzeNoteStyle } from "../services/notes";
import { findNoteReference, updateNoteBody } from "../services/notes";
import { assignTask, cancelTask, completeTask, createScheduledReminder, createTask, findTaskReference, formatAssignee, formatTaskAlreadyCompleted, formatTaskCompleted, formatTaskCreated, renameTaskTitle, rescheduleTask, snoozeTask, unassignTask, updateTaskDescription } from "../services/tasks";
import { buildReview } from "../services/review";
import { formatSettings, updateSetting } from "../services/settings";
import { createPendingSearch, parseSearchRequest, semanticSearch } from "../services/search";
import { formatPinnedItems, formatPinResult, listPinnedItems, pinItem } from "../services/pins";
import { undoLastAction } from "../services/undo";
import { createGmailConnectUrl, disconnectGmail, formatGmailStatus, gmailConfigured, scanGmailNow } from "../services/gmail";
import { getReminderDiagnostics } from "../services/reminders";
import { formatVersionStatus } from "../services/version";
import { calendarConfigured, createCalendarConnectUrl, disconnectCalendar, formatCalendarStatus } from "../services/googleCalendar";
import { formatArchivedPage, listArchivedItems, parseArchiveKind, restoreArchivedItem } from "../services/archives";
import { createNoteMergePreview, formatNoteMergePreview } from "../services/noteMerges";
import { formatIdeaScore, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, itemActionsKeyboard, itemCreatedKeyboard, itemListKeyboard, noteMergePreviewKeyboard, searchPageKeyboard, taskActionsKeyboard, taskCreatedKeyboard, undoKeyboard } from "./keyboards";
import { bold, code, h, replyHtml } from "../utils/html";
import { normalizePublicId } from "../utils/text";
import { formatDateTimeForUser, parseDueDate, splitReminderText } from "../utils/dates";
import { parseListRequest, parseNaturalHelpRequest, parseNaturalIdeaBody, parseNaturalNoteBody, parseNaturalReminderBody, parseNaturalSettingChange, parseNaturalTaskBody } from "./naturalCommandParsing";
import { replyWithTaskCalendar } from "./calendarReplies";
import { taskCreationOptionsFromContext } from "./taskMentions";
import { createPendingExpenseFromText, encodeExpenseFilter, formatExpenseCreated, formatExpensePage, formatPendingExpense, listExpenses, parseExpenseFilter, updateSavedExpense } from "../services/expenses";
import { createExpenseWorkbook, createMicrosoftConnectUrl, disconnectMicrosoft, exportExpensesWorkbook, formatExcelStatus, linkExpenseWorkbook, microsoftExcelConfigured, syncUnsyncedExpenses } from "../services/excel";
import { expenseConfirmationKeyboard, expensePageKeyboard, restoreCompletedTaskKeyboard } from "./keyboards";
import { bulkActionConfirmationKeyboard } from "./keyboards";
import { createBulkActionPreview, formatBulkActionPreview, parseBulkActionRequest } from "../services/bulkActions";
import { isGroupChat } from "./groupRouting";
import { replyActiveList } from "./activeLists";

export async function handleNaturalCommand(ctx: Context, ai: AiProvider, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const user = await ensureUser(ctx);

  const bulkRequest = parseBulkActionRequest(trimmed);
  if (bulkRequest) {
    if (!ctx.from?.id) {
      await ctx.reply("I couldn't identify who requested that bulk action.");
      return true;
    }
    try {
      const preview = await createBulkActionPreview(user.id, String(ctx.from.id), bulkRequest);
      await replyHtml(ctx, formatBulkActionPreview(preview), {
        reply_markup: bulkActionConfirmationKeyboard(preview.pending.id)
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that bulk action.");
    }
    return true;
  }

  if (lower === "help") {
    await replyHtml(ctx, formatHelpGuide());
    return true;
  }

  const helpTopic = parseNaturalHelpRequest(trimmed);
  if (helpTopic) {
    await replyHtml(ctx, formatHelpTopic(helpTopic));
    return true;
  }

  if (lower === "commands" || lower === "slash commands" || lower === "show commands") {
    await replyHtml(ctx, formatCommandReference());
    return true;
  }

  if (/^(?:start|get started|show (?:me )?(?:the )?(?:setup|onboarding)|take me through (?:the )?setup)$/.test(lower)) {
    await replyHtml(ctx, formatStartText(user.settings?.timezone ?? "Asia/Singapore"));
    return true;
  }

  if (/^(?:undo|undo that|take that back|reverse (?:the )?(?:last )?change)$/.test(lower)) {
    await replyHtml(ctx, await undoLastAction(user.id));
    return true;
  }

  if (/^(?:review|show (?:me )?(?:my )?review|give me (?:a )?review|what needs (?:my )?attention)$/.test(lower)) {
    await replyHtml(ctx, await buildReview(user.id, user.settings?.timezone ?? "UTC"));
    return true;
  }

  const listKind = parseListRequest(lower);
  if (listKind === "tasks") {
    await replyActiveList(ctx, user, "tasks");
    return true;
  }

  if (listKind === "notes") {
    await replyActiveList(ctx, user, "notes");
    return true;
  }

  if (listKind === "ideas") {
    await replyActiveList(ctx, user, "ideas");
    return true;
  }

  if (/^(?:pins|pinned|show (?:me )?(?:my )?(?:pins|pinned items|important items))$/.test(lower)) {
    await replyHtml(ctx, formatPinnedItems(await listPinnedItems(user.id)));
    return true;
  }

  if (/^(?:settings|preferences|show (?:me )?(?:my )?(?:settings|preferences)|what are my settings)$/.test(lower)) {
    await replyHtml(ctx, await formatSettings(user.id));
    return true;
  }

  const settingChange = parseNaturalSettingChange(trimmed);
  if (settingChange) {
    const result = await updateSetting(user.id, settingChange);
    await ctx.reply(result.message);
    return true;
  }

  const expenseListQuery = naturalExpenseListQuery(trimmed);
  if (expenseListQuery !== undefined) {
    const filter = parseExpenseFilter(expenseListQuery || "all", user.settings?.timezone ?? "UTC");
    if (!filter) {
      await ctx.reply("I can show all expenses, today, yesterday, a date, a month, or a year. Try: show expenses this month.");
      return true;
    }
    const result = await listExpenses(user.id, filter, 1, user.settings?.timezone ?? "UTC");
    await replyHtml(ctx, formatExpensePage(result, user.settings?.timezone ?? "UTC"), {
      reply_markup: expensePageKeyboard(encodeExpenseFilter(filter), result.page, result.totalPages)
    });
    return true;
  }

  const directExpenseEdit = trimmed.match(/^(?:change|update|edit|correct)\s+(?:expense\s+)?(EXP-\d+)\s+(.+)$/i);
  const currencyExpenseEdit = trimmed.match(/^(?:change|update|set)\s+(?:the\s+)?currency\s+(?:of|for)\s+(EXP-\d+)\s+(?:to|as)\s+(.+)$/i);
  const expenseEditMatch = directExpenseEdit ?? currencyExpenseEdit;
  if (expenseEditMatch?.[1] && expenseEditMatch[2]) {
    try {
      const editText = currencyExpenseEdit ? `currency ${expenseEditMatch[2]}` : expenseEditMatch[2];
      const expense = await updateSavedExpense(user.id, expenseEditMatch[1], editText, user.settings?.timezone ?? "UTC");
      await replyHtml(ctx, `${formatExpenseCreated(expense, user.settings?.timezone ?? "UTC")}\nUpdated. Future exports use the correction. If this row was already sent to a linked Excel workbook, edit or remove that old Excel row manually.`);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't update that expense.");
    }
    return true;
  }

  const expenseText = naturalExpenseText(trimmed);
  if (expenseText) {
    try {
      const pending = await createPendingExpenseFromText(user.id, expenseText, user.settings?.timezone ?? "UTC", { sourceType: "manual", defaultCurrency: user.settings?.expenseCurrency });
      await replyHtml(ctx, formatPendingExpense(pending, user.settings?.timezone ?? "UTC"), {
        reply_markup: expenseConfirmationKeyboard(pending.id)
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that expense.");
    }
    return true;
  }

  if (/^(?:excel|excel status|show (?:me )?(?:my )?excel status|is excel connected)$/.test(lower)) {
    await replyHtml(ctx, await formatExcelStatus(user.id));
    return true;
  }

  if (/^(?:connect|link|set up) (?:my )?(?:microsoft )?excel(?: account)?$/.test(lower)) {
    if (!microsoftExcelConfigured()) {
      await ctx.reply("Excel OAuth is not configured on the server yet.");
      return true;
    }
    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createMicrosoftConnectUrl(user.id, chatId);
    await replyHtml(ctx, [bold("Connect Microsoft Excel"), "Open this Microsoft link and approve file access.", "", h(url)].join("\n"));
    return true;
  }

  if (/^(?:create|make|set up) (?:my )?(?:threadwise )?(?:expense )?(?:excel )?(?:workbook|spreadsheet)$/.test(lower)) {
    try {
      const item = await createExpenseWorkbook(user.id, user.settings?.timezone ?? "UTC");
      await replyHtml(ctx, [bold("Excel workbook ready"), h(item.name ?? "Threadwise Expenses.xlsx"), item.webUrl ? h(item.webUrl) : undefined].filter(Boolean).join("\n"));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't create the workbook.");
    }
    return true;
  }

  const excelLinkMatch = trimmed.match(/^(?:use|link|connect) (?:this )?(?:excel )?(?:workbook|spreadsheet)?\s*(https?:\/\/\S+)$/i);
  if (excelLinkMatch?.[1]) {
    try {
      const item = await linkExpenseWorkbook(user.id, excelLinkMatch[1]);
      await replyHtml(ctx, `${bold("Excel workbook linked")}\n${h(item.name ?? "Workbook")}\n${h(item.webUrl ?? "")}`);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't link that workbook.");
    }
    return true;
  }

  if (/^(?:sync|send|copy|upload) (?:my )?(?:unsynced )?expenses (?:to|into) excel$/.test(lower)) {
    try {
      const count = await syncUnsyncedExpenses(user.id, user.settings?.timezone ?? "UTC");
      await ctx.reply(count ? `Synced ${count} expense${count === 1 ? "" : "s"} to Excel.` : "Everything is already synced to Excel.");
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Excel sync failed.");
    }
    return true;
  }

  if (/^(?:export|download|give me) (?:all )?(?:my )?expenses (?:as|to|in) (?:an )?excel(?: workbook| file)?$/.test(lower)) {
    const workbook = await exportExpensesWorkbook(user.id, user.settings?.timezone ?? "UTC");
    await ctx.replyWithDocument(new InputFile(workbook, "Threadwise Expenses.xlsx"));
    return true;
  }

  if (/^(?:disconnect|unlink) (?:my )?(?:microsoft )?excel$/.test(lower)) {
    await replyHtml(ctx, await disconnectMicrosoft(user.id));
    return true;
  }

  if (/^(?:gmail|gmail status|show (?:me )?(?:my )?gmail status|is gmail connected)$/.test(lower)) {
    await replyHtml(ctx, await formatGmailStatus(user.id));
    return true;
  }

  if (/^(?:gmail connect|connect (?:my )?gmail|set up gmail|link (?:my )?gmail)$/.test(lower)) {
    if (!gmailConfigured()) {
      await ctx.reply("Gmail is not configured on the server yet. Add Google OAuth env vars first.");
      return true;
    }

    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createGmailConnectUrl(user.id, chatId);
    await replyHtml(ctx, [`${bold("Connect Gmail")}`, "Open this Google OAuth link, approve Gmail read-only access, then return here.", "", h(url)].join("\n"));
    return true;
  }

  if (/^(?:gmail scan|scan (?:my )?(?:unread )?gmail|check (?:my )?(?:unread )?(?:gmail|email)|summari[sz]e (?:my )?unread (?:gmail|email))$/.test(lower)) {
    const result = await scanGmailNow(user.id, ai);
    await replyHtml(ctx, result.message);
    return true;
  }

  if (/^(?:gmail disconnect|disconnect (?:my )?gmail|unlink (?:my )?gmail)$/.test(lower)) {
    await replyHtml(ctx, await disconnectGmail(user.id));
    return true;
  }

  const archivedMatch = lower.match(/^(?:(?:show|view|list|browse)(?:\s+me)?(?:\s+my)?\s+)?archived\s+(notes?|ideas?|tasks?)(?:\s+(?:page\s+)?(\d+))?$/);
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

  const mergeMatch = trimmed.match(/^(?:merge|combine|join)\s+(?:my\s+)?notes\s+(.+)$/i);
  if (mergeMatch?.[1]) {
    try {
      const preview = await createNoteMergePreview(user.id, mergeMatch[1].split(/\s+/).map(normalizePublicId), ai);
      await replyHtml(ctx, formatNoteMergePreview(preview), { reply_markup: noteMergePreviewKeyboard(preview.pendingId) });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "I couldn't prepare that merge. Try /notes to check the note numbers.");
    }
    return true;
  }

  const restoreMatch = trimmed.match(/^(?:restore|recover|bring back)\s+(?:(?:archived|my)\s+)?(?:(?:task|note|idea)\s+)?(\S+)$/i);
  if (restoreMatch?.[1]) {
    const message = await restoreArchivedItem(user.id, normalizePublicId(restoreMatch[1]));
    await replyHtml(ctx, message ?? "I couldn't find that archived item. Try archived notes, archived ideas, or archived tasks.");
    return true;
  }

  const searchMatch = trimmed.match(/^(?:search(?:\s+for)?|look\s+for|find\s+(?:anything\s+)?(?:about\s+)?)\s*(.+)$/i);
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

  const noteAnalysisMatch = /^(?:note analysis|analy[sz]e (?:my )?notes|how (?:am i|do i) (?:take|write|keep) notes)$/.test(lower);
  if (noteAnalysisMatch) {
    await replyHtml(ctx, formatNoteAnalysis(await analyzeNoteStyle(user.id, ai)));
    return true;
  }

  const viewNoteMatch = trimmed.match(/^(?:(?:show|view|open|read)\s+(?:me\s+)?(?:the\s+)?)?note\s+(\d+|NOTE-\d+)$/i);
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

  const viewIdeaMatch = trimmed.match(/^(?:idea|(?:show|view|open)\s+(?:me\s+)?(?:the\s+)?idea)\s+(\S+)$/i);
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

  const taskDetailMatch = trimmed.match(/^(?:task|(?:show|view|open)\s+(?:me\s+)?(?:the\s+)?task)\s+(\S+)$/i);
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

  const doneMatch = trimmed.match(/^(?:done|complete|finish)\s+(?:task\s+)?(\S+)$/i)
    ?? trimmed.match(/^mark\s+(?:task\s+)?(\S+)\s+(?:as\s+)?(?:done|complete|finished)$/i)
    ?? trimmed.match(/^(?:task\s+)?(\S+)\s+is\s+(?:done|complete|finished)$/i);
  if (doneMatch?.[1]) {
    const completion = await completeTask(user.id, normalizePublicId(doneMatch[1]));
    if (completion.alreadyCompleted) {
      await replyHtml(ctx, formatTaskAlreadyCompleted(completion.task), { reply_markup: restoreCompletedTaskKeyboard(completion.task.id) });
      return true;
    }
    await replyHtml(ctx, `${formatTaskCompleted(completion.task, user.settings?.timezone)}\n${code("/undo")} if that was too quick.`, { reply_markup: undoKeyboard("Undo complete") });
    return true;
  }

  const snoozeMatch = trimmed.match(/^(?:snooze|delay)\s+(?:task\s+)?(\S+)(?:\s+(?:for|by|until)?\s*(.+))?$/i);
  if (snoozeMatch?.[1]) {
    const task = await snoozeTask(user.id, normalizePublicId(snoozeMatch[1]), snoozeMatch[2] ?? "1h");
    await replyHtml(ctx, `${bold("Snoozed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} restores the previous reminder time.`, { reply_markup: undoKeyboard("Undo snooze") });
    return true;
  }

  const rescheduleMatch = trimmed.match(/^(?:reschedule|move|postpone|push)\s+(?:task\s+)?(\S+)\s+(?:to|until|for|by)?\s*(.+)$/i);
  if (rescheduleMatch?.[1] && rescheduleMatch[2]) {
    const task = await rescheduleTask(user.id, normalizePublicId(rescheduleMatch[1]), rescheduleMatch[2]);
    await replyHtml(ctx, `${bold("Rescheduled")} ${code(task.publicId)} ${h(task.title)}\n${task.dueAt ? `${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, user.settings?.timezone ?? task.timezone ?? "UTC"))}` : `${bold("Due")} none`}\n${code("/undo")} restores the previous schedule.`, { reply_markup: undoKeyboard("Undo reschedule") });
    return true;
  }

  const assignMatch = trimmed.match(/^(?:assign|give)\s+(?:task\s+)?(\S+)\s+(?:to\s+)?(.+)$/i);
  if (assignMatch?.[1] && assignMatch[2]) {
    const task = await assignTask(user.id, normalizePublicId(assignMatch[1]), assignMatch[2], taskCreationOptionsFromContext(ctx, assignMatch[2]));
    const dmSetup = isGroupChat(ctx) && ctx.me.username ? `\nPrivate nudges are opt-in: https://t.me/${ctx.me.username}?start=dm` : "";
    await replyHtml(ctx, `${bold("Assigned")} ${code(task.publicId)} to ${h(formatAssignee(task))}${dmSetup}`);
    return true;
  }

  const removeOneAssignee = trimmed.match(/^(?:unassign|remove)\s+(.+?)\s+from\s+(?:task\s+)?(\S+)$/i);
  const unassignMatch = trimmed.match(/^(?:unassign|remove (?:the )?assignees? (?:from|on))\s+(?:task\s+)?(\S+)$/i);
  if (removeOneAssignee?.[1] && removeOneAssignee[2]) {
    const task = await unassignTask(user.id, normalizePublicId(removeOneAssignee[2]), removeOneAssignee[1], taskCreationOptionsFromContext(ctx, removeOneAssignee[1]));
    await replyHtml(ctx, `${bold("Updated assignees")} ${code(task.publicId)} ${h(formatAssignee(task))}`);
    return true;
  }
  if (unassignMatch?.[1]) {
    const task = await unassignTask(user.id, normalizePublicId(unassignMatch[1]));
    await replyHtml(ctx, `${bold("Updated assignees")} ${code(task.publicId)} ${h(formatAssignee(task))}`);
    return true;
  }

  const cancelMatch = trimmed.match(/^(?:cancel|delete|drop)\s+(?:task\s+)?(\S+)$/i);
  if (cancelMatch?.[1]) {
    const task = await cancelTask(user.id, normalizePublicId(cancelMatch[1]));
    await replyHtml(ctx, `${bold("Canceled task")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} if you still need it.`, { reply_markup: undoKeyboard("Undo cancel") });
    return true;
  }

  const removeImportantMatch = trimmed.match(/^(?:remove|clear)\s+(?:the\s+)?important(?:\s+mark)?\s+from\s+(?:task\s+)?(.+)$/i)
    ?? trimmed.match(/^mark\s+(?:task\s+)?(.+)\s+as\s+not\s+important$/i);
  const markImportantMatch = trimmed.match(/^mark\s+(?:task\s+)?(.+)\s+as\s+important$/i);
  const pinMatch = trimmed.match(/^(pin|star|important|unpin|unstar)\s+(?:task\s+|note\s+|idea\s+)?(.+)$/i);
  if (removeImportantMatch?.[1]) {
    const item = await pinItem(user.id, normalizePublicId(removeImportantMatch[1]), false);
    await replyHtml(ctx, `${formatPinResult(item, false)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? { reply_markup: undoKeyboard("Undo") } : undefined);
    return true;
  }
  if (markImportantMatch?.[1] || (pinMatch?.[1] && pinMatch[2])) {
    const shouldPin = Boolean(markImportantMatch) || ["pin", "star", "important"].includes(pinMatch?.[1]?.toLowerCase() ?? "");
    const reference = markImportantMatch?.[1] ?? pinMatch?.[2] ?? "";
    const item = await pinItem(user.id, normalizePublicId(reference), shouldPin);
    await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? { reply_markup: undoKeyboard("Undo") } : undefined);
    return true;
  }

  const archiveNoteMatch = trimmed.match(/^(?:archive|remove|delete|hide)\s+(?:my\s+)?note\s+(\S+)$/i)
    ?? trimmed.match(/^move\s+(?:my\s+)?note\s+(\S+)\s+to\s+(?:the\s+)?archive$/i);
  if (archiveNoteMatch?.[1]) {
    const note = await archiveNote(user.id, normalizePublicId(archiveNoteMatch[1]));
    await replyHtml(ctx, `${bold("Archived note")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} restores it if that was a mistake.`, {
      reply_markup: undoKeyboard("Undo archive")
    });
    return true;
  }

  const naturalRenameMatch = trimmed.match(/^change\s+(?:(title|details?|description|body|concept)\s+of\s+)?(?:(task|note|idea)\s+)?(\d+|TASK-\d+|NOTE-\d+|IDEA-\d+)\s+to\s+(.+)$/i);
  const renameMatch = trimmed.match(/^(?:rename|edit)\s+(.+)$/i);
  const naturalRenameBody = naturalRenameMatch
    ? [naturalRenameMatch[2], naturalRenameMatch[3], naturalRenameMatch[1], naturalRenameMatch[4]].filter(Boolean).join(" ")
    : undefined;
  const renameParsed = naturalRenameBody
    ? parseReferenceAndTitle(naturalRenameBody)
    : renameMatch?.[1]
      ? parseReferenceAndTitle(renameMatch[1])
      : undefined;
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

  const scoreMatch = trimmed.match(/^(?:score|rate|evaluate)\s+(?:idea\s+)?(\d+|IDEA-\d+)$/i);
  if (scoreMatch?.[1]) {
    const result = await scoreIdea(user.id, normalizePublicId(scoreMatch[1]), ai);
    await replyHtml(ctx, formatIdeaScore(result.publicId, result.score));
    return true;
  }

  const briefMatch = trimmed.match(/^(?:brief|build (?:an\s+)?(?:implementation\s+)?brief|create (?:an\s+)?implementation (?:brief|prompt) for)\s+(?:idea\s+)?(\d+|IDEA-\d+)$/i);
  if (briefMatch?.[1]) {
    const result = await createImplementationBrief(user.id, normalizePublicId(briefMatch[1]));
    await replyInChunks(ctx, [`Implementation prompt for ${result.publicId}:`, "", result.prompt].join("\n"));
    return true;
  }

  if (/^(?:calendar|google calendar|calendar status|google calendar status|is (?:my )?google calendar connected|show (?:me )?(?:my )?calendar(?: status)?)$/.test(lower)) {
    await replyHtml(ctx, await formatCalendarStatus(user.id));
    return true;
  }

  if (/^(?:connect|link|set up) (?:my )?(?:google )?calendar$/.test(lower)) {
    if (!calendarConfigured()) {
      await ctx.reply("Google Calendar OAuth is not configured on the server yet.");
      return true;
    }
    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createCalendarConnectUrl(user.id, chatId);
    await replyHtml(ctx, [bold("Connect Google Calendar"), "Open this Google OAuth link and approve Calendar event access.", "", h(url)].join("\n"));
    return true;
  }

  if (/^(?:disconnect|unlink) (?:my )?(?:google )?calendar$/.test(lower)) {
    await replyHtml(ctx, await disconnectCalendar(user.id));
    return true;
  }

  const calendarLinkMatch = trimmed.match(/^(?:(?:send|give|get)(?:\s+me)?(?:\s+the)?\s+)?google\s+calendar\s+link\s+(?:for\s+)?(?:task\s+)?(\S+)$/i);
  if (calendarLinkMatch?.[1]) {
    await replyWithTaskCalendar(ctx, {
      userId: user.id,
      reference: calendarLinkMatch[1],
      timezone: user.settings?.timezone,
      includeIcs: false
    });
    return true;
  }

  const calendarMatch = trimmed.match(/^(?:calendar|googlecal)\s+(?:for\s+)?(?:task\s+)?(\S+)$/i)
    ?? trimmed.match(/^(?:add|put)\s+(?:task\s+)?(\S+)\s+(?:to|on)\s+(?:my\s+)?calendar$/i);
  if (calendarMatch?.[1]) {
    await replyWithTaskCalendar(ctx, {
      userId: user.id,
      reference: calendarMatch[1],
      timezone: user.settings?.timezone,
      includeIcs: !/^googlecal/i.test(trimmed)
    });
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
      await ctx.reply("I understood that as a reminder, but I couldn't find a future time. Try adding something like: by 9pm, tomorrow morning, Friday at 3, or in 20 minutes.");
      return true;
    }
    const task = await createScheduledReminder(user.id, parsed.taskText, scheduledAt, ai, taskCreationOptionsFromContext(ctx, parsed.taskText));
    await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
    return true;
  }

  if (/^(?:version|status|bot status|system status|what version (?:is this|are you running)|are reminders working)$/.test(lower)) {
    await replyHtml(ctx, formatVersionStatus({
      ai: ai.getStatus(),
      gmailConfigured: gmailConfigured(),
      calendarConfigured: calendarConfigured(),
      excelConfigured: microsoftExcelConfigured(),
      reminders: getReminderDiagnostics()
    }));
    return true;
  }

  const ideaBody = parseNaturalIdeaBody(trimmed);
  if (ideaBody) {
    const idea = await createIdea(user.id, ideaBody, ai);
    await replyHtml(ctx, formatIdeaCreated(idea), { reply_markup: itemCreatedKeyboard("idea", idea) });
    return true;
  }

  const taskBody = parseNaturalTaskBody(trimmed);
  if (taskBody) {
    const task = await createTask(user.id, taskBody, ai, taskCreationOptionsFromContext(ctx, taskBody));
    await replyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task) });
    return true;
  }

  const noteBody = parseNaturalNoteBody(trimmed);
  if (noteBody) {
    const note = await createNote(user.id, noteBody, ai);
    await replyHtml(ctx, formatNoteCreated(note), { reply_markup: itemCreatedKeyboard("note", note) });
    return true;
  }

  return false;
}

function naturalExpenseText(text: string): string | undefined {
  const trimmed = text.trim();
  if (/^(?:i\s+)?(?:spent|paid)\s+.+/i.test(trimmed)) return trimmed;
  const explicit = trimmed.match(/^(?:please\s+)?(?:log|record|add|save|track)\s+(?:this\s+)?(?:as\s+)?(?:an?\s+)?expense(?:\s+(?:of|for))?\s+(.+)$/i)
    ?? trimmed.match(/^expense\s*[:,-]?\s+(.+)$/i);
  if (explicit?.[1]) return `expense ${explicit[1]}`;
  const bought = trimmed.match(/^(?:i\s+)?bought\s+(.+?)\s+for\s+(.+\d.+|\d.+)$/i);
  if (bought?.[1] && bought[2]) return `spent ${bought[2]} on ${bought[1]}`;
  return undefined;
}

function naturalExpenseListQuery(text: string): string | undefined {
  const normalized = text.trim().replace(/[?.!]+$/g, "");
  if (/^(?:expenses|my expenses|show expenses|show my expenses|list expenses|list my expenses)$/i.test(normalized)) return "all";
  const match = normalized.match(/^(?:(?:show|list|view|give)(?:\s+me)?(?:\s+all)?(?:\s+my)?\s+expenses|(?:what|how much)\s+did\s+i\s+spend)(?:\s+(?:for|from|on|in))?\s*(.*)$/i);
  return match ? (match[1]?.trim() || "all") : undefined;
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
