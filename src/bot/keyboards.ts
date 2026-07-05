import { InlineKeyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";

type TaskActionTarget = string | Pick<TaskListItem, "id" | "pinnedAt">;

export function taskActionsKeyboard(task: TaskActionTarget): InlineKeyboard {
  const taskId = typeof task === "string" ? task : task.id;
  const isPinned = typeof task === "string" ? false : Boolean(task.pinnedAt);

  return new InlineKeyboard()
    .text("Done", `task:done:${taskId}`)
    .text("Snooze 1h", `task:snooze:${taskId}`)
    .row()
    .text(isPinned ? "Unstar" : "Star", `task:${isPinned ? "unpin" : "pin"}:${taskId}`);
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
      .text(`${task.pinnedAt ? "Unstar" : "Star"} ${number}`, `task:${task.pinnedAt ? "unpin" : "pin"}:${task.id}`);

    if (index < visibleTasks.length - 1) {
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
