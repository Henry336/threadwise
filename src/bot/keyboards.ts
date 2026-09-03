import { InlineKeyboard, Keyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";
import { DASHBOARD_URL, dashboardViewUrl, groupDashboardItemUrl, groupDashboardUrl } from "./links";

type TaskActionTarget = string | Pick<TaskListItem, "id" | "pinnedAt" | "dueAt" | "calendarEventId" | "calendarEventUrl">;
type ItemKind = "task" | "note" | "idea";
type ItemActionTarget = { id: string; publicId?: string; pinnedAt?: Date | null };
export type ActiveListNavigation = {
  kind: "tasks" | "notes" | "ideas";
  page: number;
  totalPages: number;
  numberOffset: number;
  workspaceId?: string;
};

export type GroupTaskAudience = "unassigned" | "everyone" | "assignee" | "manager" | "other";

export function startMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Tasks", "menu:tasks").text("📝 Notes", "menu:notes").row()
    .text("💡 Ideas", "menu:ideas").text("🖼️ Images", "menu:images").row()
    .text("🔎 Search", "menu:search").text("⚙️ Settings", "menu:settings").row()
    .webApp("🌐 Dashboard", DASHBOARD_URL).text("❓ Help", "menu:help");
}

export function groupStartMenuKeyboard(workspaceId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Shared work", "menu:tasks").text("Capture & recall", "menu:group-library").row()
    .text("Find a time", "menu:find-time").text("Search", "menu:search").row();
  if (workspaceId) {
    keyboard.url("Open group dashboard ↗", groupDashboardUrl(workspaceId)).row();
  }
  return keyboard.text("More", "menu:group-more");
}

export function groupLibraryMenuKeyboard(workspaceId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Notes", "menu:notes").text("Ideas", "menu:ideas").row()
    .text("Images", "menu:images").text("Search", "menu:search").row();
  if (workspaceId) keyboard.url("Open library ↗", groupDashboardUrl(workspaceId, "library")).row();
  return keyboard.text("‹ Group menu", "menu:home");
}

export function groupMoreMenuKeyboard(workspaceId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Help", "menu:help").text("Settings", "menu:settings").row();
  if (workspaceId) keyboard.url("Open group dashboard ↗", groupDashboardUrl(workspaceId)).row();
  return keyboard.text("‹ Group menu", "menu:home");
}

export const PRIVATE_MENU_LABELS = {
  menu: "☰ Menu",
  dashboard: "🌐 Dashboard"
} as const;

export const NOTE_SESSION_LABELS = {
  save: "Save note",
  cancel: "Cancel"
} as const;

export function privateMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(PRIVATE_MENU_LABELS.menu)
    .text(PRIVATE_MENU_LABELS.dashboard)
    .resized()
    .persistent()
    .placeholder("Tell Threadwise what you need…");
}

export function noteSessionKeyboard(): Keyboard {
  return new Keyboard()
    .text(NOTE_SESSION_LABELS.save)
    .text(NOTE_SESSION_LABELS.cancel)
    .resized()
    .persistent()
    .placeholder("Keep writing…");
}

export function dashboardLinkKeyboard(): InlineKeyboard {
  return new InlineKeyboard().webApp("Open Threadwise Dashboard", DASHBOARD_URL);
}

export function groupDashboardLinkKeyboard(workspaceId: string): InlineKeyboard {
  return new InlineKeyboard().url("Open group dashboard ↗", groupDashboardUrl(workspaceId));
}

export function tasksModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add task", "menu:tasks-add").text("⏰ Set reminder", "menu:tasks-reminder").row()
    .text("📋 Open tasks", "menu:tasks-list").text("⭐ Important", "menu:important").row()
    .text("🗃️ Archived", "menu:tasks-archived").text("‹ Main menu", "menu:home");
}

export function notesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add note", "menu:notes-add").text("✍️ Note session", "menu:notes-session").row()
    .text("📝 Recent notes", "menu:notes-list").text("🔎 Search notes", "menu:notes-search").row()
    .text("🗃️ Archived", "menu:notes-archived").row()
    .text("‹ Main menu", "menu:home");
}

