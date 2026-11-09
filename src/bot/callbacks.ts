/**
 * Inline-button (callback query) handlers for the main Threadwise bot in Personal and Group chats.
 * `registerCallbacks` is called from `src/bot/index.ts` and matches the callback strings built in
 * `keyboards.ts`. Handlers answer the tap, call a domain service, and usually edit the tapped
 * card in place. Group task buttons re-check permission on every tap, because a button can be
 * pressed by any member who sees it. Study buttons are handled in `study.ts`.
 */
import type { Bot, Context } from "grammy";
import { saveTaskFromTelegram } from "./taskSaves";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { dismissTaskReminders, findTaskReference, formatTaskAlreadyCompleted, restoreCompletedTask } from "../services/tasks";
import { formatReminderMessage } from "../services/reminders";
import { consumePendingCapture, findPendingCapture, ignorePendingCapture, pendingCaptureTaskOptions, rememberPendingCaptureReminderPrompt } from "../services/pendingCaptures";
import { createIdea, formatIdeaSavedAcknowledgement, scoreIdea } from "../services/ideas";
import { archiveNote, createNote, findAnyNote, formatNoteSavedAcknowledgement } from "../services/notes";
import { formatPinnedItems, listPinnedItems, pinItem } from "../services/pins";
import { formatArchivedPage, listArchivedItems, parseArchiveKind } from "../services/archives";
import { cancelNoteMerge, confirmNoteMerge, formatNoteMergeConfirmed, formatNoteMergePreview, retryNoteMergePreview } from "../services/noteMerges";
import { beginPendingItemEdit, cancelPendingItemEdit, formatEditStarted, type EditableItemField, type EditableItemKind } from "../services/itemEdits";
import { findPendingSearch, semanticSearch } from "../services/search";
import { undoLastActionForContext } from "../services/undo";
import { formatIdeaScore, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { awaitImageReminderTime, consumePendingImageCapture, discardPendingImageCapture, findPendingImageCapture } from "../services/imageOcr";
import { calendarConfigured, calendarConnectionStatus, createCalendarConnectUrl, disconnectCalendar, formatCalendarStatus, removeTaskFromGoogleCalendar, syncEligibleTasksToGoogleCalendar, syncTaskToGoogleCalendar } from "../services/googleCalendar";
import { prisma } from "../db/prisma";
import { bold, code, editOrReplyHtml, editOrReplyText, h, replyHtml, replyInChunks } from "../utils/html";
import { calendarTaskConnectCard } from "./calendarReplies";
import { archivedKindsKeyboard, archivedPageKeyboard, calendarSettingsKeyboard, calendarTaskKeyboard, captureConfirmationKeyboard, captureTypeKeyboard, disconnectIntegrationKeyboard, editCancelKeyboard, groupHelpTopicsKeyboard, groupImagesModeKeyboard, groupLibraryMenuKeyboard, groupMoreMenuKeyboard, groupSettingsModeKeyboard, groupStartMenuKeyboard, groupTaskActionsKeyboard, helpTopicsKeyboard, ideaBriefKeyboard, ideasModeKeyboard, imageReminderTimeKeyboard, imagesModeKeyboard, integrationsSettingsKeyboard, menuBackKeyboard, menuInputCancelKeyboard, notesModeKeyboard, noteMergePreviewKeyboard, privacySettingsKeyboard, regionSettingsKeyboard, reminderActionsKeyboard, reminderSettingsKeyboard, restoreCompletedTaskKeyboard, searchModeKeyboard, searchPageKeyboard, settingChoicesKeyboard, settingInputKeyboard, settingsModeKeyboard, startMenuKeyboard, storedImageDeleteKeyboard, taskActionsKeyboard, taskCancelCalendarKeyboard, tasksModeKeyboard, undoKeyboard, voiceSettingsKeyboard, type GroupTaskAudience, type SettingChoiceField } from "./keyboards";
import { cancelBulkAction, confirmBulkAction, formatBulkActionResult } from "../services/bulkActions";
import { isActiveListKind, replyActiveList, replyActiveListWithMessage } from "./activeLists";
import { formatStoredImageDeletePrompt, replyStoredImage, replyStoredImageList, replyStoredImageSearch } from "./storedImageReplies";
import { deleteStoredImage, findStoredImageById } from "../services/storedImages";
import { formatGroupCommandReference, formatGroupHelpGuide, formatGroupHelpTopic, formatGroupMainMenuText, formatGroupPrivacyText, formatHelpGuide, formatHelpTopic, formatMainMenuText } from "./help";
import { formatRegionSettings, formatReminderSettings, formatSettings, formatVoiceSettings, updateSetting } from "../services/settings";
import { beginMenuInput, clearMenuInput, type MenuInputAction } from "./menuInputs";
import { rememberCallbackControlCard } from "./controlCards";
import { buildArchivedNoteCard, buildItemCard } from "./itemCards";
import { appendListOrigin, listOrigin, rememberListOrigin } from "./navigationState";
import { cancelTransientInteractions } from "./interactions";
import { isGroupChat } from "./groupRouting";
import { groupWorkspaceForContext, isGroupManager } from "../services/groupWorkspaces";
import { collaborationActorFromContext } from "../services/groupCollaboration";
import { claimGroupTask, GroupTaskPermissionError } from "../services/groupTaskPolicy";
import { assertGroupTaskActionForContext, groupTaskKeyboardAccess, taskCommandActorFromContext } from "./groupTaskAccess";
import { executeTaskCommand, type TaskCommandInput, type TaskCommandResult } from "../services/taskCommands";
import { userFacingError } from "./errorResponses";
import { editOrReplyQuietAcknowledgementHtml } from "./quietAcknowledgements";
import { convergeTaskControlSurface } from "../services/taskControlSurfaces";
import { preferEphemeralInteraction } from "./ephemeral";
import { beginNoteSession } from "./noteSessions";
import { resolveGroupTaskCallbackOwner } from "../services/groupTaskCompatibility";
import { formatCaptureReview, formatCaptureTypeChoice, formatReminderTimePrompt, suggestedPendingCaptureKind } from "./captureReview";
import { parseDueDate } from "../utils/dates";

/**
 * Registers every callback pattern. Order matters where patterns overlap: grammY runs the first
 * matching handler, so `item:<kind>:edit:<field>:<id>` is registered before the generic
 * `item:<kind>:edit:<id>`, which would otherwise swallow the field name as part of the id.
 */
export function registerCallbacks(bot: Bot, ai: AiProvider): void {
  // Cards sent before August still carry these buttons; answer them instead of leaving a spinner.
  bot.callbackQuery(/^task:(accept|block|decline|unblock|handoff):/, async (ctx) => ctx.answerCallbackQuery({
    text: "Assignments now take effect immediately. Open the task again for its current controls.",
    show_alert: true,
  }));
  bot.callbackQuery(/^task:claim:(.+)$/, async (ctx) => handleTaskClaim(ctx, ctx.match[1]!));
  bot.callbackQuery(/^task:done:([^:]+)(?::(\d+))?$/, async (ctx) => handleTaskDone(ctx, ctx.match[1]!, ctx.match[2]));
  bot.callbackQuery(/^task:restore:(.+)$/, async (ctx) => handleTaskRestore(ctx, ctx.match[1]!));
  bot.callbackQuery(/^task:snooze:(.+)$/, async (ctx) => handleTaskSnooze(ctx, ctx.match[1]!));
  bot.callbackQuery(/^task:dismiss-reminders:(.+)$/, async (ctx) => handleTaskReminderDismiss(ctx, ctx.match[1]!));
  bot.callbackQuery(/^task:view-(full|summary):(.+)$/, async (ctx) => handleTaskReminderView(ctx, ctx.match[2]!, ctx.match[1] === "full"));
  bot.callbackQuery(/^task:calendar:(.+)$/, async (ctx) => handleTaskCalendar(ctx, ctx.match[1]!));
  bot.callbackQuery(/^task:cancel-confirm:(remove|keep):(.+)$/, async (ctx) => handleTaskCancelConfirmed(ctx, ctx.match[2]!, ctx.match[1] === "remove"));
  bot.callbackQuery(/^task:cancel:(.+)$/, async (ctx) => handleTaskCancel(ctx, ctx.match[1]!));
  bot.callbackQuery(/^task:(pin|unpin):(.+)$/, async (ctx) => handleTaskPin(ctx, ctx.match[2]!, ctx.match[1] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):(pin|unpin):(.+)$/, async (ctx) => handleItemPin(ctx, ctx.match[1]!, ctx.match[3]!, ctx.match[2] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):open:([^:]+)(?::(\d+))?$/, async (ctx) => handleItemOpen(ctx, ctx.match[1]!, ctx.match[2]!, ctx.match[3]));
  bot.callbackQuery(/^item:note:page:([^:]+):(\d+)$/, async (ctx) => handleNoteDetailPage(ctx, ctx.match[1]!, ctx.match[2]!));
  bot.callbackQuery(/^archived-note:page:([^:]+):(\d+)$/, async (ctx) => handleArchivedNoteDetailPage(ctx, ctx.match[1]!, ctx.match[2]!));
  bot.callbackQuery(/^item:idea:brief:(.+)$/, async (ctx) => handleIdeaBrief(ctx, ai, ctx.match[1]!));
  bot.callbackQuery(/^item:note:archive:(.+)$/, async (ctx) => handleNoteArchive(ctx, ctx.match[1]!));
  bot.callbackQuery(/^item:(task|note|idea):edit:(title|description|body|concept):(.+)$/, async (ctx) => handleItemEdit(ctx, ctx.match[1]!, ctx.match[3]!, ctx.match[2]!));
  bot.callbackQuery(/^item:(task|note|idea):edit:(.+)$/, async (ctx) => handleItemEdit(ctx, ctx.match[1]!, ctx.match[2]!, "title"));
  bot.callbackQuery(/^merge:(confirm|retry|cancel):(.+)$/, async (ctx) => handleNoteMergeCallback(ctx, ai, ctx.match[1]!, ctx.match[2]!));
  bot.callbackQuery(/^archived:(notes|ideas|tasks):(\d+)$/, async (ctx) => handleArchivedPage(ctx, ctx.match[1]!, ctx.match[2]!));
  bot.callbackQuery(/^search:([^:]+):(\d+)$/, async (ctx) => handleSearchPage(ctx, ctx.match[1]!, ctx.match[2]!));
  bot.callbackQuery("undo:last", async (ctx) => handleUndoLast(ctx));
  bot.callbackQuery("edit:cancel", async (ctx) => handleEditCancel(ctx));
  bot.callbackQuery(/^capture:(task|reminder|idea|note|choose|back|ignore):(.+)$/, async (ctx) => {
    await handleCapture(ctx, ai, ctx.match[1]!, ctx.match[2]!);
  });
  bot.callbackQuery(/^image:(note|task|reminder|text|discard):(.+)$/, async (ctx) => {
    await handleImageAction(ctx, ai, ctx.match[1]!, ctx.match[2]!);
  });
  // Expenses are frozen; buttons on old expense cards get a clear answer instead of a spinner.
  bot.callbackQuery(/^expense:/, async (ctx) => ctx.answerCallbackQuery({ text: "Expenses are no longer available in Telegram." }));
  bot.callbackQuery(/^bulk:(confirm|cancel):(.+)$/, async (ctx) => {
    await handleBulkAction(ctx, ctx.match[1]!, ctx.match[2]!);
  });
  bot.callbackQuery(/^list:(tasks|notes|ideas):(\d+)$/, async (ctx) => {
    await handleActiveListPage(ctx, ctx.match[1]!, ctx.match[2]!);
  });
  bot.callbackQuery(/^list:choose:(tasks|notes|ideas):(\d+)$/, async (ctx) => {
    await handleActiveListPage(ctx, ctx.match[1]!, ctx.match[2]!, true);
  });
  bot.callbackQuery(/^stored-image:page:(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const page = await replyStoredImageList(ctx, user.id, user.settings.timezone, Number(ctx.match[1]), true);
    await ctx.answerCallbackQuery({ text: `Page ${page}` });
  });
  bot.callbackQuery(/^stored-image:search:([^:]+):(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const result = await replyStoredImageSearch(ctx, user.id, "", user.settings.timezone, Number(ctx.match[2]), ctx.match[1]!, "all", true);
    await ctx.answerCallbackQuery({ text: `Page ${result.page}` });
  });
  bot.callbackQuery(/^stored-image:choose:(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const page = await replyStoredImageList(ctx, user.id, user.settings.timezone, Number(ctx.match[1]), true, true);
    await ctx.answerCallbackQuery({ text: `Choose from page ${page}` });
  });
  bot.callbackQuery(/^stored-image:pick:([^:]+):(\d+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const result = await replyStoredImageSearch(ctx, user.id, "", user.settings.timezone, Number(ctx.match[2]), ctx.match[1]!, "all", true, true);
    await ctx.answerCallbackQuery({ text: `Choose from page ${result.page}` });
  });
  bot.callbackQuery(/^stored-image:open:(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.answerCallbackQuery({ text: "Opening image" });
    await replyStoredImage(ctx, user.id, ctx.match[1]!, true);
  });
  bot.callbackQuery(/^stored-image:caption:(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const item = await beginPendingItemEdit(user.id, "image", ctx.match[1]!, "caption");
    await ctx.answerCallbackQuery({ text: "Send the new caption" });
    await editOrReplyHtml(ctx, formatEditStarted(item), { reply_markup: editCancelKeyboard() });
  });
  bot.callbackQuery(/^stored-image:delete:(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    const image = await findStoredImageById(user.id, ctx.match[1]!);
    await ctx.answerCallbackQuery({ text: "Please confirm" });
    await editOrReplyHtml(ctx, formatStoredImageDeletePrompt(image), { reply_markup: storedImageDeleteKeyboard(image.id) });
  });
  bot.callbackQuery(/^stored-image:delete-(confirm|cancel):(.+)$/, async (ctx) => {
    const user = await ensureUser(ctx);
    if (ctx.match[1] === "cancel") {
      await ctx.answerCallbackQuery({ text: "Image kept" });
      await editOrReplyText(ctx, "Kept it. Nothing changed.", { reply_markup: menuBackKeyboard() });
      return;
    }
    const image = await deleteStoredImage(user.id, ctx.match[2]!);
    await ctx.answerCallbackQuery({ text: "Image deleted" });
    await editOrReplyHtml(ctx, `${bold("🗑️ Image deleted")} ${code(image.publicId)}\nThe original Telegram message is untouched.`, { reply_markup: menuBackKeyboard() });
  });
  bot.callbackQuery(/^setting:(.+)$/, async (ctx) => handleSettingCallback(ctx, ctx.match[1]!));
  bot.callbackQuery(/^integration:(calendar|excel):(.+)$/, async (ctx) => handleIntegrationAction(ctx, ctx.match[1]!, ctx.match[2]!));
  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => handleMenu(ctx, ctx.match[1]!));
}

