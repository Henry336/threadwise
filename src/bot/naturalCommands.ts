/**
 * The first deterministic layer for plain-text messages: an ordered list of rules for requests that
 * name their operation ("add task ...", "show note 3", "done 2", "undo", "set my timezone ...").
 * `naturalLanguage.ts` calls `handleNaturalCommand` before the classifier; a match runs the same
 * services as the slash commands. Action prose like "I need to ..." is deliberately not a rule, so
 * it reaches the review card instead of being saved as a task.
 */

import type { Context } from "grammy";
import { saveTaskFromTelegram } from "./taskSaves";
import type { AiProvider } from "../ai/types";
import type { ThreadwiseUser } from "../services/users";
import { formatCommandReference, formatGroupCommandReference, formatGroupHelpGuide, formatGroupHelpTopic, formatGroupPrivacyText, formatHelpGuide, formatHelpTopic, formatPrivacyText } from "./help";
import {
  createIdea,
  createImplementationBrief,
  findIdeaReference,
  formatIdeaSavedAcknowledgement,
  formatIdeaDetail,
  renameIdeaTitle,
  scoreIdea,
  updateIdeaConcept
} from "../services/ideas";
import { archiveNote, createNote, findAnyNote, formatNoteAnalysis, formatNoteSavedAcknowledgement, formatRecentNotes, renameNoteTitle, searchNotes, analyzeNoteStyle } from "../services/notes";
import { findNoteReference, updateNoteBody } from "../services/notes";
import { findTaskReference, listOpenTasks, renameTaskTitle, rescheduleTask, updateTaskDescription } from "../services/tasks";
import { collaborationActorFromContext } from "../services/groupCollaboration";
import { claimGroupTask } from "../services/groupTaskPolicy";
import { assertGroupTaskActionForContext, groupTaskKeyboardAccess, taskCommandActorFromContext } from "./groupTaskAccess";
import { executeTaskCommand, type TaskCommandInput } from "../services/taskCommands";
import { replyTaskCommandResult } from "./taskCommandReplies";
import { buildReview } from "../services/review";
import { formatSettings, updateSetting } from "../services/settings";
import { createPendingSearch, parseSearchRequest, semanticSearch } from "../services/search";
import { formatPinnedItems, formatPinResult, listPinnedItems, pinItem } from "../services/pins";
import { undoLastActionForContext } from "../services/undo";
import { getReminderDiagnostics } from "../services/reminders";
import { formatVersionStatus } from "../services/version";
import { calendarConfigured, calendarConnectionStatus, createCalendarConnectUrl, disconnectCalendar, formatCalendarStatus, removeTaskFromGoogleCalendar, syncEligibleTasksToGoogleCalendar, syncTaskToGoogleCalendar } from "../services/googleCalendar";
import { formatArchivedPage, listArchivedItems, parseArchiveKind, restoreArchivedItem } from "../services/archives";
import { createNoteMergePreview, formatNoteMergePreview } from "../services/noteMerges";
import { formatIdeaScore, formatOpenTasks, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, calendarSettingsKeyboard, calendarTaskKeyboard, dashboardLinkKeyboard, groupHelpTopicsKeyboard, groupSettingsModeKeyboard, groupTaskActionsKeyboard, helpTopicsKeyboard, ideaBriefKeyboard, itemActionsKeyboard, itemListKeyboard, noteMergePreviewKeyboard, searchPageKeyboard, settingsModeKeyboard, storedImageDeleteKeyboard, taskActionsKeyboard, taskListKeyboard, undoKeyboard } from "./keyboards";
import { bold, code, h, replyHtml, replyInChunks } from "../utils/html";
import { normalizePublicId } from "../utils/text";
import { formatDateTimeForUser, parseDueDate, splitReminderText } from "../utils/dates";
import { normalizeNaturalCommandText, parseListRequest, parseNaturalHelpRequest, parseNaturalIdeaBody, parseNaturalNoteBody, parseNaturalReminderBody, parseNaturalSettingChange, parseNaturalTaskAssignment, parseNaturalTaskBody } from "./naturalCommandParsing";
import { calendarTaskConnectCard, replyWithTaskCalendar } from "./calendarReplies";
import { taskCreationOptionsFromContext } from "./taskMentions";
import { microsoftExcelConfigured } from "../services/excel";
import { bulkActionConfirmationKeyboard } from "./keyboards";
import { createBulkActionPreview, formatBulkActionPreview, parseBulkActionRequest } from "../services/bulkActions";
import { isGroupChat } from "./groupRouting";
import { replyActiveList } from "./activeLists";
import { formatStoredImageDeletePrompt, replyStoredImage, replyStoredImageList, replyStoredImageSearch } from "./storedImageReplies";
import { findStoredImageReference, updateStoredImageCaption } from "../services/storedImages";
import { showDashboardLink, showMainMenu } from "./menu";
import { replyControlCardHtml } from "./controlCards";
import { groupWorkspaceForContext, isGroupManager } from "../services/groupWorkspaces";
import { isNotFoundError, userFacingError } from "./errorResponses";
import { replyQuietAcknowledgementHtml } from "./quietAcknowledgements";
import { prisma } from "../db/prisma";
import { buildArchivedNoteCard, buildItemCard } from "./itemCards";

/** What every natural-command rule sees: the update, the resolved user, and the normalized text. */
type NaturalInput = { ctx: Context; ai: AiProvider; user: ThreadwiseUser; trimmed: string; lower: string };

/**
 * One natural-language command. `match` returns a truthy value (the parsed parts `run` needs)
 * when the text is this command; `run` handles it and returns whether the message was consumed.
 * `match` must stay pure: rules are tried in order and only the first match runs.
 */
type NaturalRule = { name: string; match: (input: NaturalInput) => unknown; run: (input: NaturalInput, match: never) => Promise<boolean> };

/** Builds a rule whose `run` is type-checked against what its `match` returns. */
function rule<M>(
  name: string,
  match: (input: NaturalInput) => M | undefined | null | false | "",
  run: (input: NaturalInput, match: M) => Promise<boolean>,
): NaturalRule {
  return { name, match, run };
}

