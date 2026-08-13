import type { Context } from "grammy";
import { formatRecentIdeas, listRecentIdeas } from "../services/ideas";
import { paginateList } from "../services/listPagination";
import { formatRecentNotes, listRecentNotes } from "../services/notes";
import { listOpenTasks } from "../services/tasks";
import { editOrReplyHtml } from "../utils/html";
import { formatOpenTasks } from "./formatters";
import { itemListKeyboard, modeBackKeyboard, taskListKeyboard } from "./keyboards";
import { replyControlCardHtml } from "./controlCards";
import { isGroupChat } from "./groupRouting";
import { groupWorkspaceForContext } from "../services/groupWorkspaces";

export type ActiveListKind = "tasks" | "notes" | "ideas";
const ACTIVE_LIST_PAGE_SIZE = 3;

export async function replyActiveList(
  ctx: Context,
  user: { id: string; settings?: { timezone?: string | null } | null },
  kind: ActiveListKind,
  requestedPage = 1,
  replaceCurrent = false,
  extraAction?: { label: string; callbackData: string },
  selecting = false,
): Promise<number> {
  return (await replyActiveListWithMessage(ctx, user, kind, requestedPage, replaceCurrent, extraAction, selecting)).page;
}

export async function replyActiveListWithMessage(
  ctx: Context,
  user: { id: string; settings?: { timezone?: string | null } | null },
  kind: ActiveListKind,
  requestedPage = 1,
  replaceCurrent = false,
  extraAction?: { label: string; callbackData: string },
  selecting = false,
): Promise<{ page: number; messageId?: number }> {
  const send = replaceCurrent ? editOrReplyHtml : replyControlCardHtml;
  const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
  if (kind === "tasks") {
    const page = paginateList(await listOpenTasks(user.id), requestedPage, ACTIVE_LIST_PAGE_SIZE);
    const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset, workspaceId: workspace?.id };
    const keyboard = taskListKeyboard(page.items, ACTIVE_LIST_PAGE_SIZE, navigation, selecting) ?? modeBackKeyboard("tasks");
    if (extraAction) keyboard.row().text(extraAction.label, extraAction.callbackData);
    const sent = await send(ctx, formatOpenTasks(page.items, user.settings?.timezone ?? "UTC", page), { reply_markup: keyboard });
    return { page: page.page, ...messageIdentity(sent, ctx.callbackQuery?.message?.message_id) };
  }

  if (kind === "notes") {
    const page = paginateList(await listRecentNotes(user.id), requestedPage, ACTIVE_LIST_PAGE_SIZE);
    const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset, workspaceId: workspace?.id };
    const keyboard = itemListKeyboard("note", page.items, ACTIVE_LIST_PAGE_SIZE, navigation, selecting) ?? modeBackKeyboard("notes");
    if (extraAction) keyboard.row().text(extraAction.label, extraAction.callbackData);
    const sent = await send(ctx, formatRecentNotes(page.items, page), { reply_markup: keyboard });
    return { page: page.page, ...messageIdentity(sent, ctx.callbackQuery?.message?.message_id) };
  }

  const page = paginateList(await listRecentIdeas(user.id), requestedPage, ACTIVE_LIST_PAGE_SIZE);
  const navigation = { kind, page: page.page, totalPages: page.totalPages, numberOffset: page.offset, workspaceId: workspace?.id };
  const keyboard = itemListKeyboard("idea", page.items, ACTIVE_LIST_PAGE_SIZE, navigation, selecting) ?? modeBackKeyboard("ideas");
  if (extraAction) keyboard.row().text(extraAction.label, extraAction.callbackData);
  const sent = await send(ctx, formatRecentIdeas(page.items, page), { reply_markup: keyboard });
  return { page: page.page, ...messageIdentity(sent, ctx.callbackQuery?.message?.message_id) };
}

function messageIdentity(result: unknown, fallback?: number): { messageId?: number } {
  if (result && typeof result === "object" && "message_id" in result) {
    const messageId = (result as { message_id?: unknown }).message_id;
    if (typeof messageId === "number" && Number.isSafeInteger(messageId) && messageId > 0) return { messageId };
  }
  return typeof fallback === "number" && Number.isSafeInteger(fallback) && fallback > 0 ? { messageId: fallback } : {};
}

export function isActiveListKind(value: string | undefined): value is ActiveListKind {
  return value === "tasks" || value === "notes" || value === "ideas";
}
