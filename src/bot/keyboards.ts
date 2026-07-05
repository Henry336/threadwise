import { InlineKeyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";

type TaskActionTarget = string | Pick<TaskListItem, "id" | "pinnedAt">;
type ItemKind = "task" | "note" | "idea";
type ItemActionTarget = { id: string; pinnedAt?: Date | null };

export function taskActionsKeyboard(task: TaskActionTarget): InlineKeyboard {
  const taskId = typeof task === "string" ? task : task.id;
  const isPinned = typeof task === "string" ? false : Boolean(task.pinnedAt);

  return new InlineKeyboard()
    .text("Done", `task:done:${taskId}`)
    .text("Snooze 1h", `task:snooze:${taskId}`)
    .row()
    .text(isPinned ? "Unstar" : "Star", `item:task:${isPinned ? "unpin" : "pin"}:${taskId}`)
    .text("Edit", `item:task:edit:${taskId}`);
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
      .text(`Done ${number}`, `task:done:${task.id}`)
      .text(`Snooze ${number}`, `task:snooze:${task.id}`)
      .text(`${task.pinnedAt ? "Unstar" : "Star"} ${number}`, `item:task:${task.pinnedAt ? "unpin" : "pin"}:${task.id}`)
      .text(`Edit ${number}`, `item:task:edit:${task.id}`);

    if (index < visibleTasks.length - 1) {
      keyboard.row();
    }
  }

  return keyboard;
}

export function itemActionsKeyboard(kind: ItemKind, item: ItemActionTarget): InlineKeyboard {
  const action = item.pinnedAt ? "unpin" : "pin";
  return new InlineKeyboard()
    .text(item.pinnedAt ? "Unstar" : "Star", `item:${kind}:${action}:${item.id}`)
    .text("Edit", `item:${kind}:edit:${item.id}`);
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
      .text(`Edit ${number}`, `item:${kind}:edit:${item.id}`);

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
    .text("Reflect", `capture:reflection:${pendingId}`)
    .row()
    .text("Ignore", `capture:ignore:${pendingId}`);
}

export function noteMergePreviewKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Merge", `merge:confirm:${pendingId}`)
    .text("Try again", `merge:retry:${pendingId}`)
    .row()
    .text("Cancel", `merge:cancel:${pendingId}`);
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
