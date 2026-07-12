import { InlineKeyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";

type TaskActionTarget = string | Pick<TaskListItem, "id" | "pinnedAt">;
type ItemKind = "task" | "note" | "idea";
type ItemActionTarget = { id: string; pinnedAt?: Date | null };

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

export function taskListKeyboard(tasks: TaskListItem[], maxButtons = 10): InlineKeyboard | undefined {
  if (tasks.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const visibleTasks = tasks.slice(0, maxButtons);
  for (const [index, task] of visibleTasks.entries()) {
    const number = index + 1;
    keyboard
      .text(`Complete ${number}`, `task:done:${task.id}`)
      .text(`Snooze ${number}`, `task:snooze:${task.id}`)
      .text(`${task.pinnedAt ? "Unstar" : "Star"} ${number}`, `item:task:${task.pinnedAt ? "unpin" : "pin"}:${task.id}`)
      .text(`Edit ${number}`, `item:task:edit:title:${task.id}`);

    if (index < visibleTasks.length - 1) {
      keyboard.row();
    }
  }

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

export function itemListKeyboard(kind: Exclude<ItemKind, "task">, items: ItemActionTarget[], maxButtons = 10): InlineKeyboard | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  const visibleItems = items.slice(0, maxButtons);
  for (const [index, item] of visibleItems.entries()) {
    const number = index + 1;
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

  return keyboard;
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
