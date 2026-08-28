import { PlanningScope, StudyItemType, type StudyModule } from "@prisma/client";
import { Bot, Context, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { getDailyAgenda, planDailyAgendaEntry, type AgendaEntry, type DailyAgenda } from "../services/dailyAgenda";
import { groupWorkspaceForContext } from "../services/groupWorkspaces";
import { isStudyContext, listStudyModules, requireStudyWorkspace } from "../services/study";
import {
  appendTaskCaptureDraft,
  collectTaskCaptureDraft,
  commitTaskCaptureDraft,
  createTaskCaptureDraft,
  findActiveTaskCaptureDraft,
  rememberTaskCaptureDraftTelegramReview,
  reviewTaskCaptureDraft,
  updateTaskCaptureDraftItem,
  type TaskCaptureDraftRecord,
  type TaskCaptureScope,
} from "../services/taskCaptureDrafts";
import { calendarDate, splitTaskDraftText } from "../services/taskPlanning";
import { ensureUser } from "../services/users";
import { parseDueDate } from "../utils/dates";
import { bold, code, h, replyHtml } from "../utils/html";
import { commandBody } from "../utils/text";
import { isGroupChat } from "./groupRouting";
import { dashboardViewUrl, groupDashboardUrl, todayDraftDashboardUrl } from "./links";
import { userFacingError } from "./errorResponses";

const ACTION_START = /^(?:add|buy|call|collect|complete|email|finish|fix|meet|pay|plan|prepare|read|replace|return|revise|send|start|study|submit|write)\b/i;

type BotTodayScope = {
  capture: TaskCaptureScope;
  dashboardWorkspace?: { id: string; study: boolean };
  modules: StudyModule[];
};

export function registerTodayInteractions(bot: Bot): void {
  bot.command("today", async (ctx) => handleToday(ctx));
  bot.command(["todo", "todos"], async (ctx) => {
    const text = commandBody(ctx.message?.text ?? "", /\/todos?\b/i.test(ctx.message?.text ?? "") ? "todos" : "todo");
    if (!text) return handleToday(ctx);
    await beginDraft(ctx, text);
  });

  bot.callbackQuery(/^td:(save|add|review|edit):([0-9a-f-]+)$/i, async (ctx) => {
    if (!todayOwner(ctx)) return ctx.answerCallbackQuery({ text: "This preview is private.", show_alert: true });
    const scope = await resolveScope(ctx);
    const action = ctx.match[1]?.toLowerCase();
    const draftId = ctx.match[2] ?? "";
    await ctx.answerCallbackQuery().catch(() => undefined);
    if (action === "save") {
      const draft = await commitTaskCaptureDraft(draftId, scope.capture.principalTelegramId);
      await editDraftMessage(ctx, formatSavedDraft(draft), new InlineKeyboard().text("View Today", "td:today"));
      return;
    }
    if (action === "add") {
      const draft = await collectTaskCaptureDraft(draftId, scope.capture.principalTelegramId);
      await editDraftMessage(ctx, formatCollectingDraft(draft), new InlineKeyboard().text("Review list", `td:review:${draft.id}`));
      return;
    }
    if (action === "review") {
      const draft = await reviewTaskCaptureDraft(draftId, scope.capture.principalTelegramId);
      await editDraftMessage(ctx, formatDraftReview(draft, scope.modules), reviewKeyboard(draft));
      return;
    }
    const draft = await reviewTaskCaptureDraft(draftId, scope.capture.principalTelegramId);
    const url = todayDraftDashboardUrl(draft.id, scope.dashboardWorkspace);
    await editDraftMessage(ctx, formatDraftEditHelp(draft), new InlineKeyboard()
      .url("Open detailed editor", url)
      .row()
      .text("Back to review", `td:review:${draft.id}`));
  });

  bot.callbackQuery("td:today", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await handleToday(ctx);
  });

  bot.callbackQuery("td:capture", async (ctx) => {
    if (!todayOwner(ctx)) return ctx.answerCallbackQuery({ text: "This planner is private.", show_alert: true });
    await ctx.answerCallbackQuery().catch(() => undefined);
    await replyHtml(ctx, formatTodayCapturePrompt(), {
      reply_markup: {
        force_reply: true,
        selective: true,
        input_field_placeholder: "Buy groceries, prepare tutorial…",
      },
    });
  });

  bot.callbackQuery(/^td:carry-prompt:([0-9a-f-]+)$/i, async (ctx) => {
    if (!todayOwner(ctx)) return ctx.answerCallbackQuery({ text: "This plan is private.", show_alert: true });
    const scope = await resolveScope(ctx);
    const agenda = await getDailyAgenda({
      principalTelegramId: scope.capture.principalTelegramId,
      scope: scope.capture.scope,
      groupWorkspaceId: scope.capture.groupWorkspaceId,
      studyWorkspaceId: scope.capture.studyWorkspaceId,
    });
    const entry = agenda.carryover.find((candidate) => candidate.id === ctx.match[1]);
    if (!entry) return ctx.answerCallbackQuery({ text: "That task is no longer in Carryover.", show_alert: true });
    await ctx.answerCallbackQuery().catch(() => undefined);
    await editDraftMessage(ctx, formatCarryoverPrompt(entry, agenda), new InlineKeyboard()
      .text("Do today", `td:carry:${entry.id}`).row()
      .url("Choose another day", todayUrl(scope)));
  });

  bot.callbackQuery(/^td:private-carry-prompt:([0-9a-f-]+)$/i, async (ctx) => {
    if (!todayOwner(ctx) || !ctx.from) return ctx.answerCallbackQuery({ text: "This plan is private.", show_alert: true });
    const agenda = await getDailyAgenda({ principalTelegramId: String(ctx.from.id), scope: PlanningScope.PERSONAL });
    const entry = agenda.carryover.find((candidate) => candidate.id === ctx.match[1]);
    if (!entry) return ctx.answerCallbackQuery({ text: "That task is no longer in Carryover.", show_alert: true });
    await ctx.answerCallbackQuery().catch(() => undefined);
    await editDraftMessage(ctx, formatCarryoverPrompt(entry, agenda), new InlineKeyboard()
      .text("Do today", `td:private-carry:${entry.id}`).row()
      .url("Choose another day", dashboardViewUrl("today")));
  });

  bot.callbackQuery(/^td:private-carry:([0-9a-f-]+)$/i, async (ctx) => {
    if (!todayOwner(ctx) || !ctx.from) return ctx.answerCallbackQuery({ text: "This plan is private.", show_alert: true });
    const principalTelegramId = String(ctx.from.id);
    const agenda = await getDailyAgenda({ principalTelegramId, scope: PlanningScope.PERSONAL });
    const entry = await planDailyAgendaEntry(
      { principalTelegramId, scope: PlanningScope.PERSONAL },
      ctx.match[1] ?? "",
      agenda.localDate,
    );
    await ctx.answerCallbackQuery({ text: "Moved to Today" });
    await editDraftMessage(ctx, `${bold("Moved to Today")}\n${h(entry.title)}\n\nIts deadline and original plan remain unchanged.`, new InlineKeyboard().text("View Today", "td:today"));
  });

  bot.callbackQuery(/^td:carry:([0-9a-f-]+)$/i, async (ctx) => {
    if (!todayOwner(ctx)) return ctx.answerCallbackQuery({ text: "This plan is private.", show_alert: true });
    const scope = await resolveScope(ctx);
    const entry = await planDailyAgendaEntry({
      principalTelegramId: scope.capture.principalTelegramId,
      scope: scope.capture.scope,
      groupWorkspaceId: scope.capture.groupWorkspaceId,
      studyWorkspaceId: scope.capture.studyWorkspaceId,
    }, ctx.match[1] ?? "", DateTime.now().setZone(scope.capture.timezone).toISODate());
    await ctx.answerCallbackQuery({ text: "Moved to Today" });
    await editDraftMessage(ctx, `${bold("Moved to Today")}
${h(entry.title)}

The deadline is unchanged.`, new InlineKeyboard().text("View Today", "td:today"));
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/") || !todayOwner(ctx)) return next();
    try {
      const scope = await resolveScope(ctx);
      const active = await findActiveTaskCaptureDraft(scope.capture);
      if (active?.status === "COLLECTING") {
        const moduleId = moduleForText(scope.modules, ctx.message.text)?.id;
        const draft = await appendTaskCaptureDraft(active.id, scope.capture.principalTelegramId, ctx.message.text, { moduleId, studyItemType: StudyItemType.REVISION });
        await updateCollectingCard(ctx, draft);
        return;
      }
      if (isTodayCaptureReply(ctx)) {
        if (active) {
          const moduleId = moduleForText(scope.modules, ctx.message.text)?.id;
          const appended = await appendTaskCaptureDraft(active.id, scope.capture.principalTelegramId, ctx.message.text, {
            moduleId,
            studyItemType: scope.capture.scope === PlanningScope.STUDY ? StudyItemType.REVISION : undefined,
          });
          const draft = await reviewTaskCaptureDraft(appended.id, scope.capture.principalTelegramId);
          await showDraftReview(ctx, draft, scope);
          return;
        }
        await beginDraft(ctx, ctx.message.text, scope);
        return;
      }
      if (active?.status === "REVIEWING" && await applyNaturalDraftEdit(active, scope, ctx.message.text)) {
        const draft = await reviewTaskCaptureDraft(active.id, scope.capture.principalTelegramId);
        await showDraftReview(ctx, draft, scope);
        return;
      }
      if (!looksLikeTaskCapture(ctx.message.text)) return next();
      await beginDraft(ctx, ctx.message.text, scope);
    } catch (error) {
      await ctx.reply(userFacingError(error, "I couldn't update that task list."));
    }
  });
}