export function ideasModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add idea", "menu:ideas-add").text("💡 Recent ideas", "menu:ideas-list").row()
    .text("✨ Idea brief", "menu:ideas-brief").text("🔎 Search ideas", "menu:ideas-search").row()
    .text("🗃️ Archived", "menu:ideas-archived").row()
    .text("‹ Main menu", "menu:home");
}

export function imagesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🖼️ Browse images", "menu:images-list").text("🔎 Find an image", "menu:images-search").row()
    .webApp("Open gallery", `${DASHBOARD_URL}/dashboard?view=images`).text("‹ Main menu", "menu:home");
}

export function groupImagesModeKeyboard(workspaceId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("🖼️ Browse images", "menu:images-list").text("🔎 Find an image", "menu:images-search").row();
  if (workspaceId) keyboard.url("Open shared gallery", groupDashboardUrl(workspaceId, "images"));
  return keyboard.text("‹ Main menu", "menu:home");
}

export function expensesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add expense", "menu:expenses-add").text("💰 Recent expenses", "menu:expenses-list").row()
    .text("📊 Excel & export", "menu:excel").text("‹ Main menu", "menu:home");
}

export function groupExpensesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add expense", "menu:expenses-add").text("💰 Recent expenses", "menu:expenses-list").row()
    .text("‹ Main menu", "menu:home");
}

export function searchModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔎 Search everything", "menu:search-input").row()
    .text("⭐ Important", "menu:important").text("🗃️ Archived", "menu:archived").row()
    .text("‹ Main menu", "menu:home");
}

export function archivedKindsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Tasks", "menu:tasks-archived")
    .text("📝 Notes", "menu:notes-archived")
    .text("💡 Ideas", "menu:ideas-archived")
    .row()
    .text("‹ Search", "menu:search");
}

export function settingsModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⏰ Reminders", "setting:reminders").text("🌍 Region & language", "setting:region").row()
    .text("🎙️ Voice Capture", "setting:voice").row()
    .text("📅 Google Calendar", "menu:calendar-settings").text("🔐 Data & privacy", "menu:privacy").row()
    .webApp("🌐 Dashboard settings", `${DASHBOARD_URL}/dashboard?view=settings`).row()
    .text("‹ Main menu", "menu:home");
}

export function groupSettingsModeKeyboard(workspaceId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("⏰ Reminders", "setting:reminders").text("🌍 Region & language", "setting:region").row()
    .text("🎙️ Voice Capture", "setting:voice").row();
  keyboard.text("🧵 Create Threadwise topic", "group:topic:create").row();
  if (workspaceId) keyboard.url("🌐 Shared dashboard", groupDashboardUrl(workspaceId, "settings")).row();
  return keyboard.text("❓ Group help", "menu:help").text("‹ Main menu", "menu:home");
}

export function voiceSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Light cleanup", "setting:voice-apply:cleanup:light")
    .text("Verbatim", "setting:voice-apply:cleanup:verbatim").row()
    .text("Fast model", "setting:voice-apply:model:fast")
    .text("Higher accuracy", "setting:voice-apply:model:accuracy").row()
    .text("Audio files: On", "setting:voice-apply:audio:on")
    .text("Audio files: Off", "setting:voice-apply:audio:off").row()
    .text("‹ Settings", "menu:settings");
}

export type SettingChoiceField = "interval" | "mode" | "quiet" | "due-nudge" | "max" | "timezone" | "currency" | "ocr" | "dm";

export function reminderSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔁 Repeat interval", "setting:pick:interval").text("📝 Message style", "setting:pick:mode").row()
    .text("🌙 Quiet hours", "setting:pick:quiet").text("⏱ Early warning", "setting:pick:due-nudge").row()
    .text("🛡 Daily limit", "setting:pick:max").row()
    .text("‹ Settings", "menu:settings");
}

export function regionSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🌍 Timezone", "setting:pick:timezone").text("🖼 Image language", "setting:pick:ocr").row()
    .text("📩 Private nudges", "setting:pick:dm").row()
    .text("‹ Settings", "menu:settings");
}

