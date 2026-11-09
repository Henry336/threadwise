/**
 * Shared "save a task from Telegram" step used by commands, callbacks, and natural-language
 * routing. It calls the task service, records group activity, and sends the quiet acknowledgement
 * so every entry point saves and answers the same way.
 */
import type { Context } from "grammy";
import { recordGroupTaskCreatedFromContext } from "../services/groupCollaboration";
import { createTask, formatTaskSavedAcknowledgement, type TaskCreationOptions, type TaskListItem } from "../services/tasks";
import { editOrReplyQuietAcknowledgementHtml, replyQuietAcknowledgementHtml } from "./quietAcknowledgements";

/**
 * Saves a task captured in Telegram, or a reminder when `dueAt` is set. It is the one copy of
 * the save path for every bot entry point: it applies the mention options (assignees), records
 * the group "added" activity, and sends the quiet saved acknowledgement, editing the tapped
 * card when `edit` is set. Pass the mentions of the message the text came from: for a review
 * card that is the stored PendingCapture, not the later tap or reply.
 */
export async function saveTaskFromTelegram(
  ctx: Context,
  user: { id: string; settings: { timezone: string } },
  sourceText: string,
  input: { dueAt?: Date; options?: TaskCreationOptions; edit?: boolean } = {},
): Promise<TaskListItem> {
  const task = await createTask(user.id, sourceText, input.dueAt ? { ...input.options, dueAt: input.dueAt } : input.options);
  await recordGroupTaskCreatedFromContext(ctx, user.id, task);
  const acknowledgement = formatTaskSavedAcknowledgement(task, user.settings.timezone);
  if (input.edit) await editOrReplyQuietAcknowledgementHtml(ctx, acknowledgement);
  else await replyQuietAcknowledgementHtml(ctx, acknowledgement);
  return task;
}
