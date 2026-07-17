import { findIdeaReference } from "../services/ideas";
import { findNoteReference } from "../services/notes";
import { findTaskReference, formatAssignee, formatRecurrence } from "../services/tasks";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, h } from "../utils/html";
import { joinBlocks } from "../utils/messageFormat";
import { truncate } from "../utils/text";
import { itemActionsKeyboard, taskActionsKeyboard } from "./keyboards";

export type CardItemKind = "task" | "note" | "idea";

export async function buildItemCard(
  userId: string,
  kind: CardItemKind,
  reference: string,
  timezone = "UTC",
  heading?: string,
  includeDefaultBack = true
) {
  if (kind === "task") {
    const task = await findTaskReference(userId, reference);
    const description = withoutRepeatedTitle(task.title, task.description);
    const metadata = [
      task.dueAt ? `⏰ ${h(formatDateTimeForUser(task.dueAt, task.timezone ?? timezone))}` : "○ No due date",
      task.recurrenceRule ? `↻ ${h(formatRecurrence(task.recurrenceRule))}` : undefined,
      task.assignedUsername || task.assignedDisplayName || task.assignedTelegramId ? `👤 ${h(formatAssignee(task))}` : undefined,
      task.pinnedAt ? "⭐ Important" : undefined
    ].filter(Boolean).join("\n");
    const text = joinBlocks([
      heading ? bold(heading) : undefined,
      bold("📋 Task"),
      bold(task.title),
      description ? h(truncate(description, 700)) : undefined,
      metadata
    ]);
    return { text, keyboard: taskActionsKeyboard(task, includeDefaultBack) };
  }

  if (kind === "note") {
    const note = await findNoteReference(userId, reference);
    const body = withoutRepeatedTitle(note.title, note.body || note.summary);
    const text = joinBlocks([
      heading ? bold(heading) : undefined,
      bold("📝 Note"),
      bold(note.title),
      body ? h(truncate(body, 900)) : undefined,
      note.tags.length ? `#${note.tags.map((tag) => h(tag)).join("  #")}` : undefined,
      note.pinnedAt ? "⭐ Starred" : undefined
    ]);
    return { text, keyboard: itemActionsKeyboard("note", note, includeDefaultBack) };
  }

  const idea = await findIdeaReference(userId, reference);
  const concept = withoutRepeatedTitle(idea.title, idea.concept);
  const text = joinBlocks([
    heading ? bold(heading) : undefined,
    bold(`💡 Idea · ${String(idea.status ?? "raw").toLowerCase()}`),
    bold(idea.title),
    concept ? h(truncate(concept, 900)) : undefined,
    idea.tags.length ? `#${idea.tags.map((tag) => h(tag)).join("  #")}` : undefined,
    idea.pinnedAt ? "⭐ Starred" : undefined
  ]);
  return { text, keyboard: itemActionsKeyboard("idea", idea, includeDefaultBack) };
}

function withoutRepeatedTitle(title: string, body?: string | null): string | undefined {
  if (!body?.trim()) return undefined;
  const clean = body.trim();
  const normalizedTitle = title.trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedBody = clean.replace(/\s+/g, " ").toLowerCase();
  if (normalizedBody === normalizedTitle) return undefined;
  if (normalizedBody.startsWith(normalizedTitle)) {
    const remainder = clean.slice(title.trim().length).replace(/^[\s:–—|,.\-]+/, "").trim();
    return remainder || undefined;
  }
  return clean;
}
