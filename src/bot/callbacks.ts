import type { Bot, Context } from "grammy";
import { GroupActivityType, TaskAssigneeStatus } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { ensureUser } from "../services/users";
import { cancelTask, completeTask, findTaskReference, formatTaskCreated, restoreCompletedTask, snoozeTask, createTask } from "../services/tasks";
import { formatReminderMessage } from "../services/reminders";
import { consumePendingCapture, ignorePendingCapture } from "../services/pendingCaptures";
import { createIdea, formatIdeaCreated, scoreIdea } from "../services/ideas";
import { archiveNote, createNote, formatNoteCreated } from "../services/notes";
import { formatPinnedItems, listPinnedItems, pinItem } from "../services/pins";
import { formatArchivedPage, listArchivedItems, parseArchiveKind } from "../services/archives";
import { cancelNoteMerge, confirmNoteMerge, formatNoteMergeConfirmed, formatNoteMergePreview, retryNoteMergePreview } from "../services/noteMerges";
import { beginPendingItemEdit, cancelPendingItemEdit, formatEditStarted, type EditableItemField, type EditableItemKind } from "../services/itemEdits";
import { findPendingSearch, semanticSearch } from "../services/search";
import { undoLastAction } from "../services/undo";
import { formatIdeaScore, formatSearchResultsPage, formatTaskDetail } from "./formatters";
import { awaitImageReminderTime, consumePendingImageCapture, discardPendingImageCapture, findPendingImageCapture } from "../services/imageOcr";
import { beginExpenseEdit, cancelPendingExpense, confirmPendingExpense, createPendingExpenseFromText, decodeExpenseFilter, encodeExpenseFilter, findPendingExpense, formatExpenseCreated, formatExpensePage, formatPendingExpense, listExpenses } from "../services/expenses";
import { syncExpenseToExcel } from "../services/excel";
import { bold, code, editOrReplyHtml, editOrReplyText, h } from "../utils/html";
import { addTaskCollaborationActions, archivedKindsKeyboard, archivedPageKeyboard, editCancelKeyboard, expenseConfirmationKeyboard, expensePageKeyboard, expensesModeKeyboard, groupExpensesModeKeyboard, groupHelpTopicsKeyboard, groupImagesModeKeyboard, groupSettingsModeKeyboard, groupStartMenuKeyboard, helpTopicsKeyboard, ideaBriefKeyboard, ideasModeKeyboard, imageReminderTimeKeyboard, imagesModeKeyboard, integrationsSettingsKeyboard, itemCreatedKeyboard, menuBackKeyboard, menuInputCancelKeyboard, notesModeKeyboard, noteMergePreviewKeyboard, privacySettingsKeyboard, regionSettingsKeyboard, reminderActionsKeyboard, reminderSettingsKeyboard, restoreCompletedTaskKeyboard, searchModeKeyboard, searchPageKeyboard, settingChoicesKeyboard, settingInputKeyboard, settingsModeKeyboard, startMenuKeyboard, storedImageDeleteKeyboard, taskActionsKeyboard, taskCreatedKeyboard, tasksModeKeyboard, undoKeyboard, type SettingChoiceField } from "./keyboards";
import { cancelBulkAction, confirmBulkAction, formatBulkActionResult } from "../services/bulkActions";
import { isActiveListKind, replyActiveList } from "./activeLists";
import { replyStoredImage, replyStoredImageList, replyStoredImageSearch } from "./storedImageReplies";
import { deleteStoredImage, findStoredImageById } from "../services/storedImages";
import { formatGroupCommandReference, formatGroupHelpGuide, formatGroupHelpTopic, formatGroupMainMenuText, formatGroupPrivacyText, formatHelpGuide, formatHelpTopic, formatMainMenuText } from "./help";
import { formatRegionSettings, formatReminderSettings, formatSettings, updateSetting } from "../services/settings";
import { beginMenuInput, clearMenuInput, type MenuInputAction } from "./menuInputs";
import { rememberCallbackControlCard } from "./controlCards";
import { buildItemCard } from "./itemCards";
import { appendListOrigin, listOrigin, rememberListOrigin } from "./navigationState";
import { cancelTransientInteractions } from "./interactions";
import { isGroupChat } from "./groupRouting";
import { groupWorkspaceForContext, isGroupManager } from "../services/groupWorkspaces";
import { collaborationActorFromContext, recordGroupTaskActivity, setTaskAssignmentStatus } from "../services/groupCollaboration";
import { userFacingError } from "./errorResponses";

