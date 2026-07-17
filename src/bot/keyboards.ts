import { InlineKeyboard, Keyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";
import { DASHBOARD_URL } from "./links";

type TaskActionTarget = string | Pick<TaskListItem, "id" | "pinnedAt">;
type ItemKind = "task" | "note" | "idea";
type ItemActionTarget = { id: string; pinnedAt?: Date | null };
export type ActiveListNavigation = {
  kind: "tasks" | "notes" | "ideas";
  page: number;
  totalPages: number;
  numberOffset: number;
};

export function startMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Tasks", "menu:tasks").text("📝 Notes", "menu:notes").row()
    .text("💡 Ideas", "menu:ideas").text("🖼️ Images", "menu:images").row()
    .text("💰 Expenses", "menu:expenses").text("🔎 Search", "menu:search").row()
    .url("🌐 Dashboard", DASHBOARD_URL).text("⚙️ Settings", "menu:settings").row()
    .text("❓ Help", "menu:help");
}

export const PRIVATE_MENU_LABELS = {
  menu: "☰ Menu",
  dashboard: "🌐 Dashboard"
} as const;

export function privateMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(PRIVATE_MENU_LABELS.menu)
    .webApp(PRIVATE_MENU_LABELS.dashboard, DASHBOARD_URL)
    .resized()
    .persistent()
    .placeholder("Tell Threadwise what you need…");
}

export function dashboardLinkKeyboard(): InlineKeyboard {
  return new InlineKeyboard().url("Open Threadwise Dashboard", DASHBOARD_URL);
}

export function tasksModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add task", "menu:tasks-add").text("⏰ Set reminder", "menu:tasks-reminder").row()
    .text("📋 Open tasks", "menu:tasks-list").text("⭐ Important", "menu:important").row()
    .text("🗃️ Archived", "menu:tasks-archived").text("‹ Main menu", "menu:home");
}

export function notesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add note", "menu:notes-add").text("📝 Recent notes", "menu:notes-list").row()
    .text("🔎 Search notes", "menu:notes-search").text("🗃️ Archived", "menu:notes-archived").row()
    .text("‹ Main menu", "menu:home");
}

export function ideasModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add idea", "menu:ideas-add").text("💡 Recent ideas", "menu:ideas-list").row()
    .text("🔎 Search ideas", "menu:ideas-search").text("🗃️ Archived", "menu:ideas-archived").row()
    .text("‹ Main menu", "menu:home");
}

export function imagesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🖼️ Browse images", "menu:images-list").text("🔎 Find an image", "menu:images-search").row()
    .url("Open gallery", `${DASHBOARD_URL}/dashboard?view=images`).text("‹ Main menu", "menu:home");
}

export function expensesModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("＋ Add expense", "menu:expenses-add").text("💰 Recent expenses", "menu:expenses-list").row()
    .text("📊 Excel & export", "menu:excel").text("‹ Main menu", "menu:home");
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
    .text("⚙️ Preferences", "menu:preferences").text("🔌 Integrations", "menu:integrations").row()
    .text("🔐 Data & privacy", "menu:privacy").url("🌐 Dashboard", `${DASHBOARD_URL}/dashboard?view=settings`).row()
    .text("‹ Main menu", "menu:home");
}

export function menuInputCancelKeyboard(backAction: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✕ Cancel", "menu:cancel-input")
    .text("‹ Back", `menu:${backAction}`);
}

export function helpTopicsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⏰ Reminders", "menu:reminders").text("📝 Notes", "menu:notes-help").row()
    .text("💡 Ideas", "menu:ideas-help").text("🖼️ Images", "menu:images-help").row()
    .text("💰 Expenses", "menu:expenses").text("📊 Excel", "menu:excel").row()
    .text("🔎 Search", "menu:search").text("⚙️ Settings", "menu:settings").row()
    .text("🔐 Privacy", "menu:privacy").url("🌐 Dashboard", DASHBOARD_URL).row()
    .text("⌨️ Commands", "menu:commands")
    .row()
    .text("‹ Main menu", "menu:home");
}

export function menuBackKeyboard(label = "‹ Main menu", callbackData = "menu:home"): InlineKeyboard {
  return new InlineKeyboard().text(label, callbackData);
}

export function modeBackKeyboard(mode: "tasks" | "notes" | "ideas" | "images" | "expenses" | "search", label?: string): InlineKeyboard {
  const fallback = mode[0]?.toUpperCase() + mode.slice(1);
  return new InlineKeyboard().text(label ?? `‹ ${fallback}`, `menu:${mode}`);
}

export function taskActionsKeyboard(task: TaskActionTarget): InlineKeyboard {
  const taskId = typeof task === "string" ? task : task.id;
  const isPinned = typeof task === "string" ? false : Boolean(task.pinnedAt);

  return new InlineKeyboard()
    .text("✅ Complete task", `task:done:${taskId}`)
    .text("⏰ Snooze 1h", `task:snooze:${taskId}`)
    .row()
    .text(isPinned ? "☆ Unstar" : "⭐ Star", `item:task:${isPinned ? "unpin" : "pin"}:${taskId}`)
    .text("✏️ Edit title", `item:task:edit:title:${taskId}`)
    .row()
    .text("📝 Edit details", `item:task:edit:description:${taskId}`)
    .text("🗑️ Cancel task", `task:cancel:${taskId}`)
    .row()
    .text("‹ Tasks", "menu:tasks");
}

export function taskCreatedKeyboard(task: TaskActionTarget): InlineKeyboard {
  return taskActionsKeyboard(task)
    .row()
    .text("↩️ Undo save", "undo:last");
}