// Bulk phrasing goes first: "cancel 4,5" or "complete 1,2" is one word after the verb, so
// the single-task rules below would otherwise take "4,5" as one task reference.
const bulkRules: NaturalRule[] = [
  rule("bulk action", ({ trimmed }) => parseBulkActionRequest(trimmed), async ({ ctx, user }, bulkRequest) => {
    if (!ctx.from?.id) {
      await ctx.reply("I couldn't identify who requested that bulk action.");
      return true;
    }
    try {
      if (isGroupChat(ctx) && !(await isGroupManager(ctx))) {
        await ctx.reply("Bulk task changes are reserved for current Telegram group administrators. Open an assigned task to update it individually.");
        return true;
      }
      const preview = await createBulkActionPreview(user.id, String(ctx.from.id), bulkRequest);
      await replyHtml(ctx, formatBulkActionPreview(preview), {
        reply_markup: bulkActionConfirmationKeyboard(preview.pending.id)
      });
    } catch (error) {
      await ctx.reply(userFacingError(error, "I couldn't prepare that bulk action."));
    }
    return true;
  }),
];

// Exact help, menu and safety phrases come before any parser, so "help", "menu" or "undo"
// can never be read as an item reference. The group Calendar refusal sits here so no
// Calendar phrase in a group reaches the private Calendar rules further down.
const helpAndNavigationRules: NaturalRule[] = [
  rule("help", ({ lower }) => lower === "help", async ({ ctx }) => {
    const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
    await replyHtml(ctx, isGroupChat(ctx) ? formatGroupHelpGuide(ctx.me.username) : formatHelpGuide(), {
      reply_markup: isGroupChat(ctx) ? groupHelpTopicsKeyboard(workspace?.id) : helpTopicsKeyboard()
    });
    return true;
  }),
  rule("help topic", ({ trimmed }) => parseNaturalHelpRequest(trimmed), async ({ ctx }, helpTopic) => {
    await replyHtml(ctx, isGroupChat(ctx) ? formatGroupHelpTopic(helpTopic, ctx.me.username) : formatHelpTopic(helpTopic));
    return true;
  }),
  rule("command reference", ({ lower }) => lower === "commands" || lower === "slash commands" || lower === "show commands", async ({ ctx }) => {
    await replyHtml(ctx, isGroupChat(ctx) ? formatGroupCommandReference() : formatCommandReference());
    return true;
  }),
  rule("main menu", ({ lower }) => /^(?:start|get started|menu|show (?:me )?(?:the )?(?:menu|setup|onboarding)|open (?:the )?menu|take me through (?:the )?setup)$/.test(lower), async ({ ctx, user }) => {
    if (!ctx.from) return true;
    await showMainMenu(ctx, user.settings.timezone, user.id, ctx.from.id);
    return true;
  }),
  rule("dashboard link", ({ lower }) => /^(?:(?:open|show|visit|take me to) (?:my |the )?)?(?:web )?dashboard$/.test(lower), async ({ ctx }) => {
    await showDashboardLink(ctx);
    return true;
  }),
  rule("privacy", ({ lower }) => /^(?:privacy|data privacy|is my data safe|who can (?:see|access) my data|how (?:is|do you keep) my data safe)$/.test(lower), async ({ ctx }) => {
    await replyHtml(ctx, isGroupChat(ctx) ? formatGroupPrivacyText() : formatPrivacyText(), isGroupChat(ctx) ? {} : { reply_markup: dashboardLinkKeyboard() });
    return true;
  }),
  rule("group calendar refusal", ({ ctx, lower }) => isGroupChat(ctx)
    && !/^(?:remind|task|note|idea|save|remember)\b/.test(lower)
    && /\b(?:google calendar|calendar)\b/.test(lower), async ({ ctx }) => {
    await ctx.reply("Calendar is a personal connection. Message me privately to manage it.");
    return true;
  }),
  rule("undo", ({ lower }) => /^(?:undo|undo that|take that back|reverse (?:the )?(?:last )?change|never mind that|revert (?:the )?(?:last )?(?:thing|change))$/.test(lower), async ({ ctx, user }) => {
    await replyHtml(ctx, await undoLastActionForContext(ctx, user.id));
    return true;
  }),
  rule("review", ({ lower }) => /^(?:review|show (?:me )?(?:my )?review|give me (?:a )?review|what needs (?:my )?attention)$/.test(lower), async ({ ctx, user }) => {
    await replyHtml(ctx, await buildReview(user.id, user.settings.timezone));
    return true;
  }),
];

// Whole-list requests ("my tasks", "show images", "pins") are exact phrases, checked before
// the single-item lookups so "images" is the list and not image search.
const listRules: NaturalRule[] = [
  rule("group: my tasks", ({ ctx, lower }) => isGroupChat(ctx) && /^(?:show |list |open )?(?:my tasks|tasks assigned to me|my assigned tasks)$/.test(lower), async ({ ctx, user }) => {
    const actor = collaborationActorFromContext(ctx);
    const tasks = (await listOpenTasks(user.id)).filter((task) => task.assignees?.some((assignee) =>
      assignee.telegramId === actor.telegramId
      || Boolean(actor.username && assignee.username?.toLowerCase() === actor.username.toLowerCase())
    ));
    await replyFilteredGroupTasks(ctx, tasks, user.settings.timezone, "My shared tasks");
    return true;
  }),
  rule("group: unassigned tasks", ({ ctx, lower }) => isGroupChat(ctx) && /^(?:show |list |open )?(?:unassigned tasks|tasks with no owner|tasks without an owner)$/.test(lower), async ({ ctx, user }) => {
    const tasks = (await listOpenTasks(user.id)).filter((task) => !task.assignees?.length);
    await replyFilteredGroupTasks(ctx, tasks, user.settings.timezone, "Unassigned tasks");
    return true;
  }),
  rule("list tasks, notes or ideas", ({ lower }) => parseListRequest(lower), async ({ ctx, user }, listKind) => {
    await replyActiveList(ctx, user, listKind);
    return true;
  }),
  rule("image list", ({ lower }) => /^(?:(?:show|list|view|open|browse|pull up)(?:\s+me)?(?:\s+all)?(?:\s+my)?\s+)?(?:saved\s+)?(?:images|photos|pictures|screenshots)$/.test(lower)
    || /^(?:what|which)\s+(?:images|photos|pictures)\s+(?:have\s+i|did\s+i)\s+(?:save|store|keep)(?:d)?$/.test(lower), async ({ ctx, user }) => {
    await replyStoredImageList(ctx, user.id, user.settings.timezone);
    return true;
  }),
  rule("view image", ({ trimmed }) => trimmed.match(/^(?:(?:show|view|open|send|get|retrieve)\s+(?:me\s+)?(?:the\s+)?)?(?:saved\s+)?(?:image|photo|picture)\s+(\d+|IMG-\d+)$/i)?.[1], async ({ ctx, user }, reference) => {
    try {
      await replyStoredImage(ctx, user.id, normalizePublicId(reference));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      await ctx.reply("I couldn't find that saved image. Say 'show my images' to browse them.");
    }
    return true;
  }),
  rule("image caption", ({ trimmed }) => {
    const imageCaptionMatch = trimmed.match(/^(?:caption|label|name|rename|change\s+(?:the\s+)?caption\s+(?:of|for))\s+(?:image\s+)?(\d+|IMG-\d+)\s+(?:as|to|with)?\s*(.+)$/i);
    return imageCaptionMatch?.[1] && imageCaptionMatch[2] ? { reference: imageCaptionMatch[1], caption: imageCaptionMatch[2] } : undefined;
  }, async ({ ctx, user }, { reference, caption }) => {
    try {
      const image = await updateStoredImageCaption(user.id, normalizePublicId(reference), caption);
      await replyHtml(ctx, `${bold("✅ Caption updated")} ${code(image.publicId)} ${h(image.caption ?? caption)}\n${code("/undo")} restores the previous caption.`, { reply_markup: undoKeyboard("↩️ Undo caption") });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      await ctx.reply("I couldn't find that saved image. Say 'show my images' to browse them.");
    }
    return true;
  }),
  // Before task cancel: "delete image 3" names an image, not task "image".
  rule("delete image", ({ trimmed }) => trimmed.match(/^(?:delete|remove|forget)\s+(?:saved\s+)?(?:image|photo|picture)\s+(\d+|IMG-\d+)$/i)?.[1], async ({ ctx, user }, reference) => {
    try {
      const image = await findStoredImageReference(user.id, normalizePublicId(reference));
      await replyHtml(ctx, formatStoredImageDeletePrompt(image), { reply_markup: storedImageDeleteKeyboard(image.id) });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      await ctx.reply("I couldn't find that saved image. Say 'show my images' to browse them.");
    }
    return true;
  }),
  rule("pinned list", ({ lower }) => /^(?:pins|pinned|show (?:me )?(?:my )?(?:pins|pinned items|important items))$/.test(lower), async ({ ctx, user }) => {
    await replyHtml(ctx, formatPinnedItems(await listPinnedItems(user.id)));
    return true;
  }),
];

