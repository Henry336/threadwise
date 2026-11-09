import type { Context } from "grammy";
import { InputFile } from "grammy";
import { createGoogleCalendarUrl, createIcs } from "../services/calendar";
import { calendarConfigured, calendarConnectionStatus, createCalendarConnectUrl, syncTaskToGoogleCalendar } from "../services/googleCalendar";
import { findTaskReference, type TaskListItem } from "../services/tasks";
import { calendarTaskKeyboard } from "./keyboards";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, code, h, replyHtml } from "../utils/html";
import { field, fieldHtml, joinBlocks } from "../utils/messageFormat";
import { normalizePublicId } from "../utils/text";
import { userFacingError } from "./errorResponses";

/**
 * The "connect Google Calendar once" card for a dated task, or undefined when Calendar is
 * already connected. Shared by the task Calendar button and "add task 3 to calendar" text
 * so both offer the same connect link and wording.
 */
export async function calendarTaskConnectCard(userId: string, chatId: string, task: TaskListItem) {
  const status = await calendarConnectionStatus(userId);
  if (status.connected) return undefined;
  if (!calendarConfigured()) throw new Error("Google Calendar connection setup is not available right now.");
  const connectUrl = await createCalendarConnectUrl(userId, chatId, { taskId: task.id });
  return {
    text: `${bold("📅 Add to Google Calendar")}\n${h(task.title)}\n${status.reconnectRequired ? "Your saved authorization expired or was revoked. Reconnect once; this reminder will be added after approval." : "Connect once; this reminder will be added automatically after approval."}`,
    keyboard: calendarTaskKeyboard(task, connectUrl),
    reconnectRequired: status.reconnectRequired,
  };
}

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
    await ctx.reply("I couldn’t find that task. Open /tasks and try its current number or Task ID.");
    return;
  }

  if (!task.dueAt) {
    await ctx.reply(`${task.publicId} needs a due date before I can put it on a calendar. Add a time, then try again.`);
    return;
  }

  const timezone = task.timezone ?? input.timezone ?? "UTC";
  if (input.includeIcs) {
    try {
      const synced = await syncTaskToGoogleCalendar(input.userId, task);
      if (synced) {
        await replyHtml(ctx, joinBlocks([
          bold(synced.created ? "✅ Added to Google Calendar" : "✅ Google Calendar updated"),
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
      await ctx.reply(`${userFacingError(error, "I couldn't sync that task to Google Calendar.")} I'll send the no-login fallback instead.`);
    }
  }

  const googleCalendarUrl = task.calendarUrl ?? createGoogleCalendarUrl({
    title: task.title,
    details: task.description ?? task.sourceText,
    dueAt: task.dueAt,
    timezone
  });

  await replyHtml(ctx, joinBlocks([
    bold("📅 Google Calendar link"),
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