async function handleToday(ctx: Context): Promise<void> {
  if (!todayOwner(ctx)) return;
  try {
    const scope = await resolveScope(ctx);
    const agenda = await getDailyAgenda({
      principalTelegramId: scope.capture.principalTelegramId,
      scope: scope.capture.scope,
      groupWorkspaceId: scope.capture.groupWorkspaceId,
      studyWorkspaceId: scope.capture.studyWorkspaceId,
    });
    const keyboard = new InlineKeyboard();
    if (agenda.carryover[0]) keyboard.text("Plan carryover", `td:carry-prompt:${agenda.carryover[0].id}`).row();
    keyboard.text("＋ Add tasks", "td:capture").url("Open Today", todayUrl(scope));
    await replyHtml(ctx, formatAgenda(agenda), { reply_markup: keyboard });
  } catch (error) {
    await ctx.reply(userFacingError(error, "I couldn't open Today right now."));
  }
}

function todayUrl(scope: BotTodayScope): string {
  return scope.dashboardWorkspace
    ? groupDashboardUrl(scope.dashboardWorkspace.id, scope.dashboardWorkspace.study ? "study-overview" : "today")
    : dashboardViewUrl("today");
}

export function formatCarryoverPrompt(entry: AgendaEntry, agenda: DailyAgenda): string {
  const firstPlan = entry.firstPlannedFor ?? entry.plannedFor;
  const carriedDays = firstPlan
    ? Math.max(1, Math.floor(DateTime.fromISO(agenda.localDate).diff(DateTime.fromISO(firstPlan), "days").days))
    : 1;
  return [
    bold(entry.title),
    "",
    `Originally planned ${h(firstPlan ? DateTime.fromISO(firstPlan).toFormat("cccc, d LLL") : "earlier")}`,
    `Carried for ${carriedDays} day${carriedDays === 1 ? "" : "s"}.`,
    "",
    carriedDays >= 3 ? "Choose a fresh day so this does not quietly linger." : "Do you want to work on it today?",
  ].join("\n");
}