const SETTING_FIELDS = new Set<SettingChoiceField>(["interval", "mode", "quiet", "due-nudge", "max", "timezone", "currency", "ocr", "dm"]);

const SETTING_PICKER_COPY: Record<SettingChoiceField, { title: string; instruction: string }> = {
  interval: { title: "🔁 Repeat interval", instruction: "How often should an unfinished task remind you again?" },
  mode: { title: "📝 Reminder style", instruction: "Compact groups reminders together; detailed sends fuller cards." },
  quiet: { title: "🌙 Quiet hours", instruction: "Threadwise holds reminder messages during this window." },
  "due-nudge": { title: "⏱ Early warning", instruction: "How early should exact-time reminders begin?" },
  max: { title: "🛡 Daily safety limit", instruction: "A guardrail against accidental reminder loops—not a task limit." },
  timezone: { title: "🌍 Timezone", instruction: "This controls how Threadwise reads and displays times." },
  currency: { title: "💱 Default currency", instruction: "Used when an expense does not name a currency." },
  ocr: { title: "🖼 Image text language", instruction: "Choose the languages used for local OCR." },
  dm: { title: "📩 Private nudges", instruction: "Also DM you when a group task assigned to you is due." }
};

/**
 * Handles every `setting:` button: opening a submenu, showing preset choices, starting a typed
 * custom value, cancelling, and applying a value (which writes the setting). In groups only a
 * Telegram admin may change the shared settings. Any pending typed input is cleared first so a
 * stale prompt cannot catch the next message.
 */