export function settingChoicesKeyboard(field: SettingChoiceField): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (field === "interval") {
    keyboard.text("1 hour", "setting:apply:interval:60").text("3 hours", "setting:apply:interval:180").text("6 hours", "setting:apply:interval:360").row()
      .text("12 hours", "setting:apply:interval:720").text("✎ Custom", "setting:custom:interval");
  } else if (field === "mode") {
    keyboard.text("Compact", "setting:apply:mode:compact").text("Detailed", "setting:apply:mode:detailed");
  } else if (field === "quiet") {
    keyboard.text("22:00–08:00", "setting:apply:quiet:22-08").text("23:00–07:00", "setting:apply:quiet:23-07").row()
      .text("Off", "setting:apply:quiet:off").text("✎ Custom", "setting:custom:quiet");
  } else if (field === "due-nudge") {
    keyboard.text("3 min", "setting:apply:due-nudge:3").text("10 min", "setting:apply:due-nudge:10").text("30 min", "setting:apply:due-nudge:30").row()
      .text("Off", "setting:apply:due-nudge:off").text("✎ Custom", "setting:custom:due-nudge");
  } else if (field === "max") {
    keyboard.text("24/day", "setting:apply:max:24").text("100/day", "setting:apply:max:100").text("200/day", "setting:apply:max:200").row()
      .text("✎ Custom", "setting:custom:max");
  } else if (field === "timezone") {
    keyboard.text("Singapore", "setting:apply:timezone:Asia/Singapore").text("Yangon", "setting:apply:timezone:Asia/Yangon").row()
      .text("Kuala Lumpur", "setting:apply:timezone:Asia/Kuala_Lumpur").text("London", "setting:apply:timezone:Europe/London").row()
      .text("✎ Other city", "setting:custom:timezone");
  } else if (field === "currency") {
    keyboard.text("SGD", "setting:apply:currency:SGD").text("USD", "setting:apply:currency:USD").text("MMK", "setting:apply:currency:MMK").text("MYR", "setting:apply:currency:MYR").row()
      .text("✎ Other currency", "setting:custom:currency");
  } else if (field === "ocr") {
    keyboard.text("English", "setting:apply:ocr:eng").text("Burmese", "setting:apply:ocr:mya").row()
      .text("English + Burmese", "setting:apply:ocr:eng+mya");
  } else {
    keyboard.text("On", "setting:apply:dm:on").text("Off", "setting:apply:dm:off");
  }

  const parent = ["timezone", "currency", "ocr", "dm"].includes(field) ? "region" : "reminders";
  return keyboard.row().text(`‹ ${parent === "region" ? "Region & language" : "Reminders"}`, `setting:${parent}`);
}

export function settingInputKeyboard(parent: "reminders" | "region"): InlineKeyboard {
  return new InlineKeyboard()
    .text("✕ Cancel", `setting:cancel:${parent}`)
    .text(`‹ ${parent === "region" ? "Region & language" : "Reminders"}`, `setting:${parent}`);
}

export function integrationsSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📅 Google Calendar", "menu:calendar-settings").row()
    .text("‹ Settings", "menu:settings");
}

export function calendarSettingsKeyboard(status: { connected: boolean; autoSync: boolean; reconnectRequired?: boolean }, connectUrl?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!status.connected && connectUrl) {
    keyboard.url(status.reconnectRequired ? "Reconnect Google Calendar" : "Connect Google Calendar", connectUrl).row();
  } else if (status.connected) {
    keyboard.text("Sync existing tasks", "integration:calendar:sync-all").row()
      .text(status.autoSync ? "Automatic sync: On" : "Automatic sync: Off", "integration:calendar:toggle-auto").row()
      .text("Disconnect", "integration:calendar:disconnect-confirm").row();
  }
  return keyboard.text("‹ Integrations", "menu:integrations");
}

export function calendarTaskKeyboard(task: Pick<TaskListItem, "id" | "calendarEventId" | "calendarEventUrl">, connectUrl?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (connectUrl) {
    keyboard.url("Connect & add", connectUrl).row();
  } else if (task.calendarEventId) {
    if (task.calendarEventUrl) keyboard.url("Open event", task.calendarEventUrl).row();
    keyboard.text("Update event", `integration:calendar:sync:${task.id}`)
      .text("Remove event", `integration:calendar:remove:${task.id}`).row();
  } else {
    keyboard.text("Add to Calendar", `integration:calendar:sync:${task.id}`).row();
  }
  return keyboard.text("‹ Reminder", `task:view-full:${task.id}`);
}

