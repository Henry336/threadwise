import type { Context } from "grammy";
import { formatRecentIdeas, listRecentIdeas } from "../services/ideas";
import { paginateList } from "../services/listPagination";
import { formatRecentNotes, listRecentNotes } from "../services/notes";
import { listOpenTasks } from "../services/tasks";
import { replyHtml } from "../utils/html";
import { formatOpenTasks } from "./formatters";
import { itemListKeyboard, taskListKeyboard } from "./keyboards";

export type ActiveListKind = "tasks" | "notes" | "ideas";

export async function replyActiveList(
  ctx: Context,
  user: { id: string; settings?: { timezone?: string | null } | null },
  kind: ActiveListKind,
  requestedPage = 1
): Promise<number> {
  if (kind === "tasks") {
    const page = paginateList(await listOpenTasks(user.id), requestedPage);
    const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset };
    await replyHtml(ctx, formatOpenTasks(page.items, user.settings?.timezone ?? "UTC", page), {
      reply_markup: taskListKeyboard(page.items, 10, navigation)
    });
    return page.page;
  }

  if (kind === "notes") {
    const page = paginateList(await listRecentNotes(user.id), requestedPage);
    const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset };
    await replyHtml(ctx, formatRecentNotes(page.items, page), {
      reply_markup: itemListKeyboard("note", page.items, 10, navigation)
    });
    return page.page;
  }

  const page = paginateList(await listRecentIdeas(user.id), requestedPage);
  const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset };
  await replyHtml(ctx, formatRecentIdeas(page.items, page), {
    reply_markup: itemListKeyboard("idea", page.items, 10, navigation)
  });
  return page.page;
}

export function isActiveListKind(value: string | undefined): value is ActiveListKind {
  return value === "tasks" || value === "notes" || value === "ideas";
}