async function beginDraft(ctx: Context, text: string, resolved?: BotTodayScope): Promise<void> {
  if (!todayOwner(ctx)) return;
  const scope = resolved ?? await resolveScope(ctx);
  const moduleId = moduleForText(scope.modules, text)?.id;
  const draft = await createTaskCaptureDraft(scope.capture, text, {
    moduleId,
    studyItemType: scope.capture.scope === PlanningScope.STUDY ? StudyItemType.REVISION : undefined,
    telegramChatId: ctx.chat ? String(ctx.chat.id) : undefined,
  });
  await showDraftReview(ctx, draft, scope);
}

async function showDraftReview(ctx: Context, draft: TaskCaptureDraftRecord, scope: BotTodayScope): Promise<void> {
  const message = await ctx.reply(formatDraftReview(draft, scope.modules), { parse_mode: "HTML", reply_markup: reviewKeyboard(draft) });
  if (ctx.chat) await rememberTaskCaptureDraftTelegramReview(draft.id, scope.capture.principalTelegramId, String(ctx.chat.id), message.message_id);
}

async function updateCollectingCard(ctx: Context, draft: TaskCaptureDraftRecord): Promise<void> {
  const markup = new InlineKeyboard().text("Review list", `td:review:${draft.id}`);
  if (draft.telegramChatId && draft.telegramReviewMessageId) {
    try {
      await ctx.api.editMessageText(draft.telegramChatId, draft.telegramReviewMessageId, formatCollectingDraft(draft), { parse_mode: "HTML", reply_markup: markup });
      return;
    } catch { /* The original card may no longer be editable. */ }
  }
  await replyHtml(ctx, formatCollectingDraft(draft), { reply_markup: markup });
}