export function excelSettingsKeyboard(
  status: { connected: boolean; autoSync: boolean; workbookReady: boolean; workbookUrl?: string },
  connectUrl?: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!status.connected && connectUrl) {
    keyboard.url("Connect Microsoft Excel", connectUrl).row();
  } else if (status.connected) {
    if (!status.workbookReady) keyboard.text("Create expense workbook", "integration:excel:create").row();
    if (status.workbookUrl) keyboard.url("Open workbook", status.workbookUrl).row();
    if (status.workbookReady) keyboard.text("Sync expenses now", "integration:excel:sync").row();
    keyboard.text(status.autoSync ? "Automatic sync: On" : "Automatic sync: Off", "integration:excel:toggle-auto").row()
      .text("Disconnect", "integration:excel:disconnect-confirm").row();
  }
  return keyboard.text("Download .xlsx", "integration:excel:export").row()
    .text("‹ Integrations", "menu:integrations");
}

export function disconnectIntegrationKeyboard(provider: "calendar" | "excel"): InlineKeyboard {
  return new InlineKeyboard()
    .text("Disconnect", `integration:${provider}:disconnect`)
    .text("Keep connected", `menu:${provider === "calendar" ? "calendar-settings" : "excel-settings"}`);
}

export function taskCancelCalendarKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Cancel + remove event", `task:cancel-confirm:remove:${taskId}`).row()
    .text("Cancel task only", `task:cancel-confirm:keep:${taskId}`).row()
    .text("Keep task", `task:view-full:${taskId}`);
}

export function privacySettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("Privacy explained", `${DASHBOARD_URL}/privacy`)
    .webApp("Data controls", `${DASHBOARD_URL}/dashboard?view=settings`).row()
    .text("‹ Settings", "menu:settings");
}

export function menuInputCancelKeyboard(backAction: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✕ Cancel", "menu:cancel-input")
    .text("‹ Back", `menu:${backAction}`);
}

export function helpTopicsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Today & tasks", "menu:reminders").text("📝 Notes", "menu:notes-help").row()
    .text("💡 Ideas", "menu:ideas-help").text("🖼️ Images", "menu:images-help").row()
    .text("🔎 Search", "menu:search").text("⚙️ Settings", "menu:settings").row()
    .text("🔐 Privacy", "menu:privacy").webApp("🌐 Dashboard", DASHBOARD_URL).row()
    .text("⌨️ Commands", "menu:commands")
    .row()
    .text("‹ Main menu", "menu:home");
}

export function groupHelpTopicsKeyboard(workspaceId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📋 Tasks", "menu:reminders").text("📝 Notes", "menu:notes-help").row()
    .text("💡 Ideas", "menu:ideas-help").text("🖼️ Images", "menu:images-help").row()
    .text("⌨️ Group commands", "menu:commands").row();
  if (workspaceId) keyboard.url("🌐 Group dashboard", groupDashboardUrl(workspaceId)).row();
  return keyboard.text("‹ Main menu", "menu:home");
}

export function menuBackKeyboard(label = "‹ Main menu", callbackData = "menu:home"): InlineKeyboard {
  return new InlineKeyboard().text(label, callbackData);
}

export function modeBackKeyboard(mode: "tasks" | "notes" | "ideas" | "images" | "expenses" | "search", label?: string): InlineKeyboard {
  const fallback = mode[0]?.toUpperCase() + mode.slice(1);
  return new InlineKeyboard().text(label ?? `‹ ${fallback}`, `menu:${mode}`);
}

export function taskActionsKeyboard(
  task: TaskActionTarget,
  includeBack = true,
  _includeCollaboration = false,
  includeFullReminder = false
): InlineKeyboard {
  const taskId = typeof task === "string" ? task : task.id;
  const keyboard = new InlineKeyboard()
    .text("✅ Done", `task:done:${taskId}`)
    .text("⏰ Snooze", `task:snooze:${taskId}`)
    .row();
  keyboard.webApp(includeFullReminder ? "View task ↗" : "Manage task ↗", dashboardViewUrl("tasks", { kind: "task", id: taskId }));
  if (includeBack) keyboard.text("‹ Tasks", "menu:tasks");
  return keyboard;
}