async function handleSettingCallback(ctx: Context, action: string) {
  const user = await ensureUser(ctx);
  if (!ctx.from) return;
  if (isGroupChat(ctx) && !(await isGroupManager(ctx))) {
    await ctx.answerCallbackQuery({ text: "Only group admins can change shared settings.", show_alert: true });
    return;
  }
  rememberCallbackControlCard(ctx);
  clearMenuInput(user.id, ctx.from.id);

  if (action === "reminders" || action === "region") {
    await ctx.answerCallbackQuery();
    await showSettingPanel(ctx, user.id, action);
    return;
  }

  if (action === "voice") {
    await ctx.answerCallbackQuery();
    await editOrReplyHtml(ctx, await formatVoiceSettings(user.id), { reply_markup: voiceSettingsKeyboard() });
    return;
  }

  const voiceApply = action.match(/^voice-apply:(cleanup|model|audio):(.+)$/);
  if (voiceApply?.[1] && voiceApply[2]) {
    await ctx.answerCallbackQuery({ text: "Saving…" });
    await updateSetting(user.id, ["voice", voiceApply[1], voiceApply[2]]);
    await editOrReplyHtml(ctx, await formatVoiceSettings(user.id), { reply_markup: voiceSettingsKeyboard() });
    return;
  }

  const picker = action.match(/^pick:([^:]+)$/)?.[1];
  if (isSettingField(picker)) {
    await ctx.answerCallbackQuery();
    const copy = SETTING_PICKER_COPY[picker];
    await editOrReplyHtml(ctx, `${bold(copy.title)}\n${h(copy.instruction)}`, { reply_markup: settingChoicesKeyboard(picker) });
    return;
  }

  const custom = action.match(/^custom:([^:]+)$/)?.[1];
  if (isSettingField(custom)) {
    const setup = customSettingInput(custom);
    if (!setup) {
      await ctx.answerCallbackQuery({ text: "Choose one of the buttons." });
      return;
    }
    beginMenuInput(user.id, ctx.from.id, setup.action);
    await ctx.answerCallbackQuery({ text: "Send the custom value next" });
    await editOrReplyHtml(ctx, `${bold(setup.title)}\n${h(setup.prompt)}`, { reply_markup: settingInputKeyboard(setup.parent) });
    return;
  }

  const cancel = action.match(/^cancel:(reminders|region)$/)?.[1] as "reminders" | "region" | undefined;
  if (cancel) {
    clearMenuInput(user.id, ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Canceled" });
    await showSettingPanel(ctx, user.id, cancel);
    return;
  }

  const apply = action.match(/^apply:([^:]+):(.+)$/);
  if (isSettingField(apply?.[1]) && apply?.[2]) {
    await ctx.answerCallbackQuery({ text: "Saving…" });
    await updateSetting(user.id, settingArguments(apply[1], apply[2]));
    await showSettingPanel(ctx, user.id, settingParent(apply[1]));
    return;
  }

  await ctx.answerCallbackQuery({ text: "That setting is no longer available." });
}

/** Idea brief button: scores the idea with the AI provider and shows the result on the same card. */
async function handleIdeaBrief(ctx: Context, ai: AiProvider, reference: string) {
  const user = await ensureUser(ctx);
  rememberCallbackControlCard(ctx);
  await ctx.answerCallbackQuery({ text: "Analyzing the idea…" });
  const result = await scoreIdea(user.id, reference, ai);
  await editOrReplyHtml(ctx, formatIdeaScore(result.publicId, result.score), {
    reply_markup: ideaBriefKeyboard(result.publicId)
  });
}

async function showSettingPanel(ctx: Context, userId: string, parent: "reminders" | "region") {
  if (parent === "region") {
    await editOrReplyHtml(ctx, await formatRegionSettings(userId), { reply_markup: regionSettingsKeyboard() });
    return;
  }
  await editOrReplyHtml(ctx, await formatReminderSettings(userId), { reply_markup: reminderSettingsKeyboard() });
}

function isSettingField(value: string | undefined): value is SettingChoiceField {
  return Boolean(value && SETTING_FIELDS.has(value as SettingChoiceField));
}

function settingParent(field: SettingChoiceField): "reminders" | "region" {
  return ["timezone", "currency", "ocr", "dm"].includes(field) ? "region" : "reminders";
}

/** Converts a button value into the argument list `updateSetting` expects, expanding quiet-hour presets into two times. */
function settingArguments(field: SettingChoiceField, value: string): string[] {
  if (field === "quiet" && value === "22-08") return ["quiet", "22:00", "08:00"];
  if (field === "quiet" && value === "23-07") return ["quiet", "23:00", "07:00"];
  return [field, value];
}

/** Prompt copy and menu-input mode for a setting that accepts a typed custom value; undefined for button-only settings. */
function customSettingInput(field: SettingChoiceField): { action: MenuInputAction; title: string; prompt: string; parent: "reminders" | "region" } | undefined {
  const inputs: Partial<Record<SettingChoiceField, { action: MenuInputAction; title: string; prompt: string }>> = {
    interval: { action: "setting-interval", title: "🔁 Custom repeat interval", prompt: "Send minutes, such as 90. Minimum: 15." },
    quiet: { action: "setting-quiet", title: "🌙 Custom quiet hours", prompt: "Send two 24-hour times, such as 22:30 07:00, or send off." },
    "due-nudge": { action: "setting-due-nudge", title: "⏱ Custom early warning", prompt: "Send minutes, such as 15, or send off." },
    max: { action: "setting-max", title: "🛡 Custom daily limit", prompt: "Send the maximum reminder messages per day, such as 200." },
    timezone: { action: "setting-timezone", title: "🌍 Other timezone", prompt: "Send a city or timezone, such as Bangkok or America/New_York." },
    currency: { action: "setting-currency", title: "💱 Other currency", prompt: "Send an ISO code or currency name, such as EUR or kyat." }
  };
  const input = inputs[field];
  return input ? { ...input, parent: settingParent(field) } : undefined;
}

/**
 * Handles every `menu:` button by editing the tapped card into the requested menu screen.
 * It first cancels any "your next message is input" prompt so navigation never leaves a hidden
 * mode behind. In groups it prefers a receiver-bound ephemeral reply so one member's menu does
 * not clutter the chat. "Add" and "Search" entries start a menu input: in private the next message
 * is the answer, while in groups the member must reply to a force-reply prompt.
 */
async function handleMenu(ctx: Context, action: string) {
  const user = await ensureUser(ctx);
  if (!ctx.from) return;
  const group = isGroupChat(ctx);
  if (group) preferEphemeralInteraction(ctx);
  const workspace = group ? await groupWorkspaceForContext(ctx) : undefined;
  await cancelTransientInteractions(user.id, ctx.from.id);
  await ctx.answerCallbackQuery();
  rememberCallbackControlCard(ctx);
  if (action === "home") {
    await editOrReplyHtml(ctx, group
      ? formatGroupMainMenuText(workspace?.title ?? "Shared workspace", user.settings.timezone)
      : formatMainMenuText(user.settings.timezone), {
      reply_markup: group ? groupStartMenuKeyboard(workspace?.id) : startMenuKeyboard()
    });
    return;
  }
  if (action === "group-library" && group) {
    await editOrReplyHtml(ctx, `${bold("Capture & recall")}\nChoose what you want to keep or find.`, {
      reply_markup: groupLibraryMenuKeyboard(workspace?.id),
    });
    return;
  }
  if (action === "group-more" && group) {
    await editOrReplyHtml(ctx, `${bold("More")}\nHelp and shared workspace settings.`, {
      reply_markup: groupMoreMenuKeyboard(workspace?.id),
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
  if (action === "notes-session") {
    if (group) {
      await editOrReplyHtml(ctx, `${bold("Note sessions are private")}\nOpen Threadwise directly, then choose Notes → Note session.`, {
        reply_markup: menuBackKeyboard("‹ Shared notes", "menu:notes")
      });
      return;
    }
    await beginNoteSession(ctx, user.id);
    return;
  }
  if (action === "ideas") {
    await editOrReplyHtml(ctx, `${bold("💡 Ideas")}\nCapture an idea now; shape, score, or build it later.`, { reply_markup: ideasModeKeyboard() });
    return;
  }
  if (action === "images") {
    await editOrReplyHtml(ctx, `${bold(group ? "🖼️ Shared images" : "🖼️ Images")}\nBrowse saved images here, or open the visual gallery on the dashboard.`, { reply_markup: group ? groupImagesModeKeyboard(workspace?.id) : imagesModeKeyboard() });
    return;
  }
  if (action === "expenses") {
    await editOrReplyHtml(ctx, group
      ? formatGroupMainMenuText(workspace?.title ?? "Shared workspace", user.settings.timezone)
      : formatMainMenuText(user.settings.timezone), { reply_markup: group ? groupStartMenuKeyboard(workspace?.id) : startMenuKeyboard() });
    return;
  }
  if (action === "search") {
    await editOrReplyHtml(ctx, `${bold("🔎 Search")}\nFind anything across tasks, notes, ideas, and saved images.`, { reply_markup: searchModeKeyboard() });
    return;
  }
  if (action === "settings") {
    await editOrReplyHtml(ctx, group
      ? `${bold("⚙️ Group settings")}\nThese defaults belong only to this shared workspace. Telegram group admins can change them.`
      : await formatSettings(user.id), {
      reply_markup: group ? groupSettingsModeKeyboard(workspace?.id) : settingsModeKeyboard()
    });
    return;
  }
  if (action === "tasks-list" || action === "notes-list" || action === "ideas-list") {
    await replyActiveList(ctx, user, action.slice(0, -5) as "tasks" | "notes" | "ideas", 1, true);
    return;
  }
  if (action === "images-list") {
    await replyStoredImageList(ctx, user.id, user.settings.timezone, 1, true);
    return;
  }
  if (action === "preferences") {
    await editOrReplyHtml(ctx, await formatReminderSettings(user.id), { reply_markup: reminderSettingsKeyboard() });
    return;
  }
  if (action === "help") {
    await editOrReplyHtml(ctx, group ? formatGroupHelpGuide(ctx.me.username) : formatHelpGuide(), {
      reply_markup: group ? groupHelpTopicsKeyboard(workspace?.id) : helpTopicsKeyboard()
    });
    return;
  }
  if (action === "integrations") {
    if (group) {
      await editOrReplyHtml(ctx, `${bold("📅 Google Calendar stays personal")}\nConnect Calendar from your private Threadwise settings.`, { reply_markup: menuBackKeyboard("‹ Group settings", "menu:settings") });
      return;
    }
    await editOrReplyHtml(ctx, `${bold("📅 Google Calendar")}\nOptionally keep dated tasks on your calendar.`, { reply_markup: integrationsSettingsKeyboard() });
    return;
  }
  if (action === "calendar-settings") {
    await showCalendarPanel(ctx, user.id, user.telegramId);
    return;
  }
  if (action === "excel" || action === "excel-settings") {
    await editOrReplyHtml(ctx, await formatSettings(user.id), { reply_markup: settingsModeKeyboard() });
    return;
  }
  if (action === "privacy") {
    if (group) {
      await editOrReplyHtml(ctx, formatGroupPrivacyText(), { reply_markup: menuBackKeyboard("‹ Group help", "menu:help") });
      return;
    }
    await editOrReplyHtml(ctx, [
      bold("🔐 Data & privacy"),
      "Telegram verifies who you are; database credentials never reach your browser.",
      "Saved content is user-scoped and provider tokens are encrypted, but content is not end-to-end encrypted. Operational access remains possible for maintenance."
    ].join("\n"), { reply_markup: privacySettingsKeyboard() });
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
    await editOrReplyHtml(ctx, formatArchivedPage(archived, user.settings.timezone), {
      reply_markup: archivedPageKeyboard(archivedKind, archived.page, archived.totalPages)
    });
    return;
  }
  const inputs: Record<string, { action: MenuInputAction; title: string; prompt: string; replyObject: string; back: string }> = {
    "tasks-add": { action: "task", title: "＋ Add task", prompt: "What needs doing? A due date is optional.", replyObject: "the task you want to add", back: "tasks" },
    "tasks-reminder": { action: "reminder", title: "⏰ Set reminder", prompt: "What should I remind you about, and when?", replyObject: "the reminder and its time", back: "tasks" },
    "notes-add": { action: "note", title: "＋ Add note", prompt: "What do you want to keep?", replyObject: "the note you want to save", back: "notes" },
    "ideas-add": { action: "idea", title: "＋ Add idea", prompt: "What idea do you want to capture?", replyObject: "the idea you want to save", back: "ideas" },
    "ideas-brief": { action: "idea-brief", title: "✨ Idea brief", prompt: "Which idea should I analyze?", replyObject: "its list number or ID, such as 2 or IDEA-2", back: "ideas" },
    "search-input": { action: "search", title: "🔎 Search", prompt: "What are you looking for?", replyObject: "what you want to find", back: "search" },
    "notes-search": { action: "note-search", title: "🔎 Search notes", prompt: "What should I look for?", replyObject: "the note words you remember", back: "notes" },
    "ideas-search": { action: "idea-search", title: "🔎 Search ideas", prompt: "What should I look for?", replyObject: "the idea words you remember", back: "ideas" },
    "images-search": { action: "image-search", title: "🔎 Find an image", prompt: "What do you remember about it?", replyObject: "a caption, filename, or text inside the image", back: "images" }
  };
  const input = inputs[action];
  if (input) {
    beginMenuInput(user.id, ctx.from.id, input.action);
    await editOrReplyHtml(ctx, `${bold(input.title)}\n${h(input.prompt)}\n\n${h(group ? `Reply to this message with ${input.replyObject}.` : "Send your answer as the next message.")}`, {
      reply_markup: group
        ? { force_reply: true, selective: true, input_field_placeholder: input.prompt.slice(0, 64) }
        : menuInputCancelKeyboard(input.back)
    });
    return;
  }
  if (action === "cancel-input") {
    clearMenuInput(user.id, ctx.from.id);
    await editOrReplyHtml(ctx, `${bold("Canceled")}\nNothing was changed.`, { reply_markup: group ? groupStartMenuKeyboard(workspace?.id) : startMenuKeyboard() });
    return;
  }
  const topics: Record<string, "reminders" | "notes" | "ideas" | "images" | "commands"> = {
    reminders: "reminders",
    "notes-help": "notes",
    "ideas-help": "ideas",
    "images-help": "images",
    commands: "commands"
  };
  const topic = topics[action];
  if (topic) {
    if (group && topic === "commands") {
      await editOrReplyHtml(ctx, formatGroupCommandReference(), { reply_markup: menuBackKeyboard("‹ Group help", "menu:help") });
      return;
    }
    await editOrReplyHtml(ctx, group ? formatGroupHelpTopic(topic, ctx.me.username) : formatHelpTopic(topic), { reply_markup: menuBackKeyboard("‹ Help", "menu:help") });
  }
}

/** Page and "Choose an item" buttons on task, note, and idea lists. Ignores malformed page numbers. */
async function handleActiveListPage(ctx: Context, kindText: string, pageText: string, selecting = false) {
  if (!isActiveListKind(kindText)) return;
  const requestedPage = Number(pageText);
  if (!Number.isInteger(requestedPage) || requestedPage < 1) return;
  const user = await ensureUser(ctx);
  const page = await replyActiveList(ctx, user, kindText, requestedPage, true, undefined, selecting);
  await ctx.answerCallbackQuery({ text: selecting ? `Choose from page ${page}` : `Page ${page}` });
}

/**
 * Confirm or cancel on a bulk action preview. The service checks that the tapper is the person
 * who requested the preview, so another member cannot confirm it.
 */
async function handleBulkAction(ctx: Context, action: string, pendingId: string) {
  if (!ctx.from?.id) return;
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
    await editOrReplyText(ctx, userFacingError(error, "I couldn't complete that bulk action."), { reply_markup: menuBackKeyboard() });
  }
}

/**
 * Buttons on an image's extracted-text preview. View full text and "set reminder" (which waits
 * for a typed time) keep the pending capture; Discard deletes it, and Save as note or task
 * consumes it so a second tap cannot save twice.
 */
async function handleImageAction(ctx: Context, ai: AiProvider, action: string, pendingId: string) {
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
    const consumed = await consumePendingImageCapture(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: "Saving" });
    if (action === "note") {
      const note = await createNote(user.id, consumed.extractedText, ai);
      await editOrReplyQuietAcknowledgementHtml(ctx, formatNoteSavedAcknowledgement(note));
      return;
    }
    await saveTaskFromTelegram(ctx, user, consumed.extractedText, { edit: true });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Action expired or failed" });
    await editOrReplyText(ctx, userFacingError(error, "I couldn't finish that image action."), { reply_markup: menuBackKeyboard() });
  }
}

/** Claim button on an unassigned group task. The service makes the claim race-safe; a refusal shows as an alert. */
async function handleTaskClaim(ctx: Context, taskId: string) {
  if (!isGroupChat(ctx)) return;
  const { taskUser: user } = await taskCallbackUsers(ctx, taskId);
  try {
    const task = await claimGroupTask(user.id, taskId, collaborationActorFromContext(ctx));
    const keyboard = await groupTaskKeyboardForContext(ctx, user.id, task.id, true);
    await ctx.answerCallbackQuery({ text: "Task claimed" });
    await editOrReplyHtml(ctx, formatTaskDetail(task, user.settings.timezone), { reply_markup: keyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: userFacingError(error, "I couldn't claim that task.").slice(0, 180), show_alert: true });
  }
}

/**
 * Handles a Done button tap (`task:done:<id>` or `task:done:<id>:<due ms>`).
 * `dueMs` is the due time the card showed; older cards don't carry it.
 * After completing, it replaces the card with the task list and retires the chat's previous task
 * control message, so only one live set of task controls stays in the chat.
 */
async function handleTaskDone(ctx: Context, taskId: string, dueMs: string | undefined) {
  const shownDueAt = dueMs ? new Date(Number(dueMs)) : undefined;
  const { interactionUser, taskUser: user } = await taskCallbackUsers(ctx, taskId);
  const completion = await executeButtonTaskCommand(ctx, user.id, { action: "complete", ref: taskId, expectedDueAt: shownDueAt }, "You cannot complete that task.");
  if (!completion || completion.action !== "complete") return;
  if (completion.status === "stale") {
    await ctx.answerCallbackQuery({ text: "This card is out of date. Open the task to see when it's next due.", show_alert: true });
    return;
  }
  if (completion.status === "already-completed") {
    await ctx.answerCallbackQuery({ text: "Already completed" });
    await editOrReplyHtml(ctx, formatTaskAlreadyCompleted(completion.task), { reply_markup: restoreCompletedTaskKeyboard(completion.task.id) });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Completed" });
  const controlSurface = await replyActiveListWithMessage(
    ctx,
    user,
    "tasks",
    listOrigin(user.id, "task") ?? 1,
    true,
    user.id === interactionUser.id ? { label: "↩️ Undo complete", callbackData: "undo:last" } : undefined,
  );
  await convergeTaskControlSurface(ctx, user.id, controlSurface.messageId);
}

/** Restore button on a completed task: reopens it. Undo is offered when the tapper resolves to the task's owner (every member, for group tasks owned by the chat). */
async function handleTaskRestore(ctx: Context, taskId: string) {
  const { interactionUser, taskUser: user } = await taskCallbackUsers(ctx, taskId);
  if (isGroupChat(ctx) && !(await allowGroupTaskAction(ctx, user.id, taskId, "manage"))) return;
  const result = await restoreCompletedTask(user.id, taskId);
  if (!result.restored) {
    await ctx.answerCallbackQuery({ text: "Task is already open" });
    const card = await buildItemCard(user.id, "task", result.task.publicId, user.settings.timezone, "Task already open", false);
    appendListOrigin(card.keyboard, user.id, "task");
    await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Restored" });
  const card = await buildItemCard(user.id, "task", result.task.publicId, user.settings.timezone, "↩️ Task restored", false);
  appendListOrigin(card.keyboard, user.id, "task");
  if (user.id === interactionUser.id) card.keyboard.row().text("↩️ Undo restore", "undo:last");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
}

/** Snooze button: moves the task's next reminder to one hour from now, through the shared task executor. Undoable. */
async function handleTaskSnooze(ctx: Context, taskId: string) {
  const { interactionUser, taskUser: user } = await taskCallbackUsers(ctx, taskId);
  const snoozed = await executeButtonTaskCommand(ctx, user.id, { action: "snooze", ref: taskId, duration: "1h" }, "You cannot snooze that task.");
  if (!snoozed) return;
  const { task } = snoozed;
  await ctx.answerCallbackQuery({ text: "Snoozed 1 hour" });
  const card = await buildItemCard(user.id, "task", task.publicId, user.settings.timezone, "⏰ Snoozed for an hour", false);
  const keyboard = isGroupChat(ctx) ? await groupTaskKeyboardForContext(ctx, user.id, task.id, true) : card.keyboard;
  if (!isGroupChat(ctx)) {
    appendListOrigin(keyboard, user.id, "task");
    if (user.id === interactionUser.id) keyboard.row().text("↩️ Undo snooze", "undo:last");
  }
  await editOrReplyHtml(ctx, card.text, { reply_markup: keyboard });
}

/**
 * "Dismiss reminders" button: stops further reminders for the task without completing it.
 * In groups it needs the same permission as snoozing.
 */
async function handleTaskReminderDismiss(ctx: Context, taskId: string) {
  const { taskUser: user } = await taskCallbackUsers(ctx, taskId);
  if (isGroupChat(ctx)) {
    try {
      await assertGroupTaskActionForContext(ctx, user.id, taskId, "snooze");
    } catch (error) {
      await ctx.answerCallbackQuery({ text: userFacingError(error, "You cannot dismiss reminders for that task.").slice(0, 180), show_alert: true });
      return;
    }
  }
  const task = await dismissTaskReminders(user.id, taskId);
  await ctx.answerCallbackQuery({ text: "Reminders dismissed" });
  const card = await buildItemCard(user.id, "task", task.publicId, user.settings.timezone, "Reminders dismissed for this task", false);
  const keyboard = isGroupChat(ctx) ? await groupTaskKeyboardForContext(ctx, user.id, task.id, true) : card.keyboard;
  await editOrReplyHtml(ctx, card.text, { reply_markup: keyboard });
}

/** Toggles a reminder card between the short reminder text and the full task detail, keeping the right buttons for each. */
async function handleTaskReminderView(ctx: Context, taskId: string, expanded: boolean) {
  const { taskUser: user } = await taskCallbackUsers(ctx, taskId);
  try {
    const task = await findTaskReference(user.id, taskId);
    const timezone = user.settings.timezone;
    const includeCollaboration = isGroupChat(ctx);

    if (expanded) {
      const keyboard = includeCollaboration
        ? await groupTaskKeyboardForContext(ctx, user.id, task.id, true, `task:view-summary:${task.id}`)
        : taskActionsKeyboard(task, true).row().text("‹ Reminder", `task:view-summary:${task.id}`);
      await ctx.answerCallbackQuery({ text: "Full reminder" });
      await editOrReplyHtml(ctx, formatTaskDetail(task, timezone), { reply_markup: keyboard });
      return;
    }

    const reminderMode = user.settings.reminderMode;
    await ctx.answerCallbackQuery({ text: "Reminder" });
    await editOrReplyHtml(ctx, formatReminderMessage(task, { timezone, reminderMode }), {
      reply_markup: includeCollaboration
        ? await groupTaskKeyboardForContext(ctx, user.id, task.id, false)
        : reminderActionsKeyboard(task)
    });
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: userFacingError(error, "I couldn't open that reminder. Try /tasks for a fresh copy.").slice(0, 180),
      show_alert: true
    });
  }
}

/**
 * Calendar button on a task card (private chats only, since Calendar is a personal connection).
 * Needs a due date. If Calendar is not connected it shows the connect card; otherwise it adds the
 * task to Google Calendar if it is not there yet.
 */
async function handleTaskCalendar(ctx: Context, taskId: string) {
  if (isGroupChat(ctx)) {
    await ctx.answerCallbackQuery({ text: "Calendar connections are private.", show_alert: true });
    return;
  }
  const user = await ensureUser(ctx);
  try {
    let task = await findTaskReference(user.id, taskId);
    if (!task.dueAt) {
      await ctx.answerCallbackQuery({ text: "Add a due date first.", show_alert: true });
      return;
    }
    const connect = await calendarTaskConnectCard(user.id, ctx.chat ? String(ctx.chat.id) : user.telegramId, task);
    if (connect) {
      await ctx.answerCallbackQuery({ text: connect.reconnectRequired ? "Reconnect Calendar" : "Connect Calendar once" });
      await editOrReplyHtml(ctx, connect.text, { reply_markup: connect.keyboard });
      return;
    }
    if (!task.calendarEventId) {
      const synced = await syncTaskToGoogleCalendar(user.id, task);
      if (!synced) throw new Error("Reconnect Google Calendar and try again.");
      task = await findTaskReference(user.id, task.id);
      await ctx.answerCallbackQuery({ text: "Added to Calendar" });
    } else {
      await ctx.answerCallbackQuery({ text: "Calendar event" });
    }
    await editOrReplyHtml(ctx, `${bold("📅 In Google Calendar")}\n${h(task.title)}\nEdits to this dated task update the same event.`, {
      reply_markup: calendarTaskKeyboard(task)
    });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: userFacingError(error, "Calendar could not be updated.").slice(0, 180), show_alert: true });
  }
}

