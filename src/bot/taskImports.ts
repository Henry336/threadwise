import { TaskImportItemStatus, TaskImportStatus, TaskStatus } from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { AiProvider } from "../ai/types";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import {
  cancelTaskImport,
  createPendingTaskImport,
  getTaskImportReview,
  importReviewedTasks,
  taskImportBelongsToChat,
  TaskImportError,
  type TaskImportReview,
} from "../services/taskImports";
import { collaborationActorFromContext } from "../services/groupCollaboration";
import { groupWorkspaceForContext, isGroupManager } from "../services/groupWorkspaces";
import { ensureUser } from "../services/users";
import { formatDateTimeForUser } from "../utils/dates";
import { bold, editOrReplyHtml, h, replyHtml } from "../utils/html";
import { userFacingError } from "./errorResponses";
import { isExplicitGroupTaskImport, isGroupChat } from "./groupRouting";
import { groupDashboardUrl, groupTaskImportReviewUrl } from "./links";
import { editOrReplyQuietAcknowledgementHtml } from "./quietAcknowledgements";
import { taskCreationOptionsFromContext } from "./taskMentions";

export const TASK_IMPORT_PAGE_SIZE = 6;

export function registerTaskImports(bot: Bot, ai: AiProvider): void {
  bot.on("message:text", async (ctx, next) => {
    const sourceText = ctx.message.text;
    if (!isGroupChat(ctx) || !isExplicitGroupTaskImport(sourceText) || !ctx.from) {
      await next();
      return;
    }
    const user = await ensureUser(ctx);
    const workspace = await groupWorkspaceForContext(ctx);
    if (!workspace) {
      await ctx.reply("I couldn't open this group's task review just now. Try sending the TODO list again.");
      return;
    }
    try {
      const taskImport = await createPendingTaskImport({
        ownerUserId: user.id,
        workspaceId: workspace.id,
        requestedByTelegramId: String(ctx.from.id),
        requestedByName: displayName(ctx),
        sourceText,
        timezone: user.settings?.timezone ?? "UTC",
        mentions: taskCreationOptionsFromContext(ctx, sourceText).mentions,
        telegramThreadId: "message_thread_id" in ctx.message ? ctx.message.message_thread_id : undefined,
      });
      const message = await replyHtml(ctx, formatTaskImportPreviewHtml(taskImport, user.settings?.timezone ?? "UTC", 0), {
        reply_markup: taskImportKeyboard(taskImport, 0),
      }) as { message_id?: number };
      if (message.message_id) {
        try {
          await prisma.pendingTaskImport.update({ where: { id: taskImport.id }, data: { telegramMessageId: message.message_id } });
        } catch (error) {
          logger.warn("Task import preview was sent but its Telegram message id could not be recorded.", { importId: taskImport.id, error: String(error) });
        }
      }
    } catch (error) {
      await ctx.reply(error instanceof TaskImportError ? error.message : userFacingError(error, "I couldn't prepare that TODO list. Check the formatting and try again."));
    }
  });

  bot.callbackQuery(/^ti:(import|cancel|refresh):([0-9a-f-]+)$/i, async (ctx) => {
    const action = ctx.match[1]?.toLowerCase();
    const importId = ctx.match[2];
    if (!importId || (action !== "import" && action !== "cancel" && action !== "refresh")) return;
    await handleTaskImportCallback(ctx, ai, action, importId);
  });

  bot.callbackQuery(/^ti:page:([0-9a-f-]+):(\d+)$/i, async (ctx) => {
    const importId = ctx.match[1];
    const page = Number(ctx.match[2]);
    if (!importId || !Number.isSafeInteger(page) || page < 0) return;
    await handleTaskImportPageCallback(ctx, importId, page);
  });

  bot.callbackQuery(/^ti:pageinfo:([0-9a-f-]+):(\d+)$/i, async (ctx) => {
    const page = Number(ctx.match[2]);
    await ctx.answerCallbackQuery({ text: Number.isSafeInteger(page) ? `Page ${page + 1}` : "Task review" });
  });
}