export function reviewKeyboard(draft: TaskCaptureDraftRecord): InlineKeyboard {
  const included = draft.items.filter((item) => item.included);
  const needsReview = included.some((item) => item.status === "NEEDS_REVIEW" || item.warnings.length);
  const keyboard = new InlineKeyboard();
  if (!needsReview) keyboard.text(`Save ${included.length}`, `td:save:${draft.id}`);
  else keyboard.text("Review details", `td:edit:${draft.id}`);
  keyboard.text("＋ Add more", `td:add:${draft.id}`);
  if (!needsReview) keyboard.row().text("Edit details", `td:edit:${draft.id}`);
  return keyboard;
}

export function formatDraftReview(draft: TaskCaptureDraftRecord, modules: StudyModule[]): string {
  const included = draft.items.filter((item) => item.included);
  const heading = included.length === 1 ? "Add this task?" : `Add ${included.length} tasks?`;
  const moduleById = new Map(modules.map((module) => [module.id, module.code]));
  const rows = included.slice(0, 12).map((item) => {
    const plan = item.plannedFor ? DateTime.fromJSDate(item.plannedFor).toFormat("ccc, d LLL") : "Unscheduled";
    const deadline = item.dueAt ? DateTime.fromJSDate(item.dueAt).setZone(draft.timezone).toFormat("ccc, d LLL · h:mm a") : "No deadline";
    const module = item.moduleId ? `
  Module: ${code(moduleById.get(item.moduleId) ?? "Study")}` : "";
    const warning = item.warnings.length ? `
  ${h(warningCopy(item.warnings))}` : "";
    return `${bold(`${item.position}. ${item.title}`)}${module}
  Plan: ${h(plan)} · ${h(deadline)}${warning}`;
  });
  const remaining = included.length - rows.length;
  return [bold(heading), "", ...rows, remaining > 0 ? `
${remaining} more task${remaining === 1 ? "" : "s"} are waiting in the detailed editor.` : undefined, "", "Nothing is saved until you approve the list."].filter(Boolean).join("\n");
}

