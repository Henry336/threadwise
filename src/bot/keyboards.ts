import { InlineKeyboard, Keyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";

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
    .text("📋 Tasks", "menu:tasks").text("⏰ Reminders", "menu:reminders").row()
    .text("📝 Notes", "menu:notes").text("💡 Ideas", "menu:ideas").row()
    .text("🖼️ Images", "menu:images").text("💰 Expenses", "menu:expenses").row()
    .text("📅 Calendar + 📊 Excel", "menu:integrations").text("⚙️ Settings", "menu:settings").row()
    .text("🔎 Search + cleanup", "menu:search").text("❓ All help", "menu:help");
}

export const PRIVATE_MENU_LABELS = {
  tasks: "📋 Tasks",
  reminders: "⏰ Reminders",
  notes: "📝 Notes",
  ideas: "💡 Ideas",
  images: "🖼️ Images",
  expenses: "💰 Expenses",
  search: "🔎 Search",
  settings: "⚙️ Settings",
  help: "❓ Help",
  hide: "Hide menu"
} as const;

export function privateMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(PRIVATE_MENU_LABELS.tasks).text(PRIVATE_MENU_LABELS.reminders).row()
    .text(PRIVATE_MENU_LABELS.notes).text(PRIVATE_MENU_LABELS.ideas).row()
    .text(PRIVATE_MENU_LABELS.images).text(PRIVATE_MENU_LABELS.expenses).row()
    .text(PRIVATE_MENU_LABELS.search).text(PRIVATE_MENU_LABELS.settings).row()
    .text(PRIVATE_MENU_LABELS.help).text(PRIVATE_MENU_LABELS.hide)
    .resized()
    .persistent()
    .placeholder("Tell Threadwise what you need…");
}

export function helpTopicsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Reminders", "menu:reminders").text("Notes", "menu:notes-help").row()
    .text("Ideas", "menu:ideas-help").text("Images", "menu:images-help").row()
    .text("Expenses", "menu:expenses").text("Excel", "menu:excel").row()
    .text("Search", "menu:search").text("Settings", "menu:settings").row()
    .text("Commands", "menu:commands");
}

export function taskActionsKeyboard(task: TaskActionTarget): InlineKeyboard {
  const taskId = typeof task === "string" ? task : task.id;
  const isPinned = typeof task === "string" ? false : Boolean(task.pinnedAt);

  return new InlineKeyboard()
    .text("Complete task", `task:done:${taskId}`)
    .text("Snooze 1h", `task:snooze:${taskId}`)
    .row()
    .text(isPinned ? "Unstar" : "Star", `item:task:${isPinned ? "unpin" : "pin"}:${taskId}`)
    .text("Edit title", `item:task:edit:title:${taskId}`)
    .row()
    .text("Edit details", `item:task:edit:description:${taskId}`)
    .text("Cancel task", `task:cancel:${taskId}`);
}

export function taskCreatedKeyboard(task: TaskActionTarget): InlineKeyboard {
  return taskActionsKeyboard(task)
    .row()
    .text("Undo save", "undo:last");
}

export function taskListKeyboard(tasks: TaskListItem[], maxButtons = 10, navigation?: ActiveListNavigation): InlineKeyboard | undefined {
  if (tasks.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const visibleTasks = tasks.slice(0, maxButtons);
  for (const [index, task] of visibleTasks.entries()) {
    const number = (navigation?.numberOffset ?? 0) + index + 1;
    keyboard
      .text(`Complete ${number}`, `task:done:${task.id}`)
      .text(`Snooze ${number}`, `task:snooze:${task.id}`)
      .text(`${task.pinnedAt ? "Unstar" : "Star"} ${number}`, `item:task:${task.pinnedAt ? "unpin" : "pin"}:${task.id}`)
      .text(`Edit ${number}`, `item:task:edit:title:${task.id}`);

    if (index < visibleTasks.length - 1) {
      keyboard.row();
    }
  }

  appendActiveListNavigation(keyboard, navigation);

  return keyboard;
}

export function itemCreatedKeyboard(kind: Exclude<ItemKind, "task">, item: ItemActionTarget): InlineKeyboard {
  return itemActionsKeyboard(kind, item)
    .row()
    .text("Undo save", "undo:last");
}

export function undoKeyboard(label = "Undo"): InlineKeyboard {
  return new InlineKeyboard().text(label, "undo:last");
}

export function restoreCompletedTaskKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard().text("Restore task", `task:restore:${taskId}`);
}

export function editCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Cancel edit", "edit:cancel");
}

export function itemActionsKeyboard(kind: ItemKind, item: ItemActionTarget): InlineKeyboard {
  const action = item.pinnedAt ? "unpin" : "pin";
  const bodyField = kind === "task" ? "description" : kind === "note" ? "body" : "concept";
  const bodyLabel = kind === "task" ? "details" : bodyField;
  const keyboard = new InlineKeyboard()
    .text(item.pinnedAt ? "Unstar" : "Star", `item:${kind}:${action}:${item.id}`)
    .text("Edit title", `item:${kind}:edit:title:${item.id}`)
    .row()
    .text(`Edit ${bodyLabel}`, `item:${kind}:edit:${bodyField}:${item.id}`);

  if (kind === "note") {
    keyboard.row().text("Archive note", `item:note:archive:${item.id}`);
  }

  return keyboard;
}

