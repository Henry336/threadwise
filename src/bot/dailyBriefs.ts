import { createHash } from "node:crypto";
import { DailyBriefDeliveryStatus, DailyBriefKind, PlanningScope, type PrismaClient } from "@prisma/client";
import { Bot, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import {
  claimDailyBriefDelivery,
  countDailyAgendaCompletions,
  finishDailyBriefDelivery,
  getDailyAgenda,
  type AgendaEntry,
  type DailyAgenda,
} from "../services/dailyAgenda";
import { isWithinQuietHours } from "../utils/dates";
import { bold, code, h } from "../utils/html";
import { dashboardViewUrl } from "./links";

export const DAILY_BRIEF_POLL_MS = 60_000;
const DELIVERY_WINDOW_MINUTES = 4 * 60;

type BriefCandidate = {
  userId: string;
  telegramId: string;
  recipientChatId: string;
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  morningBriefEnabled: boolean;
  morningBriefTime: string;
  eveningDebriefEnabled: boolean;
  eveningDebriefTime: string;
};

export type DailyBriefPassSummary = { checked: number; sent: number; skipped: number; failed: number };

export async function runDailyBriefPass(
  bot: Bot,
  ownerTelegramId: string,
  now: Date = new Date(),
  database: PrismaClient = prisma,
): Promise<DailyBriefPassSummary> {
  const rows = await database.userSettings.findMany({
    where: {
      user: { telegramId: ownerTelegramId },
      OR: [{ morningBriefEnabled: true }, { eveningDebriefEnabled: true }],
    },
    include: { user: { select: { id: true, telegramId: true } } },
  });
  const candidates: BriefCandidate[] = rows
    .filter((settings) => settings.reminderChatId === settings.user.telegramId)
    .map((settings) => ({
      userId: settings.user.id,
      telegramId: settings.user.telegramId,
      recipientChatId: settings.reminderChatId!,
      timezone: settings.timezone,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
      morningBriefEnabled: settings.morningBriefEnabled,
      morningBriefTime: settings.morningBriefTime,
      eveningDebriefEnabled: settings.eveningDebriefEnabled,
      eveningDebriefTime: settings.eveningDebriefTime,
    }));
  const summary: DailyBriefPassSummary = { checked: candidates.length, sent: 0, skipped: 0, failed: 0 };

  for (const candidate of candidates) {
    const local = DateTime.fromJSDate(now).setZone(candidate.timezone);
    if (!local.isValid || isWithinQuietHours(now, {
      timezone: candidate.timezone,
      start: candidate.quietHoursStart,
      end: candidate.quietHoursEnd,
    })) continue;
    const dueKinds: Array<typeof DailyBriefKind.MORNING | typeof DailyBriefKind.EVENING> = [];
    if (candidate.morningBriefEnabled && isDeliveryDue(local, candidate.morningBriefTime)) dueKinds.push(DailyBriefKind.MORNING);
    if (candidate.eveningDebriefEnabled && isDeliveryDue(local, candidate.eveningDebriefTime)) dueKinds.push(DailyBriefKind.EVENING);
    for (const kind of dueKinds) {
      let deliveryId: string | undefined;
      try {
        const agenda = await getDailyAgenda({ principalTelegramId: candidate.telegramId, scope: PlanningScope.PERSONAL }, { localDate: local.toISODate() ?? undefined }, database);
        const completed = kind === DailyBriefKind.EVENING
          ? await countDailyAgendaCompletions(candidate.telegramId, candidate.timezone, agenda.localDate, database)
          : 0;
        const content = kind === DailyBriefKind.MORNING
          ? formatMorningBrief(agenda)
          : formatEveningDebrief(agenda, completed);
        const localDate = local.startOf("day").toUTC().toJSDate();
        const claim = await claimDailyBriefDelivery({
          userId: candidate.userId,
          recipientTelegramId: candidate.telegramId,
          localDate,
          kind,
          scope: PlanningScope.PERSONAL,
          scopeKey: "private-cross-mode",
          contentHash: createHash("sha256").update(content ?? "empty").digest("hex"),
        }, database);
        if (!claim.claimed) continue;
        deliveryId = claim.delivery.id;
        if (!content) {
          await finishDailyBriefDelivery(claim.delivery.id, { status: DailyBriefDeliveryStatus.SKIPPED }, database);
          summary.skipped += 1;
          continue;
        }
        const keyboard = briefKeyboard(agenda);
        await bot.api.sendMessage(candidate.recipientChatId, content, { parse_mode: "HTML", reply_markup: keyboard });
        await finishDailyBriefDelivery(claim.delivery.id, { status: DailyBriefDeliveryStatus.SENT }, database);
        summary.sent += 1;
      } catch (error) {
        if (deliveryId) {
          await finishDailyBriefDelivery(deliveryId, { status: DailyBriefDeliveryStatus.FAILED, error: String(error) }, database).catch(() => undefined);
        }
        summary.failed += 1;
        logger.error("Could not deliver a Today briefing.", {
          kind,
          telegramId: candidate.telegramId,
          error: String(error),
        });
      }
    }
  }
  return summary;
}

export function startDailyBriefLoop(
  bot: Bot,
  ownerTelegramId: string | undefined,
  pollMs = DAILY_BRIEF_POLL_MS,
): NodeJS.Timeout | undefined {
  if (!ownerTelegramId) return undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runDailyBriefPass(bot, ownerTelegramId); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  return timer;
}

export function formatMorningBrief(agenda: DailyAgenda): string | undefined {
  if (!agenda.today.length && !agenda.carryover.length && !agenda.dueSoon.length) return undefined;
  return [
    bold("Good morning"),
    "",
    agendaSection("TODAY", agenda.today, agenda, "Nothing planned."),
    "",
    agendaSection("CARRYOVER", agenda.carryover, agenda, "Nothing carried over.", true),
    "",
    deadlineSection(agenda),
    "",
    `Complete quickly: reply ${code("done TASK-1 TASK-4")} using the IDs shown above.`,
    "Open Today for the full list.",
  ].join("\n");
}

export function formatEveningDebrief(agenda: DailyAgenda, completed: number): string | undefined {
  if (!completed && !agenda.today.length && !agenda.carryover.length && !agenda.dueSoon.length) return undefined;
  const remaining = [...agenda.today, ...agenda.carryover];
  return [
    bold("Evening wrap-up"),
    "",
    `${bold("DONE TODAY")}\n${completed ? `${completed} task${completed === 1 ? "" : "s"} completed.` : "No completed tasks recorded yet."}`,
    "",
    agendaSection("STILL OPEN", remaining, agenda, "Nothing remains from today's plan."),
    "",
    deadlineSection(agenda),
    "",
    `Complete quickly: reply ${code("done TASK-1 TASK-4")} using the IDs shown above.`,
  ].join("\n");
}

function agendaSection(title: string, entries: AgendaEntry[], agenda: DailyAgenda, empty: string, carried = false): string {
  const rows = entries.slice(0, 4).map((entry) => {
    const context = entry.moduleCode ?? entry.workspaceName ?? modeLabel(entry.mode);
    const carry = carried && entry.plannedFor
      ? ` · carried ${Math.max(1, DateTime.fromISO(agenda.localDate).diff(DateTime.fromISO(entry.plannedFor), "days").days)}d`
      : "";
    return `□ ${code(entry.publicId)} ${h(entry.title)} · ${code(context)}${carry}`;
  });
  if (entries.length > rows.length) rows.push(`+${entries.length - rows.length} more`);
  return [bold(title), ...(rows.length ? rows : [h(empty)])].join("\n");
}

function deadlineSection(agenda: DailyAgenda): string {
  const rows = agenda.dueSoon.slice(0, 3).map((entry) => `• ${h(entry.title)}\n  Due ${h(DateTime.fromISO(entry.dueAt!).setZone(agenda.timezone).toFormat("ccc, d LLL · h:mm a"))}`);
  if (agenda.dueSoon.length > rows.length) rows.push(`+${agenda.dueSoon.length - rows.length} more deadlines`);
  return [bold("DEADLINE WATCH"), ...(rows.length ? rows : ["Nothing due in the next 3 days."])].join("\n");
}

function briefKeyboard(agenda: DailyAgenda): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (agenda.carryover[0]) keyboard.text("Plan carryover", `td:private-carry-prompt:${agenda.carryover[0].id}`).row();
  return keyboard.url("Open Today", dashboardViewUrl("today"));
}

function isDeliveryDue(local: DateTime, clock: string): boolean {
  const [hour, minute] = clock.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  const scheduled = local.set({ hour, minute, second: 0, millisecond: 0 });
  const elapsed = local.diff(scheduled, "minutes").minutes;
  return elapsed >= 0 && elapsed < DELIVERY_WINDOW_MINUTES;
}

function modeLabel(mode: AgendaEntry["mode"]): string {
  return mode === "GROUP" ? "Group" : mode === "STUDY" ? "Study" : "Personal";
}