export function groupTaskActionsKeyboard(
  taskId: string,
  audience: GroupTaskAudience,
  workspaceId: string,
  expanded = false,
  backCallback = "menu:tasks",
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (audience === "unassigned") {
    keyboard.text("Claim", `task:claim:${taskId}`).text("View", `task:view-full:${taskId}`);
    return keyboard;
  }
  if (audience === "everyone" || audience === "assignee" || audience === "manager") {
    keyboard.text("Done", `task:done:${taskId}`).text("Snooze", `task:snooze:${taskId}`).row();
  }
  if (!expanded) {
    keyboard.text("View", `task:view-full:${taskId}`);
    return keyboard;
  }
  keyboard.url(audience === "manager" ? "Manage task ↗" : "Open task ↗", groupDashboardItemUrl(workspaceId, "tasks", "task", taskId));
  keyboard.text("‹ Back", backCallback);
  return keyboard;
}

export function reminderActionsKeyboard(task: TaskActionTarget, includeCollaboration = false): InlineKeyboard {
  const taskId = typeof task === "string" ? task : task.id;
  return taskActionsKeyboard(task, true, includeCollaboration, true)
    .row()
    .text("Dismiss reminders", `task:dismiss-reminders:${taskId}`);
}

export function taskCreatedKeyboard(task: TaskActionTarget, includeCollaboration = false): InlineKeyboard {
  return taskActionsKeyboard(task, false, includeCollaboration)
    .text("↩️ Undo save", "undo:last");
}

export function addTaskCollaborationActions(keyboard: InlineKeyboard, taskId: string): InlineKeyboard {
  return keyboard.row().text("View assignment", `task:view-full:${taskId}`);
}

export function taskListKeyboard(tasks: TaskListItem[], maxButtons = 3, navigation?: ActiveListNavigation, selecting = false): InlineKeyboard | undefined {
  if (tasks.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  if (selecting) {
    const visibleTasks = tasks.slice(0, maxButtons);
    for (const [index, task] of visibleTasks.entries()) {
      const number = (navigation?.numberOffset ?? 0) + index + 1;
      keyboard.text(String(number), `item:task:open:${task.id}:${navigation?.page ?? 1}`);
    }
    keyboard.row().text("‹ Back", `list:tasks:${navigation?.page ?? 1}`);
    return keyboard;
  }
  keyboard.text("Choose an item", `list:choose:tasks:${navigation?.page ?? 1}`)
    .url("View all ↗", navigation?.workspaceId ? groupDashboardUrl(navigation.workspaceId, "tasks") : dashboardViewUrl("tasks"));
  appendActiveListNavigation(keyboard, navigation);

  return keyboard;
}

export function itemCreatedKeyboard(kind: Exclude<ItemKind, "task">, item: ItemActionTarget): InlineKeyboard {
  return itemActionsKeyboard(kind, item, false)
    .text("↩️ Undo save", "undo:last");
}

export function undoKeyboard(label = "↩️ Undo"): InlineKeyboard {
  return new InlineKeyboard()
    .text(label, "undo:last")
    .row()
    .text("‹ Main menu", "menu:home");
}

export function restoreCompletedTaskKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("↩️ Restore task", `task:restore:${taskId}`)
    .row()
    .text("‹ Tasks", "menu:tasks");
}

export function editCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✕ Cancel edit", "edit:cancel");
}

export function itemActionsKeyboard(
  kind: ItemKind,
  item: ItemActionTarget,
  includeBack = true,
  notePage?: { page: number; totalPages: number },
  workspaceId?: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (kind === "note" && notePage && notePage.totalPages > 1) {
    if (notePage.page > 1) keyboard.text("←", `item:note:page:${item.id}:${notePage.page - 1}`);
    keyboard.text(`${notePage.page}/${notePage.totalPages}`, `item:note:page:${item.id}:${notePage.page}`);
    if (notePage.page < notePage.totalPages) keyboard.text("→", `item:note:page:${item.id}:${notePage.page + 1}`);
    keyboard.row();
  }
  const view = kind === "task" ? "tasks" : `${kind}s`;
  const label = kind === "note" ? "Edit note ↗" : kind === "idea" ? "Develop idea ↗" : "Manage task ↗";
  keyboard.url(label, workspaceId
    ? groupDashboardItemUrl(workspaceId, view, kind, item.id)
    : dashboardViewUrl(view, { kind, id: item.id }));
  if (includeBack) keyboard.text(`‹ ${kind === "task" ? "Tasks" : kind === "note" ? "Notes" : "Ideas"}`, `menu:${kind === "task" ? "tasks" : kind === "note" ? "notes" : "ideas"}`);

  return keyboard;
}