/**
 * Google Calendar buttons from the settings panel and task cards: sync all dated tasks, toggle
 * automatic sync (writes `UserSettings.calendarAutoSync`), disconnect (with a confirm step), and
 * add or remove one task's event. Removing an event never changes the Threadwise task.
 */
async function handleIntegrationAction(ctx: Context, provider: string, action: string) {
  if (isGroupChat(ctx)) {
    await ctx.answerCallbackQuery({ text: "Personal connections are available in private chat.", show_alert: true });
    return;
  }
  const user = await ensureUser(ctx);
  try {
    if (provider === "calendar") {
      if (action === "sync-all") {
        await ctx.answerCallbackQuery({ text: "Syncing dated tasks…" });
        const result = await syncEligibleTasksToGoogleCalendar(user.id);
        await showCalendarPanel(ctx, user.id, user.telegramId, `${result.synced} task${result.synced === 1 ? "" : "s"} synced${result.failed ? `; ${result.failed} need another try` : ""}.`);
        return;
      }
      if (action === "toggle-auto") {
        const status = await calendarConnectionStatus(user.id);
        await prisma.userSettings.update({ where: { userId: user.id }, data: { calendarAutoSync: !status.autoSync } });
        await ctx.answerCallbackQuery({ text: `Automatic sync ${status.autoSync ? "off" : "on"}` });
        await showCalendarPanel(ctx, user.id, user.telegramId);
        return;
      }
      if (action === "disconnect-confirm") {
        await ctx.answerCallbackQuery();
        await editOrReplyHtml(ctx, `${bold("Disconnect Google Calendar?")}\nExisting events will stay in Google Calendar.`, { reply_markup: disconnectIntegrationKeyboard("calendar") });
        return;
      }
      if (action === "disconnect") {
        await disconnectCalendar(user.id);
        await ctx.answerCallbackQuery({ text: "Calendar disconnected" });
        await showCalendarPanel(ctx, user.id, user.telegramId);
        return;
      }
      const taskAction = action.match(/^(sync|remove):(.+)$/);
      if (taskAction?.[1] && taskAction[2]) {
        let task = await findTaskReference(user.id, taskAction[2]);
        if (taskAction[1] === "remove") {
          await removeTaskFromGoogleCalendar(user.id, task);
          task = await findTaskReference(user.id, task.id);
          await ctx.answerCallbackQuery({ text: "Removed from Calendar" });
          await editOrReplyHtml(ctx, `${bold("📅 Removed from Google Calendar")}\n${h(task.title)}\nThe Threadwise task is unchanged.`, { reply_markup: calendarTaskKeyboard(task) });
          return;
        }
        const synced = await syncTaskToGoogleCalendar(user.id, task);
        if (!synced) throw new Error("Connect Google Calendar first.");
        task = await findTaskReference(user.id, task.id);
        await ctx.answerCallbackQuery({ text: synced.created ? "Added to Calendar" : "Calendar updated" });
        await editOrReplyHtml(ctx, `${bold("📅 Calendar updated")}\n${h(task.title)}`, { reply_markup: calendarTaskKeyboard(task) });
        return;
      }
    }

    await ctx.answerCallbackQuery({ text: "That connection action is no longer available." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: userFacingError(error, "The connection could not be updated.").slice(0, 180), show_alert: true });
  }
}

