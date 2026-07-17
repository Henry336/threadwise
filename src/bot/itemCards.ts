import { findIdeaReference } from "../services/ideas";
import { findNoteReference } from "../services/notes";
import { findTaskReference, formatAssignee, formatRecurrence } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, h } from "../utils/html";
import { truncate } from "../utils/text";
import { itemActionsKeyboard, taskActionsKeyboard } from "./keyboards";

export type CardItemKind = "task" | "note" | "idea";

export async function buildItemCard(
  userId: string,
  kind: CardItemKind,
  reference: string,
  timezone = "UTC",
  heading?: string
) {
  if (kind === "task") {
    const task = await findTaskReference(userId, reference);
    const lines = [
      heading ? bold(heading) : undefined,
      bold(task.title),
      task.description ? h(truncate(task.description, 700)) : undefined,
      task.dueAt ? `⏰ ${h(formatDateTimeForUser(task.dueAt, task.timezone ?? timezone))}` : "○ No due date",
      task.recurrenceRule ? `↻ ${h(formatRecurrence(task.recurrenceRule))}` : undefined,
      task.assignedUsername || task.assignedDisplayName || task.assignedTelegramId
        ? `👤 ${h(formatAssignee(task))}`
        : undefined,
      task.pinnedAt ? "⭐ Important" : undefined
    ].filter(Boolean).join("\n");
    return { text: lines, keyboard: taskActionsKeyboard(task) };
  }

  if (kind === "note") {
    const note = await findNoteReference(userId, reference);
    const lines = [
      heading ? bold(heading) : undefined,
      bold(note.title),
      h(truncate(note.body || note.summary, 900)),
      note.pinnedAt ? "⭐ Starred" : undefined
    ].filter(Boolean).join("\n");
    return { text: lines, keyboard: itemActionsKeyboard("note", note) };
  }

  const idea = await findIdeaReference(userId, reference);
  const lines = [
    heading ? bold(heading) : undefined,
    bold(idea.title),
    h(truncate(idea.concept, 900)),
    idea.status ? `Status: ${h(String(idea.status).toLowerCase())}` : undefined,
    idea.pinnedAt ? "⭐ Starred" : undefined
  ].filter(Boolean).join("\n");
  return { text: lines, keyboard: itemActionsKeyboard("idea", idea) };
}
