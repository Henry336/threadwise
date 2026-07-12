import type { Context } from "grammy";
import { InputFile } from "grammy";
import { createGoogleCalendarUrl, createIcs } from "../services/calendar";
import { syncTaskToGoogleCalendar } from "../services/googleCalendar";
import { findTaskReference } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, code, h, replyHtml } from "../utils/html";
import { field, fieldHtml, joinBlocks } from "../utils/messageFormat";
import { normalizePublicId } from "../utils/text";

export async function replyWithTaskCalendar(
  ctx: Context,
  input: {
    userId: string;
    reference: string;
    timezone?: string | null;
    includeIcs: boolean;
  }
): Promise<void> {
  let task;
  try {
    task = await findTaskReference(input.userId, normalizePublicId(input.reference));
  } catch {
    await ctx.reply("I couldn't find that task. /tasks will show the current list.");
    return;
  }

  if (!task.dueAt) {
    await ctx.reply(`${task.publicId} does not have a due date yet, so there is nothing calendar-shaped to export.`);
    return;
  }

  const timezone = task.timezone ?? input.timezone ?? "UTC";
  if (input.includeIcs) {
    try {
      const synced = await syncTaskToGoogleCalendar(input.userId, task);
      if (synced) {
        await replyHtml(ctx, joinBlocks([
          bold(synced.created ? "Added to Google Calendar" : "Updated in Google Calendar"),
          h(task.title),
          [
            fieldHtml("Task ID", code(task.publicId)),
            field("Due Date", formatDateTimeForUser(task.dueAt, timezone))
          ].join("\n"),
          h(synced.eventUrl)
        ]));
        return;
      }
    } catch (error) {
      await ctx.reply(`${error instanceof Error ? error.message : "Google Calendar sync failed."} I'll send the no-login fallback instead.`);
    }
  }

  const googleCalendarUrl = task.calendarUrl ?? createGoogleCalendarUrl({
    title: task.title,
    details: task.description ?? task.sourceText,
    dueAt: task.dueAt,
    timezone
  });

  await replyHtml(ctx, joinBlocks([
    bold("Google Calendar link"),
    h(task.title),
    [
      fieldHtml("Task ID", code(task.publicId)),
      field("Due Date", formatDateTimeForUser(task.dueAt, timezone))
    ].join("\n"),
    h(googleCalendarUrl)
  ]));

  if (!input.includeIcs) {
    return;
  }

  const ics = createIcs({
    title: task.title,
    details: task.description ?? task.sourceText,
    dueAt: task.dueAt,
    timezone
  });

  await ctx.replyWithDocument(new InputFile(Buffer.from(ics), `${task.publicId}.ics`));
}
