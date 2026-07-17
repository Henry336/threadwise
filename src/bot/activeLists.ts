import type { Context } from "grammy";
import { formatRecentIdeas, listRecentIdeas } from "../services/ideas";
import { paginateList } from "../services/listPagination";
import { formatRecentNotes, listRecentNotes } from "../services/notes";
import { listOpenTasks } from "../services/tasks";
import { editOrReplyHtml } from "../utils/html";
import { formatOpenTasks } from "./formatters";
import { itemListKeyboard, modeBackKeyboard, taskListKeyboard } from "./keyboards";
import { replyControlCardHtml } from "./controlCards";

export type ActiveListKind = "tasks" | "notes" | "ideas";

export async function replyActiveList(
  ctx: Context,
  user: { id: string; settings?: { timezone?: string | null } | null },
  kind: ActiveListKind,
  requestedPage = 1,
  replaceCurrent = false,
  extraAction?: { label: string; callbackData: string }
): Promise<number> {
  const send = replaceCurrent ? editOrReplyHtml : replyControlCardHtml;
  if (kind === "tasks") {
    const page = paginateList(await listOpenTasks(user.id), requestedPage, 5);
    const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset };
    const keyboard = taskListKeyboard(page.items, 5, navigation) ?? modeBackKeyboard("tasks");
    if (extraAction) keyboard.row().text(extraAction.label, extraAction.callbackData);
    await send(ctx, formatOpenTasks(page.items, user.settings?.timezone ?? "UTC", page), { reply_markup: keyboard });
    return page.page;
  }

  if (kind === "notes") {
    const page = paginateList(await listRecentNotes(user.id), requestedPage, 5);
    const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset };
    const keyboard = itemListKeyboard("note", page.items, 5, navigation) ?? modeBackKeyboard("notes");
    if (extraAction) keyboard.row().text(extraAction.label, extraAction.callbackData);
    await send(ctx, formatRecentNotes(page.items, page), { reply_markup: keyboard });
    return page.page;
  }

  const page = paginateList(await listRecentIdeas(user.id), requestedPage, 5);
  const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset };
  const keyboard = itemListKeyboard("idea", page.items, 5, navigation) ?? modeBackKeyboard("ideas");
  if (extraAction) keyboard.row().text(extraAction.label, extraAction.callbackData);
  await send(ctx, formatRecentIdeas(page.items, page), { reply_markup: keyboard });
  return page.page;
}

export function isActiveListKind(value: string | undefined): value is ActiveListKind {
  return value === "tasks" || value === "notes" || value === "ideas";
}