// Settings come before capture: "remind me again every 3 hours" is the reminder-interval
// setting, and reminder capture at the end would otherwise save it as a reminder.
const settingsRules: NaturalRule[] = [
  rule("show settings", ({ lower }) => /^(?:settings|preferences|show (?:me )?(?:my )?(?:settings|preferences)|what are my settings)$/.test(lower), async ({ ctx, user }) => {
    const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
    await replyControlCardHtml(ctx, isGroupChat(ctx)
      ? `${bold("⚙️ Group settings")}\nThese defaults apply only to this shared group workspace. Telegram group admins can change them.`
      : await formatSettings(user.id), { reply_markup: isGroupChat(ctx) ? groupSettingsModeKeyboard(workspace?.id) : settingsModeKeyboard() });
    return true;
  }),
  rule("natural setting change", ({ trimmed }) => parseNaturalSettingChange(trimmed), async ({ ctx, user }, settingChange) => {
    if (isGroupChat(ctx) && !(await isGroupManager(ctx))) {
      await ctx.reply("Only a Telegram group admin can change this group's Threadwise settings.");
      return true;
    }
    const result = await updateSetting(user.id, settingChange);
    await ctx.reply(result.message);
    return true;
  }),
];

// Lookups by kind (archived, search, "note 3", "idea 3", "task 3") come before the task
// actions so a bare "task 3" opens the task, and "restore 3" is never read as an action.
const lookupRules: NaturalRule[] = [
  rule("archived list", ({ lower }) => {
    const archivedMatch = lower.match(/^(?:(?:show|view|list|browse)(?:\s+me)?(?:\s+my)?\s+)?archived\s+(notes?|ideas?|tasks?)(?:\s+(?:page\s+)?(\d+))?$/);
    return archivedMatch?.[1] ? { kindText: archivedMatch[1], pageText: archivedMatch[2] } : undefined;
  }, async ({ ctx, user }, { kindText, pageText }) => {
    const kind = parseArchiveKind(kindText);
    if (!kind) return false;
    const page = Number(pageText ?? "1");
    const archived = await listArchivedItems(user.id, kind, Number.isInteger(page) ? page : 1);
    await replyHtml(ctx, formatArchivedPage(archived, user.settings.timezone), {
      reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
    });
    return true;
  }),
  rule("merge notes", ({ trimmed }) => trimmed.match(/^(?:merge|combine|join)\s+(?:my\s+)?notes\s+(.+)$/i)?.[1], async ({ ctx, user, ai }, references) => {
    try {
      const preview = await createNoteMergePreview(user.id, references.split(/\s+/).map(normalizePublicId), ai);
      await replyHtml(ctx, formatNoteMergePreview(preview), { reply_markup: noteMergePreviewKeyboard(preview.pendingId) });
    } catch (error) {
      await ctx.reply(userFacingError(error, "I couldn't prepare that merge. Try /notes to check the note numbers."));
    }
    return true;
  }),
  rule("restore archived", ({ trimmed }) => trimmed.match(/^(?:restore|recover|bring back)\s+(?:(?:archived|my)\s+)?(?:(?:task|note|idea)\s+)?(\S+)$/i)?.[1], async ({ ctx, user }, reference) => {
    if (isGroupChat(ctx) && looksLikeTaskReference(reference)) {
      await assertNaturalGroupTaskAction(ctx, user.id, reference, "manage");
    }
    const message = await restoreArchivedItem(user.id, normalizePublicId(reference));
    await replyHtml(ctx, message ?? "I couldn't find that archived item. Try archived notes, archived ideas, or archived tasks.");
    return true;
  }),
  rule("search", ({ trimmed }) => (trimmed.match(/^(?:search(?:\s+for)?|look\s+for|find\s+(?:anything\s+)?(?:about\s+)?)\s*(.+)$/i)
    ?? trimmed.match(/^(?:do\s+i\s+have\s+anything|where(?:'s|\s+is)\s+(?:the\s+)?(?:thing|note|task|idea))\s+(?:about|on|for)\s+(.+)$/i))?.[1], async ({ ctx, user }, request) => {
    const imageSearch = request.match(/^(?:saved\s+)?(?:images?|photos?|pictures?|screenshots?)(?:\s+(?:captioned|named|called|for|about|containing|with(?:\s+(?:caption|text))?))?\s+(.+)$/i);
    if (imageSearch?.[1]) {
      const captionOnly = /\b(?:captioned|named|called|with\s+(?:the\s+)?caption)\b/i.test(request);
      const textOnly = /\b(?:ocr|with\s+(?:the\s+)?text|containing\s+text)\b/i.test(request);
      await replyStoredImageSearch(ctx, user.id, imageSearch[1], user.settings.timezone, 1, undefined, captionOnly ? "caption" : textOnly ? "text" : "all");
      return true;
    }
    const parsed = parseSearchRequest(request);
    if (!parsed.query) {
      await ctx.reply("Add a query after the filter, like search notes deployment or search tasks invoice.");
      return true;
    }
    const results = await semanticSearch(user.id, parsed.query, parsed.kinds, {
      includeDone: parsed.includeDone,
      doneOnly: parsed.doneOnly
    });
    const pending = await createPendingSearch(user.id, parsed);
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
    await replyHtml(ctx, formatSearchResultsPage(results, 1, pageSize, parsed.label), {
      reply_markup: searchPageKeyboard(pending.id, 1, totalPages)
    });
    return true;
  }),
  rule("note analysis", ({ lower }) => /^(?:note analysis|analy[sz]e (?:my )?notes|how (?:am i|do i) (?:take|write|keep) notes)$/.test(lower), async ({ ctx, user, ai }) => {
    await replyHtml(ctx, formatNoteAnalysis(await analyzeNoteStyle(user.id, ai)));
    return true;
  }),
  rule("view note", ({ trimmed }) => (trimmed.match(/^(?:(?:show|view|open|read)\s+(?:me\s+)?(?:the\s+)?)?note\s+(\d+|NOTE-\d+)$/i)
    ?? trimmed.match(/^(?:what(?:'s|\s+is)\s+in|tell\s+me\s+about)\s+note\s+(\d+|NOTE-\d+)$/i))?.[1], async ({ ctx, user }, reference) => {
    try {
      const note = await findNoteReference(user.id, normalizePublicId(reference));
      const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
      const card = await buildItemCard(
        user.id,
        "note",
        note.publicId,
        user.settings.timezone,
        undefined,
        true,
        1,
        workspace?.id,
      );
      await replyControlCardHtml(ctx, card.text, { reply_markup: card.keyboard });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      try {
        const card = buildArchivedNoteCard(
          await findAnyNote(user.id, normalizePublicId(reference))
        );
        await replyControlCardHtml(ctx, card.text, { reply_markup: card.keyboard });
      } catch (archivedError) {
        if (!isNotFoundError(archivedError)) throw archivedError;
        await ctx.reply("I couldn't find that note. Show notes will list the recent ones.");
      }
    }
    return true;
  }),
  rule("view idea", ({ trimmed }) => {
    const reference = trimmed.match(/^(?:idea|(?:show|view|open)\s+(?:me\s+)?(?:the\s+)?idea)\s+(\S+)$/i)?.[1];
    return reference && /^(\d+|IDEA-\d+)$/i.test(reference) ? reference : undefined;
  }, async (input, reference) => replyNaturalIdeaDetail(input, reference)),
  rule("search notes", ({ trimmed }) => trimmed.match(/^notes\s+(.+)$/i)?.[1], async ({ ctx, user }, query) => {
    const notes = await searchNotes(user.id, query);
    const keyboard = itemListKeyboard("note", notes);
    await replyControlCardHtml(ctx, formatRecentNotes(notes), keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  }),
  rule("ideas N", ({ trimmed }) => trimmed.match(/^ideas\s+(\d+|IDEA-\d+)$/i)?.[1], async (input, reference) => replyNaturalIdeaDetail(input, reference)),
  // Before the task actions and task capture: "task milk" is a lookup that answers "couldn't
  // find that task", not a new task.
  rule("task detail", ({ trimmed }) => (trimmed.match(/^(?:task|(?:show|view|open)\s+(?:me\s+)?(?:the\s+)?task)\s+(\S+)$/i)
    ?? trimmed.match(/^(?:what(?:'s|\s+is)|tell\s+me\s+about)\s+(?:in\s+)?task\s+(\S+)$/i))?.[1], async ({ ctx, user }, reference) => {
    try {
      const task = await findTaskReference(user.id, normalizePublicId(reference));
      await replyControlCardHtml(ctx, formatTaskDetail(task, user.settings.timezone), { reply_markup: isGroupChat(ctx) ? await groupTaskKeyboardForNaturalCommand(ctx, user.id, task.id) : taskActionsKeyboard(task, true) });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      await ctx.reply("I couldn't find that task. tasks will show the current list.");
    }
    return true;
  }),
];

// Actions on an existing task, then on pins and notes. Order inside matters: snooze's
// "remind me about 3 in 2 hours" must win over reminder capture (far below), and the
// unassign rules must run before cancel so "remove @alex from 3" changes assignees.
const taskActionRules: NaturalRule[] = [
  rule("claim (group)", ({ ctx, trimmed }) => isGroupChat(ctx) && (trimmed.match(/^(?:claim|take|pick\s+up)\s+(?:the\s+)?(?:unassigned\s+)?(?:task\s+)?(\S+)$/i)
    ?? trimmed.match(/^i(?:'ll|\s+will)\s+(?:take|handle)\s+(?:task\s+)?(\S+)$/i))?.[1], async ({ ctx, user }, reference) => {
    const task = await claimGroupTask(user.id, reference, collaborationActorFromContext(ctx));
    await replyHtml(ctx, `${bold("Task claimed")} ${code(task.publicId)}\n${h(task.title)}`);
    return true;
  }),
  rule("complete", ({ trimmed }) => (trimmed.match(/^(?:done|complete|finish|check off|tick off)\s+(?:task\s+)?(\S+)$/i)
    ?? trimmed.match(/^(?:mark|set)\s+(?:task\s+)?(\S+)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i)
    ?? trimmed.match(/^(?:task\s+)?(\S+)\s+is\s+(?:done|complete|completed|finished)$/i)
    ?? trimmed.match(/^i(?:'ve|\s+have)?\s+(?:done|completed|finished|checked\s+off)\s+(?:task\s+)?(\S+)$/i))?.[1],
  async ({ ctx, user }, ref) => runNaturalTaskCommand(ctx, user, { action: "complete", ref })),
  rule("snooze", ({ trimmed }) => {
    const snoozeMatch = trimmed.match(/^(?:snooze|delay|pause|put\s+off)\s+(?:task\s+)?(\S+)(?:\s+(?:for|by|until)?\s*(.+))?$/i)
      ?? trimmed.match(/^(?:remind|nudge)\s+me\s+(?:about\s+)?(?:task\s+)?(\S+)\s+(?:again\s+)?(?:in|after)\s+(.+)$/i);
    return snoozeMatch?.[1] ? { ref: snoozeMatch[1], duration: snoozeMatch[2] ?? "1h" } : undefined;
  }, async ({ ctx, user }, { ref, duration }) => runNaturalTaskCommand(ctx, user, { action: "snooze", ref, duration })),
  rule("reschedule", ({ trimmed }) => {
    const rescheduleMatch = trimmed.match(/^(?:reschedule|move|postpone|push|shift|change\s+the\s+time\s+of)\s+(?:task\s+)?(\S+)\s+(?:to|until|for|by)?\s*(.+)$/i)
      ?? trimmed.match(/^(?:change|set|update)\s+(?:the\s+)?(?:due\s+date|deadline|time)\s+(?:of|for)\s+(?:task\s+)?(\S+)\s+to\s+(.+)$/i)
      ?? trimmed.match(/^(?:make|set)\s+(?:task\s+)?(\S+)\s+due\s+(.+)$/i)
      ?? trimmed.match(/^(?:task\s+)?(\S+)\s+(?:is|should\s+be)\s+due\s+(.+)$/i);
    return rescheduleMatch?.[1] && rescheduleMatch[2] ? { reference: rescheduleMatch[1], whenText: rescheduleMatch[2] } : undefined;
  }, async ({ ctx, user }, { reference, whenText }) => {
    await assertNaturalGroupTaskAction(ctx, user.id, reference, "manage");
    const task = await rescheduleTask(user.id, normalizePublicId(reference), whenText);
    await replyHtml(ctx, `${bold("📅 Schedule updated")} ${code(task.publicId)} ${h(task.title)}\n${task.dueAt ? `${bold("Due")} ${h(formatDateTimeForUser(task.dueAt, user.settings.timezone))}` : `${bold("Due")} none`}\n${code("/undo")} restores the previous schedule.`, { reply_markup: undoKeyboard("↩️ Undo reschedule") });
    return true;
  }),
  rule("assign", ({ trimmed }) => parseNaturalTaskAssignment(trimmed), async ({ ctx, user }, [reference, assignee]) =>
    runNaturalTaskCommand(ctx, user, { action: "assign", ref: reference, assignees: assignee, options: taskCreationOptionsFromContext(ctx, assignee) })),
  rule("unassign one person", ({ trimmed }) => {
    const removeOneAssignee = trimmed.match(/^(?:unassign|remove)\s+(.+?)\s+from\s+(?:task\s+)?(\S+)$/i);
    return removeOneAssignee?.[1] && removeOneAssignee[2] ? { assignee: removeOneAssignee[1], ref: removeOneAssignee[2] } : undefined;
  }, async ({ ctx, user }, { assignee, ref }) =>
    runNaturalTaskCommand(ctx, user, { action: "unassign", ref, assignee, options: taskCreationOptionsFromContext(ctx, assignee) })),
  rule("unassign everyone", ({ trimmed }) => trimmed.match(/^(?:unassign|remove (?:the )?assignees? (?:from|on))\s+(?:task\s+)?(\S+)$/i)?.[1],
    async ({ ctx, user }, ref) => runNaturalTaskCommand(ctx, user, { action: "unassign", ref })),
  rule("cancel", ({ trimmed }) => (trimmed.match(/^(?:cancel|delete|drop|remove|get rid of|archive)\s+(?:task\s+)?(\S+)$/i)
    ?? trimmed.match(/^i\s+(?:don't|do\s+not)\s+need\s+(?:task\s+)?(\S+)\s+anymore$/i))?.[1],
  async ({ ctx, user }, ref) => runNaturalTaskCommand(ctx, user, { action: "cancel", ref })),
  // Before "mark ... as important": "mark 3 as not important" also ends in "important".
  rule("remove important", ({ trimmed }) => (trimmed.match(/^(?:remove|clear)\s+(?:the\s+)?important(?:\s+mark)?\s+from\s+(?:task\s+)?(.+)$/i)
    ?? trimmed.match(/^mark\s+(?:task\s+)?(.+)\s+as\s+not\s+important$/i))?.[1], async ({ ctx, user }, reference) => {
    if (isGroupChat(ctx) && looksLikeTaskReference(reference)) {
      await assertNaturalGroupTaskAction(ctx, user.id, reference, "manage");
    }
    const item = await pinItem(user.id, normalizePublicId(reference), false);
    await replyHtml(ctx, `${formatPinResult(item, false)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? { reply_markup: undoKeyboard("Undo") } : undefined);
    return true;
  }),
  rule("mark important or pin", ({ trimmed }) => {
    const markImportantMatch = trimmed.match(/^mark\s+(?:task\s+)?(.+)\s+as\s+important$/i)
      ?? trimmed.match(/^make\s+(?:task\s+)?(.+)\s+important$/i);
    const pinMatch = trimmed.match(/^(pin|star|important|unpin|unstar)\s+(?:task\s+|note\s+|idea\s+)?(.+)$/i);
    if (!(markImportantMatch?.[1] || (pinMatch?.[1] && pinMatch[2]))) return undefined;
    return {
      shouldPin: Boolean(markImportantMatch) || ["pin", "star", "important"].includes(pinMatch?.[1]?.toLowerCase() ?? ""),
      reference: markImportantMatch?.[1] ?? pinMatch?.[2] ?? "",
    };
  }, async ({ ctx, user }, { shouldPin, reference }) => {
    if (isGroupChat(ctx) && looksLikeTaskReference(reference)) {
      await assertNaturalGroupTaskAction(ctx, user.id, reference, "manage");
    }
    const item = await pinItem(user.id, normalizePublicId(reference), shouldPin);
    await replyHtml(ctx, `${formatPinResult(item, shouldPin)}${item.changed ? `\n${code("/undo")} will reverse that.` : ""}`, item.changed ? { reply_markup: undoKeyboard("Undo") } : undefined);
    return true;
  }),
  rule("archive note", ({ trimmed }) => (trimmed.match(/^(?:archive|remove|delete|hide)\s+(?:my\s+)?note\s+(\S+)$/i)
    ?? trimmed.match(/^move\s+(?:my\s+)?note\s+(\S+)\s+to\s+(?:the\s+)?archive$/i))?.[1], async ({ ctx, user }, reference) => {
    const note = await archiveNote(user.id, normalizePublicId(reference));
    await replyHtml(ctx, `${bold("🗃️ Note archived")} ${code(note.publicId)} ${h(note.title)}\nIt is out of the way, not gone. ${code("/undo")} brings it back.`, {
      reply_markup: undoKeyboard("↩️ Undo archive")
    });
    return true;
  }),
];

// Edits and idea tools. "review idea 3" scores an idea only because the exact "review"
// phrase was checked first. Known quirk kept as-is: "rename 3 to X" is claimed earlier by
// the image caption rule (its verbs include "rename"), so it renames image 3.
const editRules: NaturalRule[] = [
  rule("rename or edit", ({ trimmed }) => {
    const naturalRenameMatch = trimmed.match(/^change\s+(?:(title|details?|description|body|concept)\s+of\s+)?(?:(task|note|idea)\s+)?(\d+|TASK-\d+|NOTE-\d+|IDEA-\d+)\s+to\s+(.+)$/i);
    const renameMatch = trimmed.match(/^(?:rename|edit)\s+(.+)$/i);
    const naturalRenameBody = naturalRenameMatch
      ? [naturalRenameMatch[2], naturalRenameMatch[3], naturalRenameMatch[1], naturalRenameMatch[4]].filter(Boolean).join(" ")
      : undefined;
    return naturalRenameBody
      ? parseReferenceAndTitle(naturalRenameBody)
      : renameMatch?.[1]
        ? parseReferenceAndTitle(renameMatch[1])
        : undefined;
  }, async ({ ctx, user }, renameParsed) => {
    if (renameParsed.field === "description") {
      const taskReference = renameParsed.reference.toLowerCase().startsWith("task ") ? renameParsed.reference.slice(5) : renameParsed.reference;
      await assertNaturalGroupTaskAction(ctx, user.id, taskReference, "manage");
      const task = await updateTaskDescription(user.id, normalizePublicId(taskReference), renameParsed.title);
      await replyHtml(ctx, `${bold("✅ Task details updated")} ${code(task.publicId)}\n${code("/undo")} restores the previous version.`, { reply_markup: undoKeyboard("↩️ Undo edit") });
      return true;
    }

    if (renameParsed.reference.toUpperCase().startsWith("NOTE-") || renameParsed.reference.toLowerCase().startsWith("note ")) {
      const noteReference = renameParsed.reference.toLowerCase().startsWith("note ") ? renameParsed.reference.slice(5) : renameParsed.reference;
      const noteTarget = await findNoteReference(user.id, normalizePublicId(noteReference));
      if (renameParsed.field === "body") {
        const note = await updateNoteBody(user.id, noteTarget.publicId, renameParsed.title);
        await replyHtml(ctx, `${bold("✅ Note updated")} ${code(note.publicId)}\n${code("/undo")} restores the previous version.`, { reply_markup: undoKeyboard("↩️ Undo edit") });
        return true;
      }
      const note = await renameNoteTitle(user.id, noteTarget.publicId, renameParsed.title);
      await replyHtml(ctx, `${bold("✅ Note renamed")} ${code(note.publicId)} ${h(note.title)}\n${code("/undo")} puts the old title back.`, { reply_markup: undoKeyboard("↩️ Undo rename") });
      return true;
    }

    if (renameParsed.reference.toUpperCase().startsWith("IDEA-") || renameParsed.reference.toLowerCase().startsWith("idea ")) {
      const ideaReference = renameParsed.reference.toLowerCase().startsWith("idea ") ? renameParsed.reference.slice(5) : renameParsed.reference;
      const ideaTarget = await findIdeaReference(user.id, normalizePublicId(ideaReference));
      if (renameParsed.field === "concept") {
        const idea = await updateIdeaConcept(user.id, ideaTarget.publicId, renameParsed.title);
        await replyHtml(ctx, `${bold("✅ Idea updated")} ${code(idea.publicId)}\n${code("/undo")} restores the previous version.`, { reply_markup: undoKeyboard("↩️ Undo edit") });
        return true;
      }
      const idea = await renameIdeaTitle(user.id, ideaTarget.publicId, renameParsed.title);
      await replyHtml(ctx, `${bold("✅ Idea renamed")} ${code(idea.publicId)} ${h(idea.title)}\n${code("/undo")} puts the old title back.`, { reply_markup: undoKeyboard("↩️ Undo rename") });
      return true;
    }

    const taskReference = renameParsed.reference.toLowerCase().startsWith("task ") ? renameParsed.reference.slice(5) : renameParsed.reference;
    await assertNaturalGroupTaskAction(ctx, user.id, taskReference, "manage");
    const task = await renameTaskTitle(user.id, normalizePublicId(taskReference), renameParsed.title);
    await replyHtml(ctx, `${bold("✅ Task renamed")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} puts the old title back.`, { reply_markup: undoKeyboard("↩️ Undo rename") });
    return true;
  }),
  rule("score idea", ({ trimmed }) => (trimmed.match(/^(?:score|rate|evaluate|assess|review|analy[sz]e)\s+(?:idea\s+)?(\d+|IDEA-\d+)$/i)
    ?? trimmed.match(/^(?:create\s+(?:an\s+)?|show\s+(?:me\s+)?(?:the\s+)?)?idea\s+brief\s+(?:for\s+)?(?:idea\s+)?(\d+|IDEA-\d+)$/i)
    ?? trimmed.match(/^(?:how\s+good|how\s+viable)\s+is\s+(?:idea\s+)?(\d+|IDEA-\d+)$/i))?.[1], async ({ ctx, user, ai }, reference) => {
    const result = await scoreIdea(user.id, normalizePublicId(reference), ai);
    await replyControlCardHtml(ctx, formatIdeaScore(result.publicId, result.score), {
      reply_markup: ideaBriefKeyboard(result.publicId)
    });
    return true;
  }),
  rule("implementation brief", ({ trimmed }) => trimmed.match(/^(?:brief|build (?:an\s+)?(?:implementation\s+)?brief|create (?:an\s+)?implementation (?:brief|prompt) for)\s+(?:idea\s+)?(\d+|IDEA-\d+)$/i)?.[1], async ({ ctx, user }, reference) => {
    const result = await createImplementationBrief(user.id, normalizePublicId(reference));
    await replyInChunks(ctx, [`Implementation prompt for ${result.publicId}:`, "", result.prompt].join("\n"));
    return true;
  }),
];

// Private Google Calendar phrases (groups were refused near the top). Exact status, connect
// and disconnect phrases come before the "calendar for task 3" lookups. Known quirk kept
// as-is: "remove 3 from calendar" is claimed earlier by "unassign one person"; "delete" and
// "take ... off" reach the Calendar rule.
const calendarRules: NaturalRule[] = [
  rule("calendar status", ({ lower }) => /^(?:calendar|google calendar|calendar status|google calendar status|is (?:my )?google calendar connected|show (?:me )?(?:my )?calendar(?: status)?)$/.test(lower), async ({ ctx, user }) => {
    const status = await calendarConnectionStatus(user.id);
    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const connectUrl = !status.connected && calendarConfigured()
      ? await createCalendarConnectUrl(user.id, chatId, { enableAutoSync: true })
      : undefined;
    await replyHtml(ctx, await formatCalendarStatus(user.id, status), { reply_markup: calendarSettingsKeyboard(status, connectUrl) });
    return true;
  }),
  rule("connect calendar", ({ lower }) => /^(?:connect|link|set up) (?:my )?(?:google )?calendar$/.test(lower), async ({ ctx, user }) => {
    if (!calendarConfigured()) {
      await ctx.reply("Google Calendar OAuth is not configured on the server yet.");
      return true;
    }
    const chatId = ctx.chat ? String(ctx.chat.id) : user.telegramId;
    const url = await createCalendarConnectUrl(user.id, chatId, { enableAutoSync: true });
    await replyHtml(ctx, `${bold("📅 Google Calendar")}\nConnect once. Dated tasks can then stay in sync automatically.`, {
      reply_markup: calendarSettingsKeyboard({ connected: false, autoSync: false }, url)
    });
    return true;
  }),
  rule("disconnect calendar", ({ lower }) => /^(?:disconnect|unlink) (?:my )?(?:google )?calendar$/.test(lower), async ({ ctx, user }) => {
    await replyHtml(ctx, await disconnectCalendar(user.id));
    return true;
  }),
  rule("automatic calendar sync", ({ lower }) => lower.match(/^(?:(?:turn|switch)\s+)?(on|off)?\s*(?:automatic|automatically) sync (?:all )?(?:my )?(?:dated )?(?:tasks|reminders)(?: (?:to|with) (?:google )?calendar)?$/), async ({ ctx, user }, automaticCalendar) => {
    const enabled = automaticCalendar[1] !== "off";
    await prisma.userSettings.update({ where: { userId: user.id }, data: { calendarAutoSync: enabled } });
    if (enabled && (await calendarConnectionStatus(user.id)).connected) {
      const result = await syncEligibleTasksToGoogleCalendar(user.id);
      await ctx.reply(`Automatic Calendar sync is on. ${result.synced} dated task${result.synced === 1 ? "" : "s"} synced${result.failed ? `; ${result.failed} need another try` : ""}.`);
    } else {
      await ctx.reply(`Automatic Calendar sync is ${enabled ? "on" : "off"}.`);
    }
    return true;
  }),
  rule("remove task from calendar", ({ trimmed }) => trimmed.match(/^(?:remove|delete|take)\s+(?:task\s+)?(\S+)\s+(?:from|off)\s+(?:my\s+)?(?:google\s+)?calendar$/i)?.[1], async ({ ctx, user }, reference) => {
    try {
      const task = await findTaskReference(user.id, normalizePublicId(reference));
      await removeTaskFromGoogleCalendar(user.id, task);
      await ctx.reply(`${task.publicId} was removed from Google Calendar. The Threadwise task is unchanged.`);
    } catch (error) {
      await ctx.reply(userFacingError(error, "I couldn't remove that Calendar event."));
    }
    return true;
  }),
  rule("add latest task to calendar", ({ lower }) => /^(?:add|put) (?:this|the) (?:task|reminder) (?:to|on) (?:my )?(?:google )?calendar$/.test(lower), async ({ ctx, user }) => {
    const task = await prisma.task.findFirst({
      where: { userId: user.id, status: "OPEN", archivedAt: null, dueAt: { not: null } },
      orderBy: { updatedAt: "desc" }
    });
    if (!task) {
      await ctx.reply("I couldn't find a recent dated task. Open Tasks and tap Calendar on the one you mean.");
      return true;
    }
    await replyNaturalCalendarTask(ctx, user.id, user.telegramId, task.id);
    return true;
  }),
  rule("calendar link for task", ({ trimmed }) => trimmed.match(/^(?:(?:send|give|get)(?:\s+me)?(?:\s+the)?\s+)?google\s+calendar\s+link\s+(?:for\s+)?(?:task\s+)?(\S+)$/i)?.[1], async ({ ctx, user }, reference) => {
    await replyWithTaskCalendar(ctx, {
      userId: user.id,
      reference,
      timezone: user.settings.timezone,
      includeIcs: false
    });
    return true;
  }),
  rule("add task to calendar", ({ trimmed }) => (trimmed.match(/^(?:calendar|googlecal)\s+(?:for\s+)?(?:task\s+)?(\S+)$/i)
    ?? trimmed.match(/^(?:add|put)\s+(?:task\s+)?(\S+)\s+(?:to|on)\s+(?:my\s+)?calendar$/i))?.[1], async ({ ctx, user }, reference) => {
    await replyNaturalCalendarTask(ctx, user.id, user.telegramId, reference);
    return true;
  }),
];

// Capture runs last: anything still unmatched that reads as "remind me ...", "idea: ...",
// "task: ..." or "note: ..." is saved as new content. The explicit "settings ..." form and
// the exact version phrases sit among them in their historical order; neither overlaps.
const captureRules: NaturalRule[] = [
  rule("settings command", ({ trimmed }) => trimmed.match(/^settings\s+(.+)$/i)?.[1], async ({ ctx, user }, body) => {
    const result = await updateSetting(user.id, body.split(/\s+/));
    await ctx.reply(result.message);
    return true;
  }),
  rule("reminder capture", ({ trimmed }) => parseNaturalReminderBody(trimmed), async ({ ctx, user }, reminderBody) => {
    const parsed = splitReminderText(reminderBody);
    const scheduledAt = parseDueDate(parsed?.whenText ?? reminderBody, user.settings.timezone);
    if (!parsed || !scheduledAt || scheduledAt.getTime() <= Date.now()) {
      await ctx.reply("I understood that as a reminder, but I couldn't find a future time. Try: by 9pm, at 1.30pm, tomorrow morning, Friday at 3, or in 20 minutes.");
      return true;
    }
    await saveTaskFromTelegram(ctx, user, parsed.taskText, { dueAt: scheduledAt, options: taskCreationOptionsFromContext(ctx, parsed.taskText) });
    return true;
  }),
  rule("version status", ({ lower }) => /^(?:version|status|bot status|system status|what version (?:is this|are you running)|are reminders working)$/.test(lower), async ({ ctx, ai }) => {
    await replyHtml(ctx, formatVersionStatus({
      ai: ai.getStatus(),
      calendarConfigured: calendarConfigured(),
      excelConfigured: microsoftExcelConfigured(),
      reminders: getReminderDiagnostics()
    }));
    return true;
  }),
  rule("idea capture", ({ trimmed }) => parseNaturalIdeaBody(trimmed), async ({ ctx, user, ai }, ideaBody) => {
    const idea = await createIdea(user.id, ideaBody, ai);
    await replyQuietAcknowledgementHtml(ctx, formatIdeaSavedAcknowledgement(idea));
    return true;
  }),
  rule("task capture", ({ trimmed }) => parseNaturalTaskBody(trimmed), async ({ ctx, user }, taskBody) => {
    await saveTaskFromTelegram(ctx, user, taskBody, { options: taskCreationOptionsFromContext(ctx, taskBody) });
    return true;
  }),
  rule("note capture", ({ trimmed }) => parseNaturalNoteBody(trimmed), async ({ ctx, user, ai }, noteBody) => {
    const note = await createNote(user.id, noteBody, ai);
    await replyQuietAcknowledgementHtml(ctx, formatNoteSavedAcknowledgement(note));
    return true;
  }),
];

/** Every natural rule in the order they are tried; the position of each group is behaviour. */
const NATURAL_RULES: readonly NaturalRule[] = [
  ...bulkRules,
  ...helpAndNavigationRules,
  ...listRules,
  ...settingsRules,
  ...lookupRules,
  ...taskActionRules,
  ...editRules,
  ...calendarRules,
  ...captureRules,
];

/**
 * The name of the first rule that matches, without running it. For tests and debugging the
 * rule order; handleNaturalCommand uses the same matching.
 */
export function firstNaturalRuleName(ctx: Context, text: string): string | undefined {
  const input = naturalInput(ctx, {} as AiProvider, {} as ThreadwiseUser, text);
  return NATURAL_RULES.find((candidate) => candidate.match(input))?.name;
}

/** Normalizes the text once so every rule matches against the same strings. */
function naturalInput(ctx: Context, ai: AiProvider, user: ThreadwiseUser, text: string): NaturalInput {
  const trimmed = normalizeNaturalCommandText(text);
  return { ctx, ai, user, trimmed, lower: trimmed.toLowerCase() };
}

/**
 * Runs the deterministic natural-language commands for one message; false means "not a command".
 * The caller passes the user it already resolved, so a message costs one ensureUser (and, in
 * groups, one set of workspace/membership writes) instead of one per handler.
 */
export async function handleNaturalCommand(ctx: Context, ai: AiProvider, user: ThreadwiseUser, text: string): Promise<boolean> {
  const input = naturalInput(ctx, ai, user, text);
  for (const candidate of NATURAL_RULES) {
    const matched = candidate.match(input);
    if (matched) return candidate.run(input, matched as never);
  }
  return false;
}

/** Shows one idea's card; shared by "idea 3" and "ideas 3", which take the same reference. */
async function replyNaturalIdeaDetail({ ctx, user }: NaturalInput, reference: string): Promise<boolean> {
  try {
    const idea = await findIdeaReference(user.id, normalizePublicId(reference));
    const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
    await replyControlCardHtml(ctx, formatIdeaDetail(idea, user.settings.timezone), { reply_markup: itemActionsKeyboard("idea", idea, true, undefined, workspace?.id) });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await ctx.reply("I couldn't find that idea. ideas will show the recent list.");
  }
  return true;
}

/**
 * True when a reference looks like a task ("3", "TASK-3", "task 3"). Rules that accept any item
 * type use it so group task permission checks run only when the target is a task.
 */
function looksLikeTaskReference(reference: string): boolean {
  const normalized = reference.trim();
  return /^\d+$/.test(normalized)
    || /^TASK-\d+$/i.test(normalized)
    || /^task\s+/i.test(normalized);
}

/** In groups, checks the actor may perform this action on the task (assignee, creator or admin). Does nothing in private chats. */
async function assertNaturalGroupTaskAction(
  ctx: Context,
  ownerUserId: string,
  reference: string,
  action: "complete" | "snooze" | "manage",
): Promise<void> {
  if (!isGroupChat(ctx)) return;
  await assertGroupTaskActionForContext(ctx, ownerUserId, reference, action);
}

/**
 * Runs one natural-text task action through the shared executor and replies with the shared
 * copy. Errors, including group policy refusals, propagate to the message handler's reply.
 */
async function runNaturalTaskCommand(ctx: Context, user: ThreadwiseUser, command: TaskCommandInput): Promise<true> {
  const result = await executeTaskCommand({ ...command, userId: user.id, actor: taskCommandActorFromContext(ctx), source: "text" });
  await replyTaskCommandResult(ctx, result, user.settings.timezone);
  return true;
}

/** Builds the group task card buttons for the current actor's relation to the task (assignee, other member, or admin). */
async function groupTaskKeyboardForNaturalCommand(ctx: Context, ownerUserId: string, taskReference: string) {
  const access = await groupTaskKeyboardAccess(ctx, ownerUserId, taskReference);
  return groupTaskActionsKeyboard(access.task, access.audience, access.workspaceId, true, "menu:tasks");
}

/**
 * Puts one dated task on Google Calendar. If Calendar is not connected it replies with a connect
 * card instead. Undated tasks are refused because a Calendar event needs a time.
 */
async function replyNaturalCalendarTask(ctx: Context, userId: string, telegramId: string, reference: string) {
  try {
    let task = await findTaskReference(userId, normalizePublicId(reference));
    if (!task.dueAt) {
      await ctx.reply(`${task.publicId} needs a due date before it can go on a calendar.`);
      return;
    }
    const connect = await calendarTaskConnectCard(userId, ctx.chat ? String(ctx.chat.id) : telegramId, task);
    if (connect) {
      await replyHtml(ctx, connect.text, { reply_markup: connect.keyboard });
      return;
    }
    const synced = await syncTaskToGoogleCalendar(userId, task);
    if (!synced) throw new Error("Reconnect Google Calendar and try again.");
    task = await findTaskReference(userId, task.id);
    await replyHtml(ctx, `${bold(synced.created ? "📅 Added to Google Calendar" : "📅 Calendar updated")}\n${h(task.title)}`, {
      reply_markup: calendarTaskKeyboard(task)
    });
  } catch (error) {
    await ctx.reply(userFacingError(error, "I couldn't update Google Calendar."));
  }
}

/**
 * Splits "rename task 3 title New name" style text into the item reference, an optional field
 * (title, description, body, concept) and the new text. Accepts "task 3" or a bare reference.
 */
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

/** Replies with up to three open group tasks under a custom heading ("My shared tasks", "Unassigned tasks"). */
async function replyFilteredGroupTasks(
  ctx: Context,
  tasks: Awaited<ReturnType<typeof listOpenTasks>>,
  timezone: string,
  label: string,
) {
  const visibleTasks = tasks.slice(0, 3);
  if (visibleTasks.length === 0) {
    await ctx.reply(`No ${label.toLowerCase()} right now.`);
    return;
  }

  const body = formatOpenTasks(visibleTasks, timezone).replace(bold("📋 Tasks"), bold(label));
  await replyHtml(ctx, body, { reply_markup: taskListKeyboard(visibleTasks, 3) });
}