/** Redraws the Calendar settings card, with a fresh connect link when not connected and an optional notice on top. */
async function showCalendarPanel(ctx: Context, userId: string, chatId: string, notice?: string) {
  const status = await calendarConnectionStatus(userId);
  const connectUrl = !status.connected && calendarConfigured()
    ? await createCalendarConnectUrl(userId, chatId, { enableAutoSync: true })
    : undefined;
  await editOrReplyHtml(ctx, [notice ? h(notice) : undefined, await formatCalendarStatus(userId, status)].filter(Boolean).join("\n\n"), {
    reply_markup: calendarSettingsKeyboard(status, connectUrl)
  });
}

/**
 * Cancel button on a task. A private task with a Calendar event first asks whether to remove the
 * event too; otherwise it cancels right away and shows the task list with Undo.
 */
async function handleTaskCancel(ctx: Context, taskId: string) {
  const { interactionUser, taskUser: user } = await taskCallbackUsers(ctx, taskId);
  if (!isGroupChat(ctx)) {
    const task = await findTaskReference(user.id, taskId);
    if (task.calendarEventId) {
      await ctx.answerCallbackQuery({ text: "Choose what happens to the event" });
      await editOrReplyHtml(ctx, `${bold("Cancel this task?")}\n${h(task.title)}\nIt also has a Google Calendar event.`, { reply_markup: taskCancelCalendarKeyboard(task.id) });
      return;
    }
  }
  if (!(await executeButtonTaskCommand(ctx, user.id, { action: "cancel", ref: taskId }, "That action is not available to you."))) return;
  await ctx.answerCallbackQuery({ text: "Canceled task" });
  await replyActiveList(
    ctx,
    user,
    "tasks",
    listOrigin(user.id, "task") ?? 1,
    true,
    user.id === interactionUser.id ? { label: "↩️ Undo cancel", callbackData: "undo:last" } : undefined,
  );
}

