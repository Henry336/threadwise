import {
  StudyItemStatus,
  StudyPriority,
  StudyTrafficLight,
  type StudyItem,
  type StudyModule,
  type StudyWorkspace,
} from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { academicWeekNumber } from "./study";
import { assessStudyDeadline } from "./studyDeadlineTrust";

type AttentionInput = Pick<StudyItem,
  "id" | "publicId" | "title" | "status" | "priority" | "dueAt" | "plannedMinutes" | "mastery" | "createdAt" | "type"
> & {
  source?: StudyItem["source"];
  module: Pick<StudyModule, "id" | "code" | "name" | "currentMastery"> & {
    canvasTermStartAt?: Date | null;
    canvasTermEndAt?: Date | null;
  };
  week?: { number: number } | null;
  canvasAssignment?: { needsReview: boolean; status: string } | null;
};

export type StudyAttentionItem = {
  id: string;
  publicId: string;
  title: string;
  moduleCode: string;
  score: number;
  reasons: string[];
  recommendedAction: string;
  dueAt?: Date;
  plannedMinutes?: number;
  priority: StudyPriority;
  deadlineStatus: "TRUSTED" | "NEEDS_CONFIRMATION" | "UNDATED";
  deadlineIssue?: string;
};

export type StudyAttentionSnapshot = {
  generatedAt: Date;
  items: StudyAttentionItem[];
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  undated: number;
  missingCanvas: number;
  redModules: string[];
};

export type StudyWeeklyPreview = StudyAttentionSnapshot & {
  weekNumber: number;
  rangeStart: Date;
  rangeEnd: Date;
  due: StudyAttentionItem[];
  plannedMinutes: number;
};

export async function buildStudyAttentionSnapshot(
  workspace: StudyWorkspace,
  now = new Date(),
  limit = 8,
): Promise<StudyAttentionSnapshot> {
  const rows = await attentionRows(workspace.id);
  const trustedRows = rows.filter((item) => assessStudyDeadline(workspace, item).status === "TRUSTED");
  const items = rows
    .map((item) => scoreStudyAttentionItem(item, workspace, now))
    .sort(compareAttention)
    .slice(0, Math.max(1, limit));
  const localNow = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const endOfToday = localNow.endOf("day").toUTC().toJSDate();
  const endOfWeek = localNow.plus({ days: 7 }).endOf("day").toUTC().toJSDate();
  const redModules = await prisma.studyModule.findMany({
    where: { workspaceId: workspace.id, active: true, currentMastery: StudyTrafficLight.RED },
    select: { code: true },
    orderBy: { displayOrder: "asc" },
  });
  return {
    generatedAt: now,
    items,
    overdue: trustedRows.filter((item) => item.dueAt && item.dueAt < now).length,
    dueToday: trustedRows.filter((item) => item.dueAt && item.dueAt >= now && item.dueAt <= endOfToday).length,
    dueThisWeek: trustedRows.filter((item) => item.dueAt && item.dueAt >= now && item.dueAt <= endOfWeek).length,
    undated: rows.filter((item) => !item.dueAt).length,
    missingCanvas: rows.filter((item) => item.canvasAssignment?.needsReview).length,
    redModules: redModules.map((module) => module.code),
  };
}

export async function buildStudyWeeklyPreview(workspace: StudyWorkspace, now = new Date()): Promise<StudyWeeklyPreview> {
  const local = DateTime.fromJSDate(now).setZone(workspace.timezone);
  // A Sunday-evening preview describes the week that begins the next day.
  const rangeStartLocal = local.weekday === 7
    ? local.plus({ days: 1 }).startOf("day")
    : local.startOf("week");
  const rangeEndLocal = rangeStartLocal.plus({ days: 6 }).endOf("day");
  const rangeStart = rangeStartLocal.toUTC().toJSDate();
  const rangeEnd = rangeEndLocal.toUTC().toJSDate();
  const snapshot = await buildStudyAttentionSnapshot(workspace, now, 8);
  const rows = await attentionRows(workspace.id);
  const due = rows
    .filter((item) => assessStudyDeadline(workspace, item).status === "TRUSTED")
    .filter((item) => item.dueAt && item.dueAt >= rangeStart && item.dueAt <= rangeEnd)
    .map((item) => scoreStudyAttentionItem(item, workspace, now))
    .sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
  return {
    ...snapshot,
    weekNumber: academicWeekNumber(workspace, rangeStart),
    rangeStart,
    rangeEnd,
    due,
    plannedMinutes: due.reduce((sum, item) => sum + (item.plannedMinutes ?? 0), 0),
  };
}