export function taskListKeyboard(tasks: TaskListItem[], maxButtons = 5, navigation?: ActiveListNavigation): InlineKeyboard | undefined {
  if (tasks.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const visibleTasks = tasks.slice(0, maxButtons);
  for (const [index, task] of visibleTasks.entries()) {
    const number = (navigation?.numberOffset ?? 0) + index + 1;
    keyboard.text(`Open task ${number}`, `item:task:open:${task.id}:${navigation?.page ?? 1}`);

    if (index < visibleTasks.length - 1) {
      keyboard.row();
    }
  }

  appendActiveListNavigation(keyboard, navigation, "tasks");

  return keyboard;
}

export function itemCreatedKeyboard(kind: Exclude<ItemKind, "task">, item: ItemActionTarget): InlineKeyboard {
  return itemActionsKeyboard(kind, item)
    .row()
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

export function itemActionsKeyboard(kind: ItemKind, item: ItemActionTarget): InlineKeyboard {
  const action = item.pinnedAt ? "unpin" : "pin";
  const bodyField = kind === "task" ? "description" : kind === "note" ? "body" : "concept";
  const bodyLabel = kind === "task" ? "details" : bodyField;
  const keyboard = new InlineKeyboard()
    .text(item.pinnedAt ? "☆ Unstar" : "⭐ Star", `item:${kind}:${action}:${item.id}`)
    .text("✏️ Edit title", `item:${kind}:edit:title:${item.id}`)
    .row()
    .text(`📝 Edit ${bodyLabel}`, `item:${kind}:edit:${bodyField}:${item.id}`);

  if (kind === "note") {
    keyboard.row().text("🗃️ Archive note", `item:note:archive:${item.id}`);
  }

  keyboard.row().text(`‹ ${kind === "task" ? "Tasks" : kind === "note" ? "Notes" : "Ideas"}`, `menu:${kind === "task" ? "tasks" : kind === "note" ? "notes" : "ideas"}`);

  return keyboard;
}

export function itemListKeyboard(kind: Exclude<ItemKind, "task">, items: ItemActionTarget[], maxButtons = 5, navigation?: ActiveListNavigation): InlineKeyboard | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const visibleItems = items.slice(0, maxButtons);
  for (const [index, item] of visibleItems.entries()) {
    const number = (navigation?.numberOffset ?? 0) + index + 1;
    keyboard.text(`Open ${kind} ${number}`, `item:${kind}:open:${item.id}:${navigation?.page ?? 1}`);

    if (index < visibleItems.length - 1) {
      keyboard.row();
    }
  }

  appendActiveListNavigation(keyboard, navigation, kind === "note" ? "notes" : "ideas");

  return keyboard;
}

function appendActiveListNavigation(
  keyboard: InlineKeyboard,
  navigation?: ActiveListNavigation,
  fallbackKind?: ActiveListNavigation["kind"]
): void {
  if (navigation && navigation.totalPages > 1) {
    keyboard.row();
    if (navigation.page > 1) keyboard.text("← Prev", `list:${navigation.kind}:${navigation.page - 1}`);
    keyboard.text(`Page ${navigation.page}/${navigation.totalPages}`, `list:${navigation.kind}:${navigation.page}`);
    if (navigation.page < navigation.totalPages) keyboard.text("Next →", `list:${navigation.kind}:${navigation.page + 1}`);
  }
  const kind = navigation?.kind ?? fallbackKind;
  keyboard.row().text(
    `‹ ${kind === "tasks" ? "Tasks" : kind === "notes" ? "Notes" : kind === "ideas" ? "Ideas" : "Main menu"}`,
    kind ? `menu:${kind}` : "menu:home"
  );
}

export function captureConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Save task", `capture:task:${pendingId}`)
    .text("💡 Save idea", `capture:idea:${pendingId}`)
    .row()
    .text("📝 Save note", `capture:note:${pendingId}`)
    .text("✕ Ignore", `capture:ignore:${pendingId}`);
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
    .text("⏰ Set reminder", `image:reminder:${pendingId}`)
    .text("💰 Save expense", `image:expense:${pendingId}`)
    .row()
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
    .text("🧾 Read as receipt", `image-upload:expense:${pendingId}`)
    .text("✕ Discard", `image-upload:discard:${pendingId}`);
}

export function storedImageListKeyboard(
  images: Array<{ id: string }>,
  page: number,
  totalPages: number,
  numberOffset: number,
  searchId?: string
): InlineKeyboard | undefined {
  if (!images.length) return undefined;
  const keyboard = new InlineKeyboard();
  images.forEach((item, index) => {
    keyboard.text(`🖼️ Open ${numberOffset + index + 1}`, `stored-image:open:${item.id}`);
    if (index < images.length - 1) keyboard.row();
  });
  if (totalPages > 1) {
    keyboard.row();
    const pagePrefix = searchId ? `stored-image:search:${searchId}` : "stored-image:page";
    if (page > 1) keyboard.text("← Prev", `${pagePrefix}:${page - 1}`);
    keyboard.text(`Page ${page}/${totalPages}`, `${pagePrefix}:${page}`);
    if (page < totalPages) keyboard.text("Next →", `${pagePrefix}:${page + 1}`);
  }
  keyboard.row().text("‹ Main menu", "menu:home");
  return keyboard;
}

export function storedImageActionsKeyboard(imageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Edit caption", `stored-image:caption:${imageId}`)
    .text("🗑️ Delete", `stored-image:delete:${imageId}`)
    .row()
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