export function itemListKeyboard(kind: Exclude<ItemKind, "task">, items: ItemActionTarget[], maxButtons = 3, navigation?: ActiveListNavigation, selecting = false): InlineKeyboard | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  if (selecting) {
    const visibleItems = items.slice(0, maxButtons);
    for (const [index, item] of visibleItems.entries()) {
      const number = (navigation?.numberOffset ?? 0) + index + 1;
      keyboard.text(String(number), `item:${kind}:open:${item.publicId ?? item.id}:${navigation?.page ?? 1}`);
    }
    keyboard.row().text("‹ Back", `list:${kind === "note" ? "notes" : "ideas"}:${navigation?.page ?? 1}`);
    return keyboard;
  }
  const listKind = kind === "note" ? "notes" : "ideas";
  keyboard.text("Choose an item", `list:choose:${listKind}:${navigation?.page ?? 1}`)
    .url("View all ↗", navigation?.workspaceId ? groupDashboardUrl(navigation.workspaceId, listKind) : dashboardViewUrl(listKind));
  appendActiveListNavigation(keyboard, navigation);

  return keyboard;
}

export function ideaBriefKeyboard(ideaReference: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💡 Open idea", `item:idea:open:${ideaReference}`)
    .text("‹ Ideas", "menu:ideas");
}

function appendActiveListNavigation(
  keyboard: InlineKeyboard,
  navigation?: ActiveListNavigation,
): void {
  if (navigation && navigation.totalPages > 1) {
    keyboard.row();
    if (navigation.page > 1) keyboard.text("←", `list:${navigation.kind}:${navigation.page - 1}`);
    keyboard.text(`${navigation.page}/${navigation.totalPages}`, `list:${navigation.kind}:${navigation.page}`);
    if (navigation.page < navigation.totalPages) keyboard.text("→", `list:${navigation.kind}:${navigation.page + 1}`);
  }
}

export type CaptureSaveKind = "task" | "reminder" | "note" | "idea";

const CAPTURE_KIND_LABELS: Record<CaptureSaveKind, string> = {
  task: "task",
  reminder: "reminder",
  note: "note",
  idea: "idea",
};

export function captureConfirmationKeyboard(
  pendingId: string,
  suggestedKind?: CaptureSaveKind,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (suggestedKind) {
    keyboard.text(`Save ${CAPTURE_KIND_LABELS[suggestedKind]}`, `capture:${suggestedKind}:${pendingId}`).row();
  }
  return keyboard
    .text(suggestedKind ? "Change type" : "Choose type", `capture:choose:${pendingId}`)
    .text("Ignore", `capture:ignore:${pendingId}`);
}

export function captureTypeKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Task", `capture:task:${pendingId}`)
    .text("Reminder", `capture:reminder:${pendingId}`).row()
    .text("Note", `capture:note:${pendingId}`)
    .text("Idea", `capture:idea:${pendingId}`).row()
    .text("Back", `capture:back:${pendingId}`)
    .text("Ignore", `capture:ignore:${pendingId}`);
}

export function noteMergePreviewKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Merge", `merge:confirm:${pendingId}`)
    .text("↻ Try again", `merge:retry:${pendingId}`)
    .row()
    .text("✕ Cancel", `merge:cancel:${pendingId}`);
}

export function searchPageKeyboard(pendingId: string, page: number, totalPages: number): InlineKeyboard | undefined {
  const keyboard = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 1) keyboard.text("Prev", `search:${pendingId}:${page - 1}`);
    keyboard.text(`Page ${page}/${totalPages}`, `search:${pendingId}:${page}`);
    if (page < totalPages) keyboard.text("Next", `search:${pendingId}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text("‹ Search", "menu:search");
  return keyboard;
}

export function archivedPageKeyboard(kind: string, page: number, totalPages: number): InlineKeyboard | undefined {
  const keyboard = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 1) keyboard.text("Prev", `archived:${kind}:${page - 1}`);
    keyboard.text(`Page ${page}/${totalPages}`, `archived:${kind}:${page}`);
    if (page < totalPages) keyboard.text("Next", `archived:${kind}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text("‹ Archived", "menu:archived");
  return keyboard;
}