/** Second step of cancelling a Calendar-linked task. The cancel is saved even if removing the Google event fails. */
async function handleTaskCancelConfirmed(ctx: Context, taskId: string, removeEvent: boolean) {
  const { interactionUser, taskUser: user } = await taskCallbackUsers(ctx, taskId);
  const canceled = await executeButtonTaskCommand(ctx, user.id, { action: "cancel", ref: taskId }, "That action is not available to you.");
  if (!canceled) return;
  const { task } = canceled;
  let eventRemoved = false;
  if (removeEvent && task.calendarEventId) {
    try {
      await removeTaskFromGoogleCalendar(user.id, task);
      eventRemoved = true;
    } catch {
      // The Threadwise cancellation remains valid even if Google is temporarily unavailable.
    }
  }
  await ctx.answerCallbackQuery({ text: eventRemoved ? "Task and event canceled" : "Task canceled" });
  await replyActiveList(
    ctx,
    user,
    "tasks",
    listOrigin(user.id, "task") ?? 1,
    true,
    user.id === interactionUser.id ? { label: "↩️ Undo cancel", callbackData: "undo:last" } : undefined,
  );
}

async function handleTaskPin(ctx: Context, taskId: string, shouldPin: boolean) {
  const { taskUser: user } = await taskCallbackUsers(ctx, taskId);
  if (isGroupChat(ctx) && !(await allowGroupTaskAction(ctx, user.id, taskId, "manage"))) return;
  const item = await pinItem(user.id, taskId, shouldPin);
  await ctx.answerCallbackQuery({ text: shouldPin ? "Marked important" : "No longer important" });
  const card = await buildItemCard(user.id, "task", item.publicId, user.settings.timezone, shouldPin ? "⭐ Marked important" : "☆ Removed from important", false);
  appendListOrigin(card.keyboard, user.id, "task");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
}