export function formatCollectingDraft(draft: TaskCaptureDraftRecord): string {
  return [bold(`Adding to this list · ${draft.items.filter((item) => item.included).length} tasks waiting`), "", "Send more tasks in one or several messages.", "Nothing will be saved until you review and approve it."].join("\n");
}

function formatDraftEditHelp(draft: TaskCaptureDraftRecord): string {
  return [bold("What should I change?"), "", "Reply naturally, for example:", `• Move task 3 to Saturday`, `• Give task 2 a Friday deadline`, `• Remove task 4`, "", `The detailed editor also supports titles, exact dates, Study modules, and inclusion.`].join("\n");
}

export function formatSavedDraft(draft: TaskCaptureDraftRecord): string {
  const included = draft.items.filter((item) => item.included);
  const today = DateTime.now().setZone(draft.timezone).toISODate();
  const todayCount = included.filter((item) => item.plannedFor?.toISOString().slice(0, 10) === today).length;
  const scheduled = included.filter((item) => item.plannedFor).length - todayCount;
  const deadlines = included.filter((item) => item.dueAt).length;
  return [bold(`Saved ${included.length} task${included.length === 1 ? "" : "s"}`), "", `Today: ${todayCount}`, `Other planned days: ${scheduled}`, `Deadlines added: ${deadlines}`, "", "No reminders were created."].join("\n");
}

export function formatAgenda(agenda: DailyAgenda): string {
  const section = (title: string, entries: AgendaEntry[], empty: string) => [bold(title), ...(entries.length ? entries.slice(0, 10).map((entry) => `□ ${h(entry.title)}${entry.moduleCode ? ` · ${code(entry.moduleCode)}` : ""}`) : [h(empty)])].join("\n");
  const deadlineRows = agenda.dueSoon.slice(0, 8).map((entry) => `• ${h(entry.title)}
  Due ${h(DateTime.fromISO(entry.dueAt!).setZone(agenda.timezone).toFormat("ccc, d LLL · h:mm a"))}`);
  return [
    section("Today's To-Do List", agenda.today, "None"),
    "",
    section("Carryover", agenda.carryover, "None"),
    "",
    bold("Deadline watch"),
    ...(deadlineRows.length ? deadlineRows : ["Nothing due in the next 3 days."]),
    agenda.unscheduledCount ? `
${agenda.unscheduledCount} unscheduled task${agenda.unscheduledCount === 1 ? "" : "s"} remain in All Tasks.` : undefined,
    `\nAdd tasks: tap ${bold("＋ Add tasks")} or send ${code("/todo Buy groceries, prepare tutorial")}.`,
  ].filter(Boolean).join("\n");
}

export function formatTodayCapturePrompt(): string {
  return [
    bold("Add tasks to Today"),
    "Send one task, or separate several with commas or new lines.",
    "",
    `Example: ${code("Start CS2103T increments, prepare CS2102 tutorial, buy groceries")}`,
    "",
    "You will review the list before anything is saved.",
  ].join("\n");
}

export function isTodayCaptureReply(ctx: Context): boolean {
  const replied = ctx.message?.reply_to_message;
  return Boolean(replied && "text" in replied && replied.text?.startsWith("Add tasks to Today"));
}