export function archivedNoteDetailKeyboard(
  publicId: string,
  page: number,
  totalPages: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 1) keyboard.text("←", `archived-note:page:${publicId}:${page - 1}`);
    keyboard.text(`${page}/${totalPages}`, `archived-note:page:${publicId}:${page}`);
    if (page < totalPages) keyboard.text("→", `archived-note:page:${publicId}:${page + 1}`);
    keyboard.row();
  }
  return keyboard.text("‹ Archived notes", "menu:notes-archived");
}

export function bulkActionConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", `bulk:confirm:${pendingId}`)
    .text("✕ Cancel", `bulk:cancel:${pendingId}`);
}

export function imageTextActionsKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📝 Save note", `image:note:${pendingId}`)
    .text("📋 Create task", `image:task:${pendingId}`)
    .row()
    .text("⏰ Set reminder", `image:reminder:${pendingId}`).row()
    .text("🔎 Show full text", `image:text:${pendingId}`)
    .text("✕ Discard", `image:discard:${pendingId}`);
}

export function imageReminderTimeKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard().text("✕ Cancel reminder", `image:discard:${pendingId}`);
}

export function incomingImageKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🖼️ Save image", `image-upload:save:${pendingId}`)
    .text("✏️ Save with caption", `image-upload:caption:${pendingId}`).row()
    .text("🔎 Extract text", `image-upload:extract:${pendingId}`)
    .text("✅ Save + extract", `image-upload:save-extract:${pendingId}`)
    .row()
    .text("✕ Discard", `image-upload:discard:${pendingId}`);
}

export function storedImageListKeyboard(
  images: Array<{ id: string }>,
  page: number,
  totalPages: number,
  numberOffset: number,
  searchId?: string,
  selecting = false,
  workspaceId?: string,
): InlineKeyboard | undefined {
  if (!images.length) return undefined;
  const keyboard = new InlineKeyboard();
  if (selecting) {
    images.forEach((item, index) => {
      keyboard.text(String(numberOffset + index + 1), `stored-image:open:${item.id}`);
    });
    const back = searchId ? `stored-image:search:${searchId}:${page}` : `stored-image:page:${page}`;
    return keyboard.row().text("‹ Back", back);
  }
  const choose = searchId ? `stored-image:choose-search:${searchId}:${page}` : `stored-image:choose:${page}`;
  keyboard.text("Choose an image", choose)
    .url("View gallery ↗", workspaceId ? groupDashboardUrl(workspaceId, "images") : dashboardViewUrl("images"));
  if (totalPages > 1) {
    keyboard.row();
    const pagePrefix = searchId ? `stored-image:search:${searchId}` : "stored-image:page";
    if (page > 1) keyboard.text("← Prev", `${pagePrefix}:${page - 1}`);
    keyboard.text(`Page ${page}/${totalPages}`, `${pagePrefix}:${page}`);
    if (page < totalPages) keyboard.text("Next →", `${pagePrefix}:${page + 1}`);
  }
  return keyboard;
}

export function storedImageActionsKeyboard(imageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("View gallery ↗", dashboardViewUrl("images", { kind: "image", id: imageId }))
    .text("‹ Images", "menu:images");
}

export function storedImageDeleteKeyboard(imageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Yes, delete", `stored-image:delete-confirm:${imageId}`)
    .text("Keep image", `stored-image:delete-cancel:${imageId}`);
}

export function expenseConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Save in Threadwise", `expense:save:${pendingId}`)
    .row()
    .text("📊 Save + sync Excel", `expense:excel:${pendingId}`)
    .row()
    .text("✏️ Edit fields", `expense:edit:${pendingId}`)
    .text("✕ Discard", `expense:discard:${pendingId}`);
}

export function expensePageKeyboard(encodedFilter: string, page: number, totalPages: number): InlineKeyboard | undefined {
  const keyboard = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 1) keyboard.text("Prev", `expense:page:${encodedFilter}:${page - 1}`);
    keyboard.text(`Page ${page}/${totalPages}`, `expense:page:${encodedFilter}:${page}`);
    if (page < totalPages) keyboard.text("Next", `expense:page:${encodedFilter}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text("‹ Expenses", "menu:expenses");
  return keyboard;
}
