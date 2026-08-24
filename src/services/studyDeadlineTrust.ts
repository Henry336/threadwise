import { StudyCanvasAssignmentStatus, StudyItemSource, type StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";

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

export function hasTrustedStudyDeadline(
  workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">,
  item: DeadlineItem,
): boolean {
  return assessStudyDeadline(workspace, item).status === "TRUSTED";
}
