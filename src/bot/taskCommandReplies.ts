/**
 * Telegram reply copy for task commands (complete, snooze, cancel, assign, unassign).
 * The command itself runs in services/taskCommands.ts; this file only turns its result into
 * a message with the matching Undo button.
 */
import type { Context } from "grammy";
import { formatAssignee, formatTaskAlreadyCompleted, formatTaskCompleted } from "../services/tasks";
import type { TaskCommandResult } from "../services/taskCommands";
import { bold, code, h, replyHtml } from "../utils/html";
import { isGroupChat } from "./groupRouting";
import { restoreCompletedTaskKeyboard, undoKeyboard } from "./keyboards";

/**
 * Replies to a task command typed as a slash command or natural text. Both entry points
 * share this copy so "/done 3" and "done 3" always answer the same way. Buttons edit their
 * card in place instead and render the same result in callbacks.ts.
 */
export async function replyTaskCommandResult(ctx: Context, result: TaskCommandResult, timezone: string): Promise<void> {
  const { task } = result;
  switch (result.action) {
    case "complete":
      if (result.status !== "completed") {
        await replyHtml(ctx, formatTaskAlreadyCompleted(task), { reply_markup: restoreCompletedTaskKeyboard(task.id) });
        return;
      }
      await replyHtml(ctx, `${formatTaskCompleted(result.task, timezone)}\n${code("/undo")} if that was too quick.`, { reply_markup: undoKeyboard("↩️ Undo complete") });
      return;
    case "snooze":
      await replyHtml(ctx, `${bold("⏰ Snoozed")} ${code(task.publicId)} ${h(task.title)}\nI’ll bring it back later. ${code("/undo")} restores the previous reminder time.`, { reply_markup: undoKeyboard("↩️ Undo snooze") });
      return;
    case "cancel":
      await replyHtml(ctx, `${bold("🗑️ Task canceled")} ${code(task.publicId)} ${h(task.title)}\n${code("/undo")} brings it back if you still need it.`, { reply_markup: undoKeyboard("↩️ Undo cancel") });
      return;
    case "assign":
      await replyHtml(ctx, `${bold("👥 Assignees updated")} ${code(result.task.publicId)}\nNow with ${h(formatAssignee(result.task))}.${assigneeDmSetupLine(ctx)}`);
      return;
    case "unassign":
      await replyHtml(ctx, `${bold("👥 Assignees updated")} ${code(result.task.publicId)} ${h(formatAssignee(result.task))}`);
      return;
  }
}

/** Points group members at the private-nudge opt-in after an assignment, since DMs need it. */
function assigneeDmSetupLine(ctx: Context): string {
  if (!isGroupChat(ctx) || !ctx.me.username) return "";
  return `\nPrivate nudges are opt-in: https://t.me/${ctx.me.username}?start=dm`;
}