async function handleTaskImportPageCallback(ctx: Context, importId: string, requestedPage: number): Promise<void> {
  if (!ctx.from) return;
  try {
    const taskImport = await getTaskImportReview(importId);
    if (!isGroupChat(ctx) || !taskImportBelongsToChat(taskImport.workspace.telegramChatId, ctx.chat?.id)) {
      throw new TaskImportError("This review belongs to another group.", "forbidden");
    }
    const page = clampTaskImportPage(taskImport, requestedPage);
    await ctx.answerCallbackQuery({ text: `Page ${page + 1} of ${taskImportPageCount(taskImport)}` });
    await editOrReplyHtml(ctx, formatTaskImportPreviewHtml(taskImport, await importTimezone(taskImport.ownerUserId), page), {
      reply_markup: taskImportKeyboard(taskImport, page),
    });
  } catch (error) {
    const message = error instanceof TaskImportError ? error.message : userFacingError(error, "That review page couldn't be opened just now.");
    try {
      await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
    } catch {
      await ctx.reply(message);
    }
  }
}

async function handleTaskImportCallback(
  ctx: Context,
  ai: AiProvider,
  action: "import" | "cancel" | "refresh",
  importId: string,
): Promise<void> {
  if (!ctx.from) return;
  try {
    const taskImport = await getTaskImportReview(importId);
    if (!isGroupChat(ctx) || !taskImportBelongsToChat(taskImport.workspace.telegramChatId, ctx.chat?.id)) {
      throw new TaskImportError("This review belongs to another group.", "forbidden");
    }
    const sender = taskImport.requestedByTelegramId === String(ctx.from.id);
    const isManager = sender ? false : await isGroupManager(ctx);
    const actor = { ...collaborationActorFromContext(ctx), isManager };
    if (action === "refresh") {
      if (!sender && !isManager) throw new TaskImportError("Only the sender or a group administrator can open this review.", "forbidden");
      await ctx.answerCallbackQuery({ text: "Review refreshed" });
      await editOrReplyHtml(ctx, formatTaskImportPreviewHtml(taskImport, await importTimezone(taskImport.ownerUserId), 0), {
        reply_markup: taskImportKeyboard(taskImport, 0),
      });
      return;
    }
    if (action === "cancel") {
      await cancelTaskImport(importId, actor);
      await ctx.answerCallbackQuery({ text: "Import canceled" });
      await editOrReplyQuietAcknowledgementHtml(ctx, `${bold("Canceled")} · No tasks were added.`);
      return;
    }

    await ctx.answerCallbackQuery({ text: "Importing tasks…" });
    const result = await importReviewedTasks(importId, actor, ai);
    if (result.failed > 0) {
      await editOrReplyHtml(ctx, [
        bold("Some tasks need another look"),
        `${result.imported} imported · ${result.failed} need review${result.skipped ? ` · ${result.skipped} skipped` : ""}`,
      ].join("\n"), { reply_markup: taskImportKeyboard(result.taskImport, 0) });
      return;
    }
    await editOrReplyQuietAcknowledgementHtml(
      ctx,
      `${bold("Imported")} · ${result.imported} task${result.imported === 1 ? "" : "s"}${result.skipped ? ` · ${result.skipped} skipped` : ""}`,
      5_000,
    );
  } catch (error) {
    const message = error instanceof TaskImportError ? error.message : userFacingError(error, "That task import couldn't be completed just now.");
    try {
      await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
    } catch {
      await ctx.reply(message);
    }
  }
}

