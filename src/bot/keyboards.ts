import { InlineKeyboard } from "grammy";

export function taskActionsKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Done", `task:done:${taskId}`)
    .text("Snooze 1h", `task:snooze:${taskId}`);
}

export function captureConfirmationKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Save task", `capture:task:${pendingId}`)
    .text("Save idea", `capture:idea:${pendingId}`)
    .row()
    .text("Reflect", `capture:reflection:${pendingId}`)
    .text("Ignore", `capture:ignore:${pendingId}`);
}

