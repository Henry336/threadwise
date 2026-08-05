import {
  Prisma,
  StudyItemStatus,
  StudyItemType,
  StudyMistakeStatus,
  StudyPriority,
  StudyReminderKind,
  StudyTrafficLight,
  type StudyWorkspace,
} from "@prisma/client";
import { InlineKeyboard, type Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { isWithinQuietHours, startOfUserDay } from "../utils/dates";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { academicWeekNumber, academicWeekRange, activeStudyWorkspace, ensureStudyWeek } from "./study";
import { buildStudyWeeklyPreview } from "./studyAttention";
import { buildStudyDeparturePlan, isStudyTravelMuted } from "./studyTransit";

type Candidate = {
  kind: StudyReminderKind;
  entityKey: string;
  scheduledFor: Date;
  text: string;
  keyboard?: InlineKeyboard;
};

export type StudyReminderRun = {
  candidates: number;
  sent: number;
  deduplicated: number;
  capped: number;
  quiet: boolean;
  unsafeChat: boolean;
  failed: number;
};

export function studyReminderGate(
  workspace: Pick<StudyWorkspace, "timezone" | "quietHoursStart" | "quietHoursEnd" | "maxRemindersPerDay">,
  now: Date,
  sentToday: number,
): "send" | "quiet" | "capped" {
  if (isWithinQuietHours(now, {
    timezone: workspace.timezone,
    start: workspace.quietHoursStart,
    end: workspace.quietHoursEnd,
  })) return "quiet";
  return sentToday >= workspace.maxRemindersPerDay ? "capped" : "send";
}

export async function runStudyReminderPass(bot: Bot, now = new Date()): Promise<StudyReminderRun> {
  const result: StudyReminderRun = { candidates: 0, sent: 0, deduplicated: 0, capped: 0, quiet: false, unsafeChat: false, failed: 0 };
  const workspace = await activeStudyWorkspace();
  if (!workspace?.boundChatId) return result;
  try {
    const members = await bot.api.getChatMemberCount(workspace.boundChatId);
    if (members > 2) {
      result.unsafeChat = true;
      return result;
    }
  } catch (error) {
    // Privacy fails closed: proactive academic data is not sent when group
    // membership cannot be verified.
    result.unsafeChat = true;
    logger.warn("Study reminder pass could not verify the private group's membership.", { error: String(error) });
    return result;
  }
  if (studyReminderGate(workspace, now, 0) === "quiet") {
    result.quiet = true;
    return result;
  }
  const candidates = await collectStudyReminderCandidates(workspace, now);
  result.candidates = candidates.length;
  const dayStart = startOfUserDay(now, workspace.timezone);
  let sentToday = await prisma.studyReminderDelivery.count({
    where: { workspaceId: workspace.id, sentAt: { gte: dayStart, lte: now } },
  });
  for (const candidate of candidates) {
    if (studyReminderGate(workspace, now, sentToday) === "capped") {
      result.capped += 1;
      continue;
    }
    const dedupeKey = buildStudyReminderDedupeKey(workspace.id, candidate.kind, candidate.entityKey, candidate.scheduledFor, workspace.timezone);
    const claimed = await claimDelivery(workspace, candidate, dedupeKey);
    if (!claimed) {
      result.deduplicated += 1;
      continue;
    }
    try {
      const sent = await bot.api.sendMessage(workspace.boundChatId, candidate.text, {
        ...HTML_REPLY,
        ...(candidate.keyboard ? { reply_markup: candidate.keyboard } : {}),
      });
      await prisma.studyReminderDelivery.update({
        where: { id: claimed.id },
        data: { sentAt: now, messageId: String(sent.message_id) },
      });
      await markCandidateDelivered(candidate, now);
      result.sent += 1;
      sentToday += 1;
    } catch (error) {
      result.failed += 1;
      await prisma.studyReminderDelivery.delete({ where: { id: claimed.id } }).catch(() => undefined);
      logger.error("Study reminder delivery failed.", { kind: candidate.kind, entityKey: candidate.entityKey, error: String(error) });
    }
  }
  return result;
}

export async function collectStudyReminderCandidates(workspace: StudyWorkspace, now = new Date()): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const local = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const weekNumber = academicWeekNumber(workspace, now);
  if (weekNumber < 1) return candidates;
  const week = await ensureStudyWeek(workspace, weekNumber);
  const previewClock = parseClock(workspace.weeklyPreviewTime);
  if (local.weekday === workspace.weeklyPreviewDay && previewClock && isAtOrAfter(local, previewClock)) {
    const previewWeekNumber = academicWeekNumber(
      workspace,
      local.plus({ days: local.weekday === 7 ? 1 : 0 }).toJSDate(),
    );
    const alreadySent = await prisma.studyReminderDelivery.count({
      where: {
        workspaceId: workspace.id,
        kind: StudyReminderKind.WEEKLY_PREVIEW,
        entityKey: `week:${previewWeekNumber}`,
        sentAt: { not: null },
      },
    });
    if (!alreadySent) {
      const preview = await buildStudyWeeklyPreview(workspace, now);
      candidates.push({
        kind: StudyReminderKind.WEEKLY_PREVIEW,
        entityKey: `week:${preview.weekNumber}`,
        scheduledFor: local.startOf("day").set(previewClock).toUTC().toJSDate(),
        text: [
          bold(`Week ${preview.weekNumber} preview`),
          `${preview.due.length} dated · ${preview.overdue} overdue · ${preview.undated} undated`,
          ...preview.due.slice(0, 4).map((item) => `${code(item.publicId)} · ${bold(item.moduleCode)} · ${h(item.title)}`),
          preview.items[0]
            ? `${bold("Start here")}\n${code(preview.items[0].publicId)} · ${h(preview.items[0].recommendedAction)}`
            : "",
        ].filter(Boolean).join("\n"),
        keyboard: new InlineKeyboard().text("Open preview", "study:preview").text("Plan week", "study:plan"),
      });
    }
  }
  const reviewClock = parseClock(workspace.weeklyReviewTime);
  if (local.weekday === workspace.weeklyReviewDay && reviewClock && isAtOrAfter(local, reviewClock) && !week.reviewCompleted) {
    candidates.push({
      kind: StudyReminderKind.WEEKLY_REVIEW,
      entityKey: `week:${week.number}`,
      scheduledFor: local.startOf("day").set(reviewClock).toUTC().toJSDate(),
      text: [bold(`Week ${week.number} review`), "A short review keeps next week honest."].join("\n"),
      keyboard: new InlineKeyboard().text("Begin review", "study:review:start"),
    });
  }
  if (local.weekday === 1 && local.hour >= 9 && weekNumber > 1) {
    const previous = await prisma.studyWeek.findUnique({ where: { workspaceId_number: { workspaceId: workspace.id, number: weekNumber - 1 } } });
    if (previous && !previous.reviewCompleted) {
      candidates.push({
        kind: StudyReminderKind.WEEKLY_REVIEW_INCOMPLETE,
        entityKey: `week:${previous.number}`,
        scheduledFor: local.startOf("day").set({ hour: 9, minute: 0 }).toUTC().toJSDate(),
        text: [bold(`Week ${previous.number} review is still open`), "Finish it when you have a few quiet minutes."].join("\n"),
        keyboard: new InlineKeyboard().text("Begin review", "study:review:start"),
      });
    }
  }
  const missingAssignments = await prisma.studyCanvasAssignment.findMany({
    where: { workspaceId: workspace.id, needsReview: true },
    include: { item: { include: { module: true } } },
    orderBy: { missingSince: "asc" },
    take: 5,
  });
  for (const assignment of missingAssignments) {
    candidates.push({
      kind: StudyReminderKind.CANVAS_MISSING_REVIEW,
      entityKey: assignment.id,
      scheduledFor: assignment.missingSince ?? now,
      text: [
        bold("Canvas assignment needs review"),
        `${code(assignment.item.publicId)} · ${bold(assignment.item.module.code)}`,
        h(assignment.item.title),
        "Canvas no longer returned this assignment. Keep it locally or archive it.",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("Keep local", `study:canvas:missing:keep:${assignment.item.publicId}`)
        .text("Archive", `study:canvas:missing:archive:${assignment.item.publicId}`),
    });
  }
  const canvasSync = await prisma.studyCanvasSync.findUnique({ where: { workspaceId: workspace.id } });
  if (canvasSync?.status === "ERROR" && canvasSync.consecutiveFailures >= 3 && canvasSync.lastAttemptAt) {
    candidates.push({
      kind: StudyReminderKind.CANVAS_SYNC_ERROR,
      entityKey: "canvas-sync",
      scheduledFor: canvasSync.lastAttemptAt,
      text: [bold("Canvas sync needs attention"), h(canvasSync.lastError || "Automatic sync has failed repeatedly.")].join("\n"),
      keyboard: new InlineKeyboard().text("Check Canvas", "study:canvas:status").text("Retry", "study:canvas:sync"),
    });
  }
  const mistakes = await prisma.studyMistake.findMany({
    where: { workspaceId: workspace.id, status: { in: [StudyMistakeStatus.OPEN, StudyMistakeStatus.REATTEMPT_DUE] }, revisitAt: { lte: now } },
    include: { module: true },
    take: 10,
  });
  for (const mistake of mistakes) {
    candidates.push({
      kind: StudyReminderKind.MISTAKE_REATTEMPT,
      entityKey: mistake.id,
      scheduledFor: mistake.revisitAt ?? now,
      text: [bold(`${mistake.module.code} reattempt`), `${code(mistake.publicId)} · ${h(mistake.source)}`, `Check: ${h(mistake.prevention)}`].join("\n"),
      keyboard: new InlineKeyboard().text("Resolved", `study:mistake:resolve:${mistake.id}`),
    });
  }
  const redModules = await prisma.studyModule.findMany({ where: { workspaceId: workspace.id, active: true, currentMastery: StudyTrafficLight.RED } });
  for (const module of redModules) {
    if (module.lastRedWarningAt && now.getTime() - module.lastRedWarningAt.getTime() < 7 * 24 * 60 * 60_000) continue;
    candidates.push({
      kind: StudyReminderKind.MODULE_RED,
      entityKey: module.id,
      scheduledFor: module.redSince ?? now,
      text: [bold(`${module.code} needs a recovery action`), h(module.masteryReason || "Choose one concrete topic or deliverable to address next.")].join("\n"),
      keyboard: new InlineKeyboard().text("Open Study Mode", "study:dashboard"),
    });
  }
  const items = await prisma.studyItem.findMany({
    where: {
      workspaceId: workspace.id,
      status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS] },
      priority: { in: [StudyPriority.HIGH, StudyPriority.CRITICAL] },
      dueAt: { not: null, lte: new Date(now.getTime() + 24 * 60 * 60_000) },
    },
    include: { module: true },
    take: 15,
  });
  for (const item of items) {
    const overdue = Boolean(item.dueAt && item.dueAt < now);
    candidates.push({
      kind: overdue ? StudyReminderKind.ITEM_OVERDUE : StudyReminderKind.DEADLINE_APPROACHING,
      entityKey: item.id,
      scheduledFor: item.dueAt ?? now,
      text: [
        bold(overdue ? `${item.module.code} item is overdue` : `${item.module.code} deadline approaching`),
        `${code(item.publicId)} · ${h(item.title)}`,
        item.dueAt ? `Due ${h(DateTime.fromJSDate(item.dueAt).setZone(workspace.timezone).toFormat("ccc, d LLL · h:mm a"))}` : "",
      ].filter(Boolean).join("\n"),
      keyboard: new InlineKeyboard().text("Complete", `study:item:done:${item.id}`).text("Reschedule", `study:item:reschedule:${item.id}`).row().text("Dashboard", "study:dashboard"),
    });
  }
  const blocks = await prisma.studyScheduleBlock.findMany({
    where: { workspaceId: workspace.id, active: true, dayOfWeek: local.weekday },
    include: { module: true },
  });
  for (const block of blocks) {
      if ((block.startWeek && weekNumber < block.startWeek) || (block.endWeek && weekNumber > block.endWeek)) continue;
      const clock = parseClock(block.startTime);
      if (!clock) continue;
      const starts = local.startOf("day").set(clock);
      if (block.destinationStopId && block.venueName) {
        if (isStudyTravelMuted(workspace, now)) continue;
        // Consult Improved NextBus only close to departure. This keeps the
        // minute-level reminder pass light while still using current arrivals.
        if (local < starts.minus({ minutes: 150 }) || local > starts.plus({ minutes: 15 })) continue;
        const plan = await buildStudyDeparturePlan(workspace, block.id, { startsAt: starts.toUTC().toJSDate() });
        const leaveAt = DateTime.fromJSDate(plan.leaveAt).setZone(workspace.timezone);
        if (local < leaveAt || local > starts.plus({ minutes: 15 })) continue;
        const service = plan.journey.services.length ? plan.journey.services.join(" → ") : "Use the usual route";
        candidates.push({
          kind: StudyReminderKind.CLASS_DEPARTURE,
          entityKey: `${block.id}:${starts.toISODate()}`,
          scheduledFor: plan.leaveAt,
          text: [
            bold(`Leave by ${leaveAt.toFormat("h:mm a")}`),
            `${h(service)} from ${h(plan.journey.boardingStop.title)}`,
            plan.live && plan.journey.waitMinutes !== undefined
              ? `Live arrival: ${plan.journey.waitMinutes} min · ${h(block.venueName)}`
              : `Allow about ${Math.max(1, plan.journey.totalMinutes ?? 30) + block.travelBufferMinutes} min · ${h(block.venueName)}`,
            `${block.module ? `${h(block.module.code)} · ` : ""}${starts.toFormat("h:mm a")}`,
            plan.live ? undefined : "Live buses unavailable · normal estimate used",
          ].filter(Boolean).join("\n"),
          keyboard: new InlineKeyboard()
            .text("Refresh", `study:travel:route:${block.id}`).text("Change origin", `study:travel:change:${block.id}`).row()
            .text("I’m here", `study:travel:arrived:${block.id}`).text("Mute today", "study:travel:mute"),
        });
        continue;
      }
      if (!workspace.studyBlockRemindersEnabled) continue;
      const remindAt = starts.minus({ minutes: block.reminderLeadMinutes });
      if (local < remindAt || local > starts.plus({ minutes: 30 })) continue;
      candidates.push({
        kind: StudyReminderKind.STUDY_BLOCK,
        entityKey: `${block.id}:${starts.toISODate()}`,
        scheduledFor: remindAt.toUTC().toJSDate(),
        text: [bold(block.label), block.module ? `${block.module.code} · ${starts.toFormat("h:mm a")}` : starts.toFormat("h:mm a")].join("\n"),
        keyboard: block.module ? new InlineKeyboard().text("Start session", `study:session:module:${block.module.id}`) : undefined,
      });
  }
  if (weekNumber >= workspace.timedPracticeStartWeek && local.weekday === 7 && local.hour >= 18) {
    const range = academicWeekRange(workspace, weekNumber);
    const technical = await prisma.studyModule.findMany({ where: { workspaceId: workspace.id, code: { in: ["CS2100", "CS2102"] }, active: true } });
    for (const module of technical) {
      const logged = await prisma.studySession.count({ where: { moduleId: module.id, timed: true, startedAt: { gte: range.start, lte: range.end } } });
      if (!logged) {
        candidates.push({
          kind: StudyReminderKind.TIMED_PRACTICE_MISSING,
          entityKey: `${module.id}:week:${weekNumber}`,
          scheduledFor: local.startOf("day").set({ hour: 18, minute: 0 }).toUTC().toJSDate(),
          text: [bold(`${module.code} timed practice`), "None is logged for this week. Add a bounded attempt if the week still allows it."].join("\n"),
          keyboard: new InlineKeyboard().text("Start session", `study:session:module:${module.id}`),
        });
      }
    }
  }
  return candidates.sort((a, b) =>
    studyReminderPriority(a.kind) - studyReminderPriority(b.kind)
    || a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

/**
 * Lower values are delivered first when several reminders become eligible in
 * one pass. The daily cap must never let housekeeping crowd out urgent work.
 */
export function studyReminderPriority(kind: StudyReminderKind): number {
  switch (kind) {
    case StudyReminderKind.ITEM_OVERDUE:
      return 0;
    case StudyReminderKind.DEADLINE_APPROACHING:
      return 1;
    case StudyReminderKind.CLASS_DEPARTURE:
      return 2;
    case StudyReminderKind.STUDY_BLOCK:
      return 3;
    case StudyReminderKind.WEEKLY_REVIEW:
      return 4;
    case StudyReminderKind.WEEKLY_PREVIEW:
      return 5;
    case StudyReminderKind.CANVAS_SYNC_ERROR:
      return 6;
    case StudyReminderKind.CANVAS_MISSING_REVIEW:
      return 7;
    case StudyReminderKind.MISTAKE_REATTEMPT:
      return 8;
    case StudyReminderKind.MODULE_RED:
      return 9;
    case StudyReminderKind.DAY_PREVIEW:
      return 10;
    case StudyReminderKind.CLASS_FOLLOW_UP:
      return 11;
    case StudyReminderKind.WEEKLY_REVIEW_INCOMPLETE:
      return 12;
    case StudyReminderKind.TIMED_PRACTICE_MISSING:
      return 13;
    default:
      return 20;
  }
}

export function buildStudyReminderDedupeKey(
  workspaceId: string,
  kind: StudyReminderKind,
  entityKey: string,
  scheduledFor: Date,
  timezone: string,
): string {
  const localDate = DateTime.fromJSDate(scheduledFor).setZone(timezone).toISODate() ?? scheduledFor.toISOString().slice(0, 10);
  return `${workspaceId}:${kind}:${entityKey}:${localDate}`;
}

async function claimDelivery(workspace: StudyWorkspace, candidate: Candidate, dedupeKey: string) {
  try {
    return await prisma.studyReminderDelivery.create({
      data: {
        workspaceId: workspace.id,
        kind: candidate.kind,
        entityKey: candidate.entityKey,
        dedupeKey,
        scheduledFor: candidate.scheduledFor,
        chatId: workspace.boundChatId!,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return undefined;
    throw error;
  }
}

async function markCandidateDelivered(candidate: Candidate, now: Date): Promise<void> {
  if (candidate.kind === StudyReminderKind.MODULE_RED) {
    await prisma.studyModule.update({ where: { id: candidate.entityKey }, data: { lastRedWarningAt: now } });
  }
  if (candidate.kind === StudyReminderKind.MISTAKE_REATTEMPT) {
    await prisma.studyMistake.updateMany({ where: { id: candidate.entityKey, status: StudyMistakeStatus.OPEN }, data: { status: StudyMistakeStatus.REATTEMPT_DUE } });
  }
}

function parseClock(value: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : undefined;
}

function isAtOrAfter(value: DateTime, clock: { hour: number; minute: number }): boolean {
  return value >= value.startOf("day").set(clock);
}
