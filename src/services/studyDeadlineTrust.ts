/**
 * Decides whether a Study item's deadline is safe to show as real and to remind on.
 * Canvas sometimes returns deadlines from the wrong term or for removed assignments, so
 * those are quarantined as NEEDS_CONFIRMATION instead of showing up as overdue. Used by
 * study.ts, studyAttention.ts, studyReminders.ts and the dashboard Study payload.
 */
import { StudyCanvasAssignmentStatus, StudyItemSource, type StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";

/** TRUSTED: safe to remind on. NEEDS_CONFIRMATION: suspicious Canvas date. UNDATED: no due date. */
export type StudyDeadlineStatus = "TRUSTED" | "NEEDS_CONFIRMATION" | "UNDATED";

export type StudyDeadlineAssessment = {
  status: StudyDeadlineStatus;
  reason?: string;
};

type DeadlineItem = {
  source?: StudyItemSource | string;
  dueAt: Date | null;
  module?: {
    canvasTermStartAt?: Date | null;
    canvasTermEndAt?: Date | null;
  } | null;
  canvasAssignment?: {
    needsReview: boolean;
    status: StudyCanvasAssignmentStatus | string;
  } | null;
};

const SEMESTER_EARLY_TOLERANCE_DAYS = 21;
const SEMESTER_MAX_SPAN_WEEKS = 26;
const TERM_DEADLINE_TOLERANCE_DAYS = 21;

/**
 * Classifies one deadline. Manual (non-Canvas) dates are always trusted. A Canvas date
 * needs confirmation if Canvas stopped returning the assignment, if it falls outside the
 * course's Canvas term (with a three-week margin), or outside the configured semester.
 * Pure function: no database access, all dates compared in the workspace timezone.
 */
export function assessStudyDeadline(
  workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">,
  item: DeadlineItem,
): StudyDeadlineAssessment {
  if (!item.dueAt) return { status: "UNDATED" };
  if (item.source !== StudyItemSource.CANVAS) return { status: "TRUSTED" };
  if (item.canvasAssignment?.needsReview || item.canvasAssignment?.status === StudyCanvasAssignmentStatus.MISSING) {
    return { status: "NEEDS_CONFIRMATION", reason: "Canvas no longer returns this assignment." };
  }

  const due = DateTime.fromJSDate(item.dueAt).setZone(workspace.timezone);
  const termStart = item.module?.canvasTermStartAt
    ? DateTime.fromJSDate(item.module.canvasTermStartAt).setZone(workspace.timezone).minus({ days: TERM_DEADLINE_TOLERANCE_DAYS })
    : undefined;
  const termEnd = item.module?.canvasTermEndAt
    ? DateTime.fromJSDate(item.module.canvasTermEndAt).setZone(workspace.timezone).plus({ days: TERM_DEADLINE_TOLERANCE_DAYS })
    : undefined;
  if (termStart && due < termStart) {
    return { status: "NEEDS_CONFIRMATION", reason: "The deadline falls before this Canvas term." };
  }
  if (termEnd && due > termEnd) {
    return { status: "NEEDS_CONFIRMATION", reason: "The deadline falls after this Canvas term." };
  }

  if (workspace.semesterStartDate) {
    const semesterStart = DateTime.fromJSDate(workspace.semesterStartDate)
      .setZone(workspace.timezone)
      .startOf("day");
    const earliest = semesterStart.minus({ days: SEMESTER_EARLY_TOLERANCE_DAYS });
    const latest = semesterStart.plus({ weeks: SEMESTER_MAX_SPAN_WEEKS }).endOf("day");
    if (due < earliest || due > latest) {
      return {
        status: "NEEDS_CONFIRMATION",
        reason: `The Canvas deadline is outside ${SEMESTER_MAX_SPAN_WEEKS} weeks of the configured semester.`,
      };
    }
  }

  return { status: "TRUSTED" };
}

/** Shortcut for filters that only care whether a deadline may drive reminders and counts. */
export function hasTrustedStudyDeadline(
  workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">,
  item: DeadlineItem,
): boolean {
  return assessStudyDeadline(workspace, item).status === "TRUSTED";
}
