import { InlineKeyboard } from "grammy";
import type { TaskListItem } from "../services/tasks";

export function taskActionsKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Done", `task:done:${taskId}`)
    .text("Snooze 1h", `task:snooze:${taskId}`);
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
      .text(`Snooze ${number}`, `task:snooze:${task.id}`);

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