export function scoreStudyAttentionItem(item: AttentionInput, workspace: Pick<StudyWorkspace, "timezone" | "semesterStartDate">, now = new Date()): StudyAttentionItem {
  const reasons: string[] = [];
  let score = 0;
  const localNow = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const deadline = assessStudyDeadline(workspace, item);
  const due = deadline.status === "TRUSTED" && item.dueAt
    ? DateTime.fromJSDate(item.dueAt).setZone(workspace.timezone)
    : undefined;
  const hoursUntilDue = due?.diff(localNow, "hours").hours;

  if (hoursUntilDue !== undefined) {
    if (hoursUntilDue < 0) {
      score += 95 + Math.min(30, Math.floor(Math.abs(hoursUntilDue) / 24) * 4);
      reasons.push("overdue");
    } else if (hoursUntilDue <= 24) {
      score += 80;
      reasons.push("due within 24 hours");
    } else if (hoursUntilDue <= 72) {
      score += 58;
      reasons.push("due within 3 days");
    } else if (hoursUntilDue <= 7 * 24) {
      score += 38;
      reasons.push("due this week");
    } else if (hoursUntilDue <= 14 * 24) {
      score += 16;
      reasons.push("due within 2 weeks");
    }
  } else if (deadline.status === "UNDATED") {
    const ageDays = localNow.diff(DateTime.fromJSDate(item.createdAt).setZone(workspace.timezone), "days").days;
    if (ageDays >= 14) {
      score += 28;
      reasons.push("undated for 2+ weeks");
    } else if (ageDays >= 7) {
      score += 18;
      reasons.push("undated for a week");
    } else {
      score += 5;
      reasons.push("no due date");
    }
  } else {
    score += 88;
    reasons.push("deadline needs confirmation");
  }

  const priorityPoints: Record<StudyPriority, number> = {
    [StudyPriority.LOW]: 0,
    [StudyPriority.NORMAL]: 8,
    [StudyPriority.HIGH]: 22,
    [StudyPriority.CRITICAL]: 34,
  };
  score += priorityPoints[item.priority];
  if (item.priority === StudyPriority.HIGH || item.priority === StudyPriority.CRITICAL) {
    reasons.push(`${item.priority.toLowerCase()} priority`);
  }
  if (item.status === StudyItemStatus.IN_PROGRESS) score += 7;
  if (item.mastery === StudyTrafficLight.RED) {
    score += 24;
    reasons.push("item mastery is red");
  } else if (item.mastery === StudyTrafficLight.AMBER) {
    score += 12;
    reasons.push("item mastery is amber");
  }
  if (item.module.currentMastery === StudyTrafficLight.RED) {
    score += 24;
    reasons.push(`${item.module.code} is red`);
  } else if (item.module.currentMastery === StudyTrafficLight.AMBER) {
    score += 10;
    reasons.push(`${item.module.code} is amber`);
  }
  const currentWeek = academicWeekNumber(workspace, now);
  if (item.week && currentWeek > 0 && item.week.number < currentWeek) {
    const weeksBehind = currentWeek - item.week.number;
    score += Math.min(30, weeksBehind * 10);
    reasons.push(`${weeksBehind} week${weeksBehind === 1 ? "" : "s"} behind`);
  }
  if (item.canvasAssignment?.needsReview) {
    score += 20;
    reasons.push("Canvas item needs review");
  }
  if ((item.plannedMinutes ?? 0) >= 120 && (hoursUntilDue ?? Infinity) <= 7 * 24) {
    score += 8;
    reasons.push("large task near deadline");
  }

  return {
    id: item.id,
    publicId: item.publicId,
    title: item.title,
    moduleCode: item.module.code,
    score,
    reasons: [...new Set(reasons)].slice(0, 4),
    recommendedAction: recommendedAction(item, hoursUntilDue, deadline.status),
    dueAt: item.dueAt ?? undefined,
    plannedMinutes: item.plannedMinutes ?? undefined,
    priority: item.priority,
    deadlineStatus: deadline.status,
    deadlineIssue: deadline.reason,
  };
}

function recommendedAction(item: AttentionInput, hoursUntilDue: number | undefined, deadlineStatus: "TRUSTED" | "NEEDS_CONFIRMATION" | "UNDATED"): string {
  const duration = item.plannedMinutes ? `${item.plannedMinutes}-minute` : "focused";
  if (deadlineStatus === "NEEDS_CONFIRMATION") return "Confirm the Canvas course and deadline before acting on it.";
  if (hoursUntilDue !== undefined && hoursUntilDue < 0) return `Triage or finish this overdue item now.`;
  if (hoursUntilDue !== undefined && hoursUntilDue <= 24) return `Start a ${duration} block today.`;
  if (item.canvasAssignment?.needsReview) return "Confirm whether Canvas removed or replaced it.";
  if (!item.dueAt) return "Give it a date or archive it.";
  if (item.mastery === StudyTrafficLight.RED || item.module.currentMastery === StudyTrafficLight.RED) return `Start a ${duration} recovery block.`;
  return `Reserve a ${duration} block before the deadline.`;
}

function compareAttention(a: StudyAttentionItem, b: StudyAttentionItem): number {
  if (a.score !== b.score) return b.score - a.score;
  const due = (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  if (due !== 0) return due;
  return a.publicId.localeCompare(b.publicId, undefined, { numeric: true });
}

function attentionRows(workspaceId: string): Promise<AttentionInput[]> {
  return prisma.studyItem.findMany({
    where: { workspaceId, module: { active: true }, status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS] } },
    include: {
      module: { select: { id: true, code: true, name: true, currentMastery: true, canvasTermStartAt: true, canvasTermEndAt: true } },
      week: { select: { number: true } },
      canvasAssignment: { select: { needsReview: true, status: true } },
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}