export function formatTaskImportPreviewHtml(taskImport: TaskImportReview, timezone: string, requestedPage = 0): string {
  const included = includedTaskImportItems(taskImport);
  const completed = included.filter((item) => item.initialStatus === TaskStatus.DONE).length;
  const assigned = included.filter((item) => Array.isArray(item.assignees) && item.assignees.length > 0).length;
  const teamOwned = included.filter((item) => item.teamOwnerLabel).length;
  const pageCount = taskImportPageCount(taskImport);
  const page = clampTaskImportPage(taskImport, requestedPage);
  const pageStart = page * TASK_IMPORT_PAGE_SIZE;
  const rows = included.slice(pageStart, pageStart + TASK_IMPORT_PAGE_SIZE).map((item) => {
    const owner = importOwnerLabel(item.assignees, item.teamOwnerLabel);
    const due = item.dueAt ? ` · ${formatDateTimeForUser(item.dueAt, timezone)}` : "";
    const status = item.initialStatus === TaskStatus.DONE ? " · done" : "";
    return `${item.position}. ${h(item.title)}${owner ? ` — ${h(owner)}` : ""}${h(due + status)}`;
  });
  const state = taskImport.status === TaskImportStatus.PARTIAL
    ? "Fix the failed rows in Edit details, then retry."
    : "Import when ready. Use Edit details only to make corrections.";
  return [
    bold(`TODO review${pageCount > 1 ? ` · Page ${page + 1}/${pageCount}` : ""}`),
    `${included.length} task${included.length === 1 ? "" : "s"} found · ${assigned} assigned${teamOwned ? ` · ${teamOwned} team-owned` : ""}${completed ? ` · ${completed} done` : ""}`,
    "",
    ...rows,
    "",
    h(state),
  ].join("\n");
}

function taskImportKeyboard(taskImport: TaskImportReview, requestedPage: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const page = clampTaskImportPage(taskImport, requestedPage);
  const pageCount = taskImportPageCount(taskImport);
  if (pageCount > 1) {
    if (page > 0) keyboard.text("←", `ti:page:${taskImport.id}:${page - 1}`);
    keyboard.text(`${page + 1}/${pageCount}`, `ti:pageinfo:${taskImport.id}:${page}`);
    if (page < pageCount - 1) keyboard.text("→", `ti:page:${taskImport.id}:${page + 1}`);
    keyboard.row();
  }
  keyboard.url("Edit details", groupTaskImportReviewUrl(taskImport.workspaceId, taskImport.id)).row();
  if (taskImport.status === TaskImportStatus.PENDING || taskImport.status === TaskImportStatus.PARTIAL) {
    const includedCount = includedTaskImportItems(taskImport).length;
    keyboard.text(taskImport.status === TaskImportStatus.PARTIAL ? "Retry ready rows" : `Import ${includedCount}`, `ti:import:${taskImport.id}`)
      .text("Cancel", `ti:cancel:${taskImport.id}`).row();
  }
  keyboard.url("Group work", groupDashboardUrl(taskImport.workspaceId, "work"));
  return keyboard;
}

function includedTaskImportItems(taskImport: TaskImportReview): TaskImportReview["items"] {
  return taskImport.items.filter((item) => item.included && item.status !== TaskImportItemStatus.SKIPPED);
}

export function taskImportPageCount(taskImport: TaskImportReview): number {
  return Math.max(1, Math.ceil(includedTaskImportItems(taskImport).length / TASK_IMPORT_PAGE_SIZE));
}

function clampTaskImportPage(taskImport: TaskImportReview, requestedPage: number): number {
  return Math.min(Math.max(0, Math.trunc(requestedPage)), taskImportPageCount(taskImport) - 1);
}

function importOwnerLabel(value: unknown, teamOwnerLabel: string | null): string {
  const assignees = Array.isArray(value) ? value : [];
  const people = assignees.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    const record = item as Record<string, unknown>;
    return typeof record.username === "string" ? `@${record.username}` : typeof record.displayName === "string" ? record.displayName : "";
  }).filter(Boolean);
  return [...people, ...(teamOwnerLabel ? [teamOwnerLabel] : [])].join(" + ");
}

async function importTimezone(ownerUserId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { settings: { select: { timezone: true } } } });
  return user?.settings?.timezone ?? "UTC";
}

function displayName(ctx: Context): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "Group member";
}