export function itemListKeyboard(kind: Exclude<ItemKind, "task">, items: ItemActionTarget[], maxButtons = 10, navigation?: ActiveListNavigation): InlineKeyboard | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const visibleItems = items.slice(0, maxButtons);
  for (const [index, item] of visibleItems.entries()) {
    const number = (navigation?.numberOffset ?? 0) + index + 1;
    keyboard
      .text(`${item.pinnedAt ? "Unstar" : "Star"} ${number}`, `item:${kind}:${item.pinnedAt ? "unpin" : "pin"}:${item.id}`)
      .text(`Edit ${number}`, `item:${kind}:edit:title:${item.id}`);

    if (kind === "note") {
      keyboard.text(`Archive ${number}`, `item:note:archive:${item.id}`);
    }

    if (index < visibleItems.length - 1) {
      keyboard.row();
    }
  }

  appendActiveListNavigation(keyboard, navigation);

  return keyboard;
}

function appendActiveListNavigation(keyboard: InlineKeyboard, navigation?: ActiveListNavigation): void {
  if (!navigation || navigation.totalPages <= 1) return;
  keyboard.row();
  if (navigation.page > 1) keyboard.text("Prev", `list:${navigation.kind}:${navigation.page - 1}`);
  keyboard.text(`Page ${navigation.page}/${navigation.totalPages}`, `list:${navigation.kind}:${navigation.page}`);
  if (navigation.page < navigation.totalPages) keyboard.text("Next", `list:${navigation.kind}:${navigation.page + 1}`);
}

export function captureConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Save task", `capture:task:${pendingId}`)
    .text("Save idea", `capture:idea:${pendingId}`)
    .row()
    .text("Save note", `capture:note:${pendingId}`)
    .text("Ignore", `capture:ignore:${pendingId}`);
}

export function noteMergePreviewKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Merge", `merge:confirm:${pendingId}`)
    .text("Try again", `merge:retry:${pendingId}`)
    .row()
    .text("Cancel", `merge:cancel:${pendingId}`);
}

export function searchPageKeyboard(pendingId: string, page: number, totalPages: number): InlineKeyboard | undefined {
  if (totalPages <= 1) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  if (page > 1) {
    keyboard.text("Prev", `search:${pendingId}:${page - 1}`);
  }

  keyboard.text(`Page ${page}/${totalPages}`, `search:${pendingId}:${page}`);

  if (page < totalPages) {
    keyboard.text("Next", `search:${pendingId}:${page + 1}`);
  }

  return keyboard;
}

export function archivedPageKeyboard(kind: string, page: number, totalPages: number): InlineKeyboard | undefined {
  if (totalPages <= 1) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  if (page > 1) {
    keyboard.text("Prev", `archived:${kind}:${page - 1}`);
  }

  keyboard.text(`Page ${page}/${totalPages}`, `archived:${kind}:${page}`);

  if (page < totalPages) {
    keyboard.text("Next", `archived:${kind}:${page + 1}`);
  }

  return keyboard;
}

export function bulkActionConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Confirm", `bulk:confirm:${pendingId}`)
    .text("Cancel", `bulk:cancel:${pendingId}`);
}

export function imageTextActionsKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Save note", `image:note:${pendingId}`)
    .text("Create task", `image:task:${pendingId}`)
    .row()
    .text("Set reminder", `image:reminder:${pendingId}`)
    .text("Save expense", `image:expense:${pendingId}`)
    .row()
    .text("Show full text", `image:text:${pendingId}`)
    .text("Discard", `image:discard:${pendingId}`);
}

export function incomingImageKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🖼️ Save image", `image-upload:save:${pendingId}`)
    .text("✏️ Save with caption", `image-upload:caption:${pendingId}`).row()
    .text("🔎 Extract text", `image-upload:extract:${pendingId}`)
    .text("✅ Save + extract", `image-upload:save-extract:${pendingId}`)
    .row()
    .text("🧾 Read as receipt", `image-upload:expense:${pendingId}`)
    .text("Discard", `image-upload:discard:${pendingId}`);
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
    keyboard.text(`Open ${numberOffset + index + 1}`, `stored-image:open:${item.id}`);
    if (index < images.length - 1) keyboard.row();
  });
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
    .text("✏️ Edit caption", `stored-image:caption:${imageId}`)
    .text("🗑️ Delete", `stored-image:delete:${imageId}`);
}

export function storedImageDeleteKeyboard(imageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Yes, delete", `stored-image:delete-confirm:${imageId}`)
    .text("Keep image", `stored-image:delete-cancel:${imageId}`);
}

export function expenseConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Save in Threadwise", `expense:save:${pendingId}`)
    .row()
    .text("Save + sync Excel", `expense:excel:${pendingId}`)
    .row()
    .text("Edit fields", `expense:edit:${pendingId}`)
    .text("Discard", `expense:discard:${pendingId}`);
}

export function expensePageKeyboard(encodedFilter: string, page: number, totalPages: number): InlineKeyboard | undefined {
  if (totalPages <= 1) return undefined;
  const keyboard = new InlineKeyboard();
  if (page > 1) keyboard.text("Prev", `expense:page:${encodedFilter}:${page - 1}`);
  keyboard.text(`Page ${page}/${totalPages}`, `expense:page:${encodedFilter}:${page}`);
  if (page < totalPages) keyboard.text("Next", `expense:page:${encodedFilter}:${page + 1}`);
  return keyboard;
}