/** Star or unstar a task, note, or idea from its card. Group tasks need manage permission. */
async function handleItemPin(ctx: Context, kind: string, itemId: string, shouldPin: boolean) {
  if (!isEditableItemKind(kind) || kind === "image") return;
  const interactionUser = await ensureUser(ctx);
  const user = kind === "task"
    ? (await taskCallbackUsers(ctx, itemId, interactionUser)).taskUser
    : interactionUser;
  if (kind === "task" && isGroupChat(ctx) && !(await allowGroupTaskAction(ctx, user.id, itemId, "manage"))) return;
  const item = await pinItem(user.id, itemId, shouldPin);
  await ctx.answerCallbackQuery({
    text: kind === "task"
      ? shouldPin ? "Marked important" : "No longer important"
      : shouldPin ? "Starred" : "Unstarred"
  });
  const card = await buildItemCard(user.id, kind, item.publicId, user.settings.timezone, shouldPin ? "⭐ Starred" : "☆ Unstarred", false);
  appendListOrigin(card.keyboard, user.id, kind);
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
}

/**
 * Edit button: records a `PendingItemEdit` so the tapper's next message becomes the new value.
 * The edit is stored against the person who tapped, but for group tasks it targets the group owner's task.
 */
async function handleItemEdit(ctx: Context, kind: string, itemId: string, field: string) {
  if (!isEditableItemKind(kind)) return;
  const interactionUser = await ensureUser(ctx);
  const taskUser = kind === "task"
    ? (await taskCallbackUsers(ctx, itemId, interactionUser)).taskUser
    : interactionUser;
  if (kind === "task" && isGroupChat(ctx) && !(await allowGroupTaskAction(ctx, taskUser.id, itemId, "manage"))) return;
  const item = await beginPendingItemEdit(
    interactionUser.id,
    kind,
    itemId,
    isEditableItemField(field) ? field : "title",
    taskUser.id,
  );
  await ctx.answerCallbackQuery({ text: "Ready to edit" });
  await editOrReplyHtml(ctx, formatEditStarted(item), { reply_markup: editCancelKeyboard() });
}

async function handleNoteArchive(ctx: Context, noteId: string) {
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
  await editOrReplyHtml(ctx, await undoLastActionForContext(ctx, user.id), { reply_markup: menuBackKeyboard() });
}

async function handleEditCancel(ctx: Context) {
  const user = await ensureUser(ctx);
  const canceled = await cancelPendingItemEdit(user.id);
  await ctx.answerCallbackQuery({ text: canceled ? "Edit canceled" : "No edit pending" });
  await editOrReplyText(ctx, canceled ? "Edit canceled. Everything is unchanged." : "There isn’t an edit waiting right now.", { reply_markup: menuBackKeyboard() });
}

/**
 * Search page buttons. The query is loaded from its `PendingSearch` row and the search is run
 * again for the requested page. An expired row produces a "search expired" reply.
 */