async function applyNaturalDraftEdit(draft: TaskCaptureDraftRecord, scope: BotTodayScope, text: string): Promise<boolean> {
  const remove = text.match(/^(?:remove|exclude|drop)\s+(?:task\s+)?(\d+)$/i);
  const deadline = text.match(/^(?:give|set|make)\s+(?:task\s+)?(\d+)\s+(?:a\s+)?(.+?)\s+(?:deadline|due(?:\s+date)?)$/i)
    ?? text.match(/^(?:give|set|make)\s+(?:task\s+)?(\d+)\s+(?:due|deadline)\s+(.+)$/i);
  const plan = text.match(/^(?:move|plan)\s+(?:task\s+)?(\d+)\s+(?:to|for|on)\s+(.+)$/i);
  const match = remove ?? deadline ?? plan;
  if (!match?.[1]) return false;
  const item = draft.items.find((candidate) => candidate.position === Number(match[1]));
  if (!item) return false;
  if (remove) {
    await updateTaskCaptureDraftItem(draft.id, item.id, scope.capture.principalTelegramId, { included: false });
    return true;
  }
  const timing = match[2]?.trim();
  if (!timing) return false;
  const parsed = parseDueDate(timing, scope.capture.timezone);
  if (!parsed) return false;
  await updateTaskCaptureDraftItem(draft.id, item.id, scope.capture.principalTelegramId, deadline
    ? { dueAt: parsed, resolveWarnings: true }
    : { plannedFor: calendarDate(parsed, scope.capture.timezone), resolveWarnings: true });
  return true;
}

async function resolveScope(ctx: Context): Promise<BotTodayScope> {
  if (!ctx.from) throw new Error("Telegram did not identify the sender.");
  const principalTelegramId = String(ctx.from.id);
  if (isStudyContext(ctx)) {
    const workspace = await requireStudyWorkspace(ctx);
    return {
      capture: {
        ownerUserId: workspace.ownerUserId,
        principalTelegramId,
        scope: PlanningScope.STUDY,
        timezone: workspace.timezone,
        studyWorkspaceId: workspace.id,
      },
      dashboardWorkspace: { id: workspace.id, study: true },
      modules: await listStudyModules(workspace.id),
    };
  }
  const user = await ensureUser(ctx);
  if (isGroupChat(ctx)) {
    const workspace = await groupWorkspaceForContext(ctx);
    if (!workspace) throw new Error("This group workspace is unavailable.");
    return {
      capture: {
        ownerUserId: user.id,
        principalTelegramId,
        scope: PlanningScope.GROUP,
        timezone: user.settings?.timezone ?? env.DEFAULT_TIMEZONE,
        groupWorkspaceId: workspace.id,
      },
      dashboardWorkspace: { id: workspace.id, study: false },
      modules: [],
    };
  }
  return {
    capture: {
      ownerUserId: user.id,
      principalTelegramId,
      scope: PlanningScope.PERSONAL,
      timezone: user.settings?.timezone ?? env.DEFAULT_TIMEZONE,
    },
    modules: [],
  };
}

function moduleForText(modules: StudyModule[], text: string): StudyModule | undefined {
  const upper = text.toUpperCase();
  return modules.find((module) => new RegExp(`(?:^|[^A-Z0-9])${escapeRegex(module.code.toUpperCase())}(?:[^A-Z0-9]|$)`).test(upper));
}

function looksLikeTaskCapture(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.endsWith("?") || /^(?:note|idea|remember)\b/i.test(trimmed)) return false;
  try {
    return splitTaskDraftText(trimmed).length > 1 || ACTION_START.test(trimmed);
  } catch {
    return false;
  }
}

function warningCopy(warnings: string[]): string {
  if (warnings.includes("STUDY_MODULE_REQUIRED")) return "Choose a Study module before saving.";
  if (warnings.includes("AMBIGUOUS_BARE_DATE")) return "Clarify whether the date is a plan or a deadline.";
  if (warnings.includes("REMINDER_REQUIRES_CONFIRMATION")) return "Create reminders separately after saving the task.";
  return "Review this task before saving.";
}

function todayOwner(ctx: Context): boolean {
  return Boolean(env.TODAY_FOUNDATION_OWNER_TELEGRAM_ID && String(ctx.from?.id ?? "") === env.TODAY_FOUNDATION_OWNER_TELEGRAM_ID);
}

async function editDraftMessage(ctx: Context, text: string, replyMarkup: InlineKeyboard): Promise<void> {
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: replyMarkup }).catch(async () => {
      await replyHtml(ctx, text, { reply_markup: replyMarkup });
    });
    return;
  }
  await replyHtml(ctx, text, { reply_markup: replyMarkup });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