export function registerCallbacks(bot: Bot, ai: AiProvider): void {
  bot.callbackQuery(/^task:(accept|block):(.+)$/, async (ctx) => handleTaskAssignmentStatus(ctx, ctx.match[2], ctx.match[1]));
  bot.callbackQuery(/^task:done:(.+)$/, async (ctx) => handleTaskDone(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:restore:(.+)$/, async (ctx) => handleTaskRestore(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:snooze:(.+)$/, async (ctx) => handleTaskSnooze(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:view-(full|summary):(.+)$/, async (ctx) => handleTaskReminderView(ctx, ctx.match[2], ctx.match[1] === "full"));
  bot.callbackQuery(/^task:cancel:(.+)$/, async (ctx) => handleTaskCancel(ctx, ctx.match[1]));
  bot.callbackQuery(/^task:(pin|unpin):(.+)$/, async (ctx) => handleTaskPin(ctx, ctx.match[2], ctx.match[1] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):(pin|unpin):(.+)$/, async (ctx) => handleItemPin(ctx, ctx.match[1], ctx.match[3], ctx.match[2] === "pin"));
  bot.callbackQuery(/^item:(task|note|idea):open:([^:]+)(?::(\d+))?$/, async (ctx) => handleItemOpen(ctx, ctx.match[1], ctx.match[2], ctx.match[3]));
  bot.callbackQuery(/^item:idea:brief:(.+)$/, async (ctx) => handleIdeaBrief(ctx, ai, ctx.match[1]));
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
  bot.callbackQuery(/^setting:(.+)$/, async (ctx) => handleSettingCallback(ctx, ctx.match[1]));
  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => handleMenu(ctx, ctx.match[1]));
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

async function handleSettingCallback(ctx: Context, action: string | undefined) {
  if (!action) return;
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

async function handleIdeaBrief(ctx: Context, ai: AiProvider, reference: string | undefined) {
  if (!reference) return;
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

function settingArguments(field: SettingChoiceField, value: string): string[] {
  if (field === "quiet" && value === "22-08") return ["quiet", "22:00", "08:00"];
  if (field === "quiet" && value === "23-07") return ["quiet", "23:00", "07:00"];
  return [field, value];
}

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

async function handleMenu(ctx: Context, action: string | undefined) {
  if (!action) return;
  const user = await ensureUser(ctx);
  if (!ctx.from) return;
  const group = isGroupChat(ctx);
  const workspace = group ? await groupWorkspaceForContext(ctx) : undefined;
  await cancelTransientInteractions(user.id, ctx.from.id);
  await ctx.answerCallbackQuery();
  rememberCallbackControlCard(ctx);
  if (action === "home") {
    await editOrReplyHtml(ctx, group
      ? formatGroupMainMenuText(workspace?.title ?? "Shared workspace", user.settings?.timezone ?? "Asia/Singapore")
      : formatMainMenuText(user.settings?.timezone ?? "Asia/Singapore"), {
      reply_markup: group ? groupStartMenuKeyboard(workspace?.id) : startMenuKeyboard()
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
    await editOrReplyHtml(ctx, `${bold(group ? "🖼️ Shared images" : "🖼️ Images")}\nBrowse saved images here, or open the visual gallery on the dashboard.`, { reply_markup: group ? groupImagesModeKeyboard(workspace?.id) : imagesModeKeyboard() });
    return;
  }
  if (action === "expenses") {
    await editOrReplyHtml(ctx, `${bold(group ? "💰 Shared expenses" : "💰 Expenses")}\n${group ? "Record and review spending saved for this group." : "Record spending, review recent entries, or export to Excel."}`, { reply_markup: group ? groupExpensesModeKeyboard() : expensesModeKeyboard() });
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
      await editOrReplyHtml(ctx, `${bold("🔌 Personal integrations stay private")}\nGmail, Calendar, and Excel connections belong to individual accounts and are not shared with a group workspace.`, { reply_markup: menuBackKeyboard("‹ Group settings", "menu:settings") });
      return;
    }
    await editOrReplyHtml(ctx, `${bold("🔌 Integrations")}\nChoose a service for its setup and status commands.`, { reply_markup: integrationsSettingsKeyboard() });
    return;
  }
  if (action === "calendar-settings") {
    await editOrReplyHtml(ctx, `${bold("📅 Google Calendar")}\n${code("/calendar")} status · ${code("/calendar connect")} connect\nUse ${code("/calendar 1")} to sync a dated task.`, { reply_markup: menuBackKeyboard("‹ Integrations", "menu:integrations") });
    return;
  }
  if (action === "gmail-settings") {
    await editOrReplyHtml(ctx, `${bold("✉️ Gmail")}\n${code("/gmail")} status · ${code("/gmail connect")} connect\nUse ${code("/gmail scan")} to check unread mail.`, { reply_markup: menuBackKeyboard("‹ Integrations", "menu:integrations") });
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
    "ideas-brief": { action: "idea-brief", title: "✨ Idea brief", prompt: "Which idea should I analyze? Send its list number or ID, such as 2 or IDEA-2.", back: "ideas" },
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
    await editOrReplyHtml(ctx, `${bold("Canceled")}\nNothing was changed.`, { reply_markup: group ? groupStartMenuKeyboard(workspace?.id) : startMenuKeyboard() });
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
    if (group && topic === "commands") {
      await editOrReplyHtml(ctx, formatGroupCommandReference(), { reply_markup: menuBackKeyboard("‹ Group help", "menu:help") });
      return;
    }
    const parentLabel = action === "excel" ? "‹ Expenses" : "‹ Help";
    const parentCallback = action === "excel" ? "menu:expenses" : "menu:help";
    await editOrReplyHtml(ctx, group ? formatGroupHelpTopic(topic, ctx.me.username) : formatHelpTopic(topic), { reply_markup: menuBackKeyboard(parentLabel, parentCallback) });
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
    await editOrReplyText(ctx, userFacingError(error, "I couldn't complete that bulk action."), { reply_markup: menuBackKeyboard() });
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
    if (isGroupChat(ctx)) {
      const actor = collaborationActorFromContext(ctx);
      await recordGroupTaskActivity(user.id, actor, GroupActivityType.TASK_CREATED, task, `${actor.displayName} added ${task.publicId}: ${task.title}.`);
    }
    await editOrReplyHtml(ctx, formatTaskCreated(task, user.settings?.timezone), { reply_markup: taskCreatedKeyboard(task, isGroupChat(ctx)) });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Action expired or failed" });
    await editOrReplyText(ctx, userFacingError(error, "I couldn't finish that image action."), { reply_markup: menuBackKeyboard() });
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
        syncMessage = `\nExcel: not synced. ${userFacingError(error, "You can retry the sync from Expenses.")}`;
      }
    }
    await editOrReplyHtml(ctx, `${formatExpenseCreated(expense, user.settings?.timezone ?? "UTC")}${h(syncMessage)}`, { reply_markup: menuBackKeyboard() });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "Could not save" });
    await editOrReplyText(ctx, userFacingError(error, "I couldn't save that expense."), { reply_markup: menuBackKeyboard() });
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

async function handleTaskAssignmentStatus(ctx: Context, taskId: string | undefined, action: string | undefined) {
  if (!taskId || !isGroupChat(ctx)) return;
  const user = await ensureUser(ctx);
  try {
    const status = action === "block" ? TaskAssigneeStatus.BLOCKED : TaskAssigneeStatus.ACCEPTED;
    const task = await setTaskAssignmentStatus(user.id, taskId, collaborationActorFromContext(ctx), status);
    await ctx.answerCallbackQuery({ text: action === "block" ? "Marked blocked" : "Assignment accepted" });
    const card = await buildItemCard(
      user.id,
      "task",
      task.publicId,
      user.settings?.timezone ?? "UTC",
      action === "block" ? "Task marked blocked" : "Assignment accepted",
      false,
    );
    addTaskCollaborationActions(card.keyboard, task.id);
    appendListOrigin(card.keyboard, user.id, "task");
    await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: userFacingError(error, "I couldn't update that assignment.").slice(0, 180),
      show_alert: true,
    });
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
  if (isGroupChat(ctx)) {
    const actor = collaborationActorFromContext(ctx);
    await recordGroupTaskActivity(user.id, actor, GroupActivityType.TASK_COMPLETED, completion.task, `${actor.displayName} completed ${completion.task.publicId}.`);
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
    const card = await buildItemCard(user.id, "task", result.task.publicId, user.settings?.timezone ?? "UTC", "Task already open", false);
    appendListOrigin(card.keyboard, user.id, "task");
    await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Restored" });
  const card = await buildItemCard(user.id, "task", result.task.publicId, user.settings?.timezone ?? "UTC", "↩️ Task restored", false);
  appendListOrigin(card.keyboard, user.id, "task");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard.row().text("↩️ Undo restore", "undo:last") });
}

async function handleTaskSnooze(ctx: Context, taskId: string | undefined) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  const task = await snoozeTask(user.id, taskId, "1h");
  await ctx.answerCallbackQuery({ text: "Snoozed 1 hour" });
  const card = await buildItemCard(user.id, "task", task.publicId, user.settings?.timezone ?? "UTC", "⏰ Snoozed for an hour", false);
  appendListOrigin(card.keyboard, user.id, "task");
  await editOrReplyHtml(ctx, card.text, { reply_markup: card.keyboard.row().text("↩️ Undo snooze", "undo:last") });
}

async function handleTaskReminderView(ctx: Context, taskId: string | undefined, expanded: boolean) {
  if (!taskId) return;
  const user = await ensureUser(ctx);
  try {
    const task = await findTaskReference(user.id, taskId);
    const timezone = user.settings?.timezone ?? "UTC";
    const includeCollaboration = isGroupChat(ctx);

    if (expanded) {
      const keyboard = taskActionsKeyboard(task, true, includeCollaboration)
        .row()
        .text("‹ Reminder", `task:view-summary:${task.id}`);
      await ctx.answerCallbackQuery({ text: "Full reminder" });
      await editOrReplyHtml(ctx, formatTaskDetail(task, timezone), { reply_markup: keyboard });
      return;
    }

    const reminderMode = user.settings?.reminderMode;
    if (!reminderMode) throw new Error("Reminder settings are missing.");
    await ctx.answerCallbackQuery({ text: "Reminder" });
    await editOrReplyHtml(ctx, formatReminderMessage(task, { timezone, reminderMode }), {
      reply_markup: reminderActionsKeyboard(task, includeCollaboration)
    });
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: userFacingError(error, "I couldn't open that reminder. Try /tasks for a fresh copy.").slice(0, 180),
      show_alert: true
    });
  }
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
  const card = await buildItemCard(user.id, "task", item.publicId, user.settings?.timezone ?? "UTC", shouldPin ? "⭐ Marked important" : "☆ Removed from important", false);
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
  const card = await buildItemCard(user.id, kind, item.publicId, user.settings?.timezone ?? "UTC", shouldPin ? "⭐ Starred" : "☆ Unstarred", false);
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
    await editOrReplyText(ctx, userFacingError(error, "I couldn't finish that merge. Try starting it again from /notes."), { reply_markup: menuBackKeyboard() });
  }
}

function isEditableItemKind(kind: string | undefined): kind is EditableItemKind {
  return kind === "task" || kind === "note" || kind === "idea" || kind === "image";
}

async function handleItemOpen(ctx: Context, kind: string | undefined, itemId: string | undefined, pageText: string | undefined) {
  if (!isEditableItemKind(kind) || !itemId || kind === "image") return;
  const user = await ensureUser(ctx);
  const card = await buildItemCard(user.id, kind, itemId, user.settings?.timezone ?? "UTC", undefined, false);
  if (kind === "task" && isGroupChat(ctx)) addTaskCollaborationActions(card.keyboard, itemId);
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
    if (isGroupChat(ctx)) {
      const actor = collaborationActorFromContext(ctx);
      await recordGroupTaskActivity(user.id, actor, GroupActivityType.TASK_CREATED, task, `${actor.displayName} added ${task.publicId}: ${task.title}.`);
    }
    await editOrReplyHtml(ctx, `${formatTaskCreated(task, user.settings?.timezone)}\n\n${code("/undo")} if this was the wrong bucket.`, {
      reply_markup: taskCreatedKeyboard(task, isGroupChat(ctx))
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