async function handleSearchPage(ctx: Context, pendingId: string, pageText: string) {
  const page = Number(pageText);
  if (!Number.isInteger(page) || page < 1) return;

  const user = await ensureUser(ctx);
  try {
    const parsed = await findPendingSearch(user.id, pendingId);
    const pageSize = 5;
    const results = await semanticSearch(user.id, parsed.query, parsed.kinds, {
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

/**
 * Merge preview buttons. Cancel leaves the notes untouched, Try again regenerates the preview,
 * and Merge creates the merged note and archives the originals (undoable).
 */
async function handleNoteMergeCallback(ctx: Context, ai: AiProvider, action: string, pendingId: string) {
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

    const result = await confirmNoteMerge(user.id, pendingId);
    await ctx.answerCallbackQuery({ text: "Merged" });
    await editOrReplyHtml(ctx, formatNoteMergeConfirmed(result), { reply_markup: undoKeyboard() });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Could not finish merge" });
    await editOrReplyText(ctx, userFacingError(error, "I couldn't finish that merge. Try starting it again from /notes."), { reply_markup: menuBackKeyboard() });
  }
}

function isEditableItemKind(kind: string | undefined): kind is EditableItemKind {
  return kind === "task" || kind === "note" || kind === "idea" || kind === "image";
}

/**
 * Numbered button on a list: opens that item's card. It remembers which list page the user came
 * from so later actions on the card can return to the same page.
 */
async function handleItemOpen(ctx: Context, kind: string, itemId: string, pageText: string | undefined) {
  if (!isEditableItemKind(kind) || kind === "image") return;
  const interactionUser = await ensureUser(ctx);
  const user = kind === "task"
    ? (await taskCallbackUsers(ctx, itemId, interactionUser)).taskUser
    : interactionUser;
  const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
  const card = await buildItemCard(user.id, kind, itemId, user.settings.timezone, undefined, false, 1, workspace?.id);
  const keyboard = kind === "task" && isGroupChat(ctx)
    ? await groupTaskKeyboardForContext(ctx, user.id, itemId, true)
    : card.keyboard;
  const page = Math.max(1, Number(pageText) || 1);
  const listKind = kind === "task" ? "tasks" : kind === "note" ? "notes" : "ideas";
  rememberListOrigin(user.id, kind, page);
  keyboard.row().text(`‹ Back to page ${page}`, `list:${listKind}:${page}`);
  await ctx.answerCallbackQuery({ text: "Opened" });
  await editOrReplyHtml(ctx, card.text, { reply_markup: keyboard });
}

/** Page arrows on a long note card. Only the display is split; the stored note is unchanged. */
async function handleNoteDetailPage(ctx: Context, itemId: string, pageText: string) {
  const user = await ensureUser(ctx);
  const requestedPage = Math.max(1, Number(pageText) || 1);
  const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
  const card = await buildItemCard(
    user.id,
    "note",
    itemId,
    user.settings.timezone,
    undefined,
    false,
    requestedPage,
    workspace?.id,
  );
  appendListOrigin(card.keyboard, user.id, "note");
  await ctx.answerCallbackQuery({ text: `Page ${card.notePage?.page ?? 1}` });
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
}

async function handleArchivedNoteDetailPage(
  ctx: Context,
  publicId: string,
  pageText: string
) {
  const user = await ensureUser(ctx);
  const note = await findAnyNote(user.id, publicId);
  const card = buildArchivedNoteCard(note, Number(pageText) || 1);
  await ctx.answerCallbackQuery({ text: `Page ${card.notePage.page}` });
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
}

function isEditableItemField(field: string | undefined): field is EditableItemField {
  return field === "title" || field === "description" || field === "body" || field === "concept" || field === "caption";
}

/**
 * Resolves who tapped a task button and who owns the task. In groups the owner is the synthetic
 * workspace user, so both carry settings and callers can format times without fallbacks.
 */
async function taskCallbackUsers(
  ctx: Context,
  taskId: string,
  knownInteractionUser?: Awaited<ReturnType<typeof ensureUser>>,
) {
  const interactionUser = knownInteractionUser ?? await ensureUser(ctx);
  if (!isGroupChat(ctx) || !ctx.chat) return { interactionUser, taskUser: interactionUser };

  const ownerUserId = await resolveGroupTaskCallbackOwner(interactionUser.id, taskId, ctx.chat.id);
  if (ownerUserId === interactionUser.id) return { interactionUser, taskUser: interactionUser };

  const taskUser = await prisma.user.findUniqueOrThrow({
    where: { id: ownerUserId },
    include: { settings: true },
  });
  // Group owners are created through ensureUser, so a missing settings row is an invariant break.
  if (!taskUser.settings) throw new Error(`Task owner ${taskUser.id} has no settings row.`);
  return { interactionUser, taskUser: { ...taskUser, settings: taskUser.settings } };
}

/** Builds the group task keyboard for the tapper's role on that task (claim, assignee, manager, and so on). */
async function groupTaskKeyboardForContext(
  ctx: Context,
  ownerUserId: string,
  taskReference: string,
  expanded: boolean,
  backCallback = "menu:tasks",
) {
  const access = await groupTaskKeyboardAccess(ctx, ownerUserId, taskReference);
  return groupTaskActionsKeyboard(
    access.task,
    access.audience as GroupTaskAudience,
    access.workspaceId,
    expanded,
    backCallback,
  );
}

/**
 * Runs a task command from a button through the shared executor. A group policy refusal is
 * answered as an alert on the tapped button and returns undefined; other errors reach bot.catch.
 */
async function executeButtonTaskCommand(ctx: Context, userId: string, command: TaskCommandInput, refusal: string): Promise<TaskCommandResult | undefined> {
  try {
    return await executeTaskCommand({ ...command, userId, actor: taskCommandActorFromContext(ctx), source: "button" });
  } catch (error) {
    if (!(error instanceof GroupTaskPermissionError)) throw error;
    await ctx.answerCallbackQuery({ text: userFacingError(error, refusal).slice(0, 180), show_alert: true });
    return undefined;
  }
}

/**
 * Boolean form of the group permission check for button handlers: answers the tap with an alert
 * and returns false when the member is not allowed. Alert text is cut to fit Telegram's limit.
 */
async function allowGroupTaskAction(
  ctx: Context,
  ownerUserId: string,
  taskReference: string,
  action: "complete" | "snooze" | "manage",
): Promise<boolean> {
  try {
    await assertGroupTaskActionForContext(ctx, ownerUserId, taskReference, action);
    return true;
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: userFacingError(error, "That action is not available to you.").slice(0, 180),
      show_alert: true,
    });
    return false;
  }
}

async function handleArchivedPage(ctx: Context, kindText: string, pageText: string) {
  const kind = parseArchiveKind(kindText);
  const page = Number(pageText);
  if (!kind || !Number.isInteger(page)) return;

  const user = await ensureUser(ctx);
  const archived = await listArchivedItems(user.id, kind, page);
  await ctx.answerCallbackQuery({ text: `Page ${archived.page}` });
  await editOrReplyHtml(ctx, formatArchivedPage(archived, user.settings.timezone), {
    reply_markup: archivedPageKeyboard(kind, archived.page, archived.totalPages)
  });
}

/**
 * Buttons on the capture review card for an ordinary message (`PendingCapture`).
 * Ignore, Change type, and Back only read or close the review. Saving consumes the pending row
 * first, which is bound to the original sender, so a second tap or another member cannot save it.
 * A Reminder with no usable future time asks for one through a force-reply prompt whose actor,
 * chat, and message id are stored, so only that exact reply can finish the reminder.
 */
async function handleCapture(ctx: Context, ai: AiProvider, action: string, pendingId: string) {

  const user = await ensureUser(ctx);
  if (action === "ignore") {
    const ignored = await ignorePendingCapture(user.id, pendingId, ctx.from?.id);
    if (!ignored) {
      await ctx.answerCallbackQuery({ text: "That choice expired or belongs to someone else.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Ignored" });
    await editOrReplyQuietAcknowledgementHtml(ctx, "Ignored.");
    return;
  }

  if (action === "choose" || action === "back") {
    const pending = await findPendingCapture(user.id, pendingId, ctx.from?.id);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "That choice expired or belongs to someone else.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    if (action === "choose") {
      await editOrReplyHtml(ctx, formatCaptureTypeChoice(pending.sourceText), {
        reply_markup: captureTypeKeyboard(pending.id),
      });
      return;
    }
    const suggestedKind = suggestedPendingCaptureKind(pending, user.settings.timezone);
    await editOrReplyHtml(ctx, formatCaptureReview(pending.sourceText, suggestedKind), {
      reply_markup: captureConfirmationKeyboard(pending.id, suggestedKind),
    });
    return;
  }

  if (action === "reminder") {
    const pending = await findPendingCapture(user.id, pendingId, ctx.from?.id);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "That choice expired or belongs to someone else.", show_alert: true });
      return;
    }
    const timezone = user.settings.timezone;
    const dueAt = parseDueDate(pending.sourceText, timezone);
    if (!dueAt || dueAt.getTime() <= Date.now()) {
      if (!ctx.from || !ctx.chat) return;
      await ctx.answerCallbackQuery({ text: "Tell me when" });
      await editOrReplyHtml(ctx, formatReminderTimePrompt(pending.sourceText));
      const prompt = await ctx.reply("Reply with the reminder time.", {
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: "Tomorrow at 9am…",
        },
      });
      const remembered = await rememberPendingCaptureReminderPrompt(
        user.id,
        pending.id,
        ctx.from.id,
        ctx.chat.id,
        prompt.message_id,
      );
      if (!remembered) {
        await replyHtml(ctx, "That capture expired before I could continue. Send it again if needed.");
      }
      return;
    }
    const claimed = await consumePendingCapture(user.id, pendingId, ctx.from?.id);
    if (!claimed) {
      await ctx.answerCallbackQuery({ text: "That choice expired or belongs to someone else.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Saving reminder" });
    await saveTaskFromTelegram(ctx, user, claimed.sourceText, { dueAt, options: pendingCaptureTaskOptions(claimed), edit: true });
    return;
  }

  const pending = await consumePendingCapture(user.id, pendingId, ctx.from?.id);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "That choice expired or belongs to someone else.", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Saving" });

  if (action === "task") {
    await saveTaskFromTelegram(ctx, user, pending.sourceText, { options: pendingCaptureTaskOptions(pending), edit: true });
    return;
  }

  if (action === "idea") {
    const idea = await createIdea(user.id, pending.sourceText, ai);
    await editOrReplyQuietAcknowledgementHtml(ctx, formatIdeaSavedAcknowledgement(idea));
    return;
  }

  if (action === "note") {
    const note = await createNote(user.id, pending.sourceText, ai);
    await editOrReplyQuietAcknowledgementHtml(ctx, formatNoteSavedAcknowledgement(note));
    return;
  }

  await editOrReplyText(ctx, "That capture type is no longer available.", { reply_markup: menuBackKeyboard() });
}
