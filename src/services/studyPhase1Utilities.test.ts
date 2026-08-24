import {
  StudyItemStatus,
  StudyItemType,
  StudyPriority,
  StudyCanvasMaterialKind,
  StudyCanvasSyncStatus,
  StudyReminderKind,
  StudyTrafficLight,
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import { scoreStudyAttentionItem } from "./studyAttention";
import { canvasCourseTermScope, canvasMaterialKind, canvasModuleCode, canvasPriority, isSubmitted, nextCanvasLink, requireCanvasApiUrl, studyCanvasSyncIsDue } from "./studyCanvas";
import { assessStudyDeadline } from "./studyDeadlineTrust";
import { studyScheduleDeleteMutation } from "./study";
import { studyReminderPriority } from "./studyReminders";
import { deriveStudyResourceTitle, paginateStudyText } from "./studyResources";

describe("Canvas mapping rules", () => {
  it("derives stable module codes and conservative priorities", () => {
    expect(canvasModuleCode({ id: 91, name: "Computer Organisation", course_code: "CS2100 / AY26" })).toBe("CS2100");
    expect(canvasModuleCode({ id: 123456, name: "Unnamed", course_code: undefined })).toBe("CV123456");
    const now = new Date("2026-08-04T00:00:00.000Z");
    expect(canvasPriority(new Date("2026-08-04T20:00:00.000Z"), now)).toBe(StudyPriority.CRITICAL);
    expect(canvasPriority(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(StudyPriority.HIGH);
    expect(canvasPriority(undefined, now)).toBe(StudyPriority.NORMAL);
  });

  it("treats only clear submission states as submitted", () => {
    expect(isSubmitted({ workflow_state: "submitted" })).toBe(true);
    expect(isSubmitted({ workflow_state: "unsubmitted" })).toBe(false);
    expect(isSubmitted({ excused: true })).toBe(true);
  });

  it("follows only the next Canvas pagination link", () => {
    const header = '<https://canvas.example/api?page=1>; rel="current", <https://canvas.example/api?page=2>; rel="next"';
    expect(nextCanvasLink(header)).toBe("https://canvas.example/api?page=2");
    expect(nextCanvasLink(null)).toBeUndefined();
  });

  it("rejects a Canvas pagination link whose origin differs from CANVAS_BASE_URL", () => {
    expect(() => requireCanvasApiUrl(
      "https://attacker.example/api/v1/courses?page=2",
      "https://canvas.example/api/v1",
    )).toThrow("outside the configured Canvas API boundary");
  });

  it("maps Canvas module items into stable material kinds", () => {
    expect(canvasMaterialKind("Page")).toBe(StudyCanvasMaterialKind.PAGE);
    expect(canvasMaterialKind("File")).toBe(StudyCanvasMaterialKind.FILE);
    expect(canvasMaterialKind("ExternalUrl")).toBe(StudyCanvasMaterialKind.EXTERNAL_URL);
    expect(canvasMaterialKind("SubHeader")).toBe(StudyCanvasMaterialKind.OTHER);
  });

  it("reclaims interrupted Canvas syncs without racing healthy future runs", () => {
    const now = new Date("2026-08-13T10:00:00.000Z");
    expect(studyCanvasSyncIsDue(null, now)).toBe(true);
    expect(studyCanvasSyncIsDue({ status: StudyCanvasSyncStatus.READY, lastAttemptAt: now, nextSyncAt: new Date("2026-08-13T10:30:00.000Z") }, now)).toBe(false);
    expect(studyCanvasSyncIsDue({ status: StudyCanvasSyncStatus.RUNNING, lastAttemptAt: new Date("2026-08-13T09:59:00.000Z"), nextSyncAt: new Date("2026-08-13T10:30:00.000Z") }, now)).toBe(false);
    expect(studyCanvasSyncIsDue({ status: StudyCanvasSyncStatus.RUNNING, lastAttemptAt: new Date("2026-08-13T09:50:00.000Z"), nextSyncAt: new Date("2026-08-13T10:30:00.000Z") }, now)).toBe(true);
  });

  it("rejects courses from a different academic term", () => {
    const workspace = { timezone: "Asia/Singapore", semesterStartDate: new Date("2026-08-09T16:00:00.000Z") };
    expect(canvasCourseTermScope(workspace, { id: 1, term: { name: "AY2025/26", start_at: "2025-08-01", end_at: "2025-12-31" } })).toMatchObject({ status: "OUTSIDE" });
    expect(canvasCourseTermScope(workspace, { id: 2, term: { name: "AY2026/27", start_at: "2026-08-01", end_at: "2026-12-31" } })).toEqual({ status: "CURRENT" });
  });
});

describe("deterministic attention and reminder ordering", () => {
  const workspace = {
    timezone: "Asia/Singapore",
    semesterStartDate: new Date("2026-08-02T16:00:00.000Z"),
  };
  const base = {
    id: "item-1",
    publicId: "STUDY-1",
    title: "Finish tutorial",
    status: StudyItemStatus.OPEN,
    priority: StudyPriority.NORMAL,
    dueAt: null,
    plannedMinutes: 60,
    mastery: StudyTrafficLight.UNASSESSED,
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    type: StudyItemType.TUTORIAL,
    module: { id: "module-1", code: "CS2100", name: "Computer Organisation", currentMastery: StudyTrafficLight.GREEN },
    week: { number: 1 },
    canvasAssignment: null,
  };

  it("ranks overdue and weak-module work above ordinary undated work", () => {
    const now = new Date("2026-08-10T04:00:00.000Z");
    const ordinary = scoreStudyAttentionItem(base, workspace, now);
    const urgent = scoreStudyAttentionItem({
      ...base,
      dueAt: new Date("2026-08-09T04:00:00.000Z"),
      priority: StudyPriority.HIGH,
      module: { ...base.module, currentMastery: StudyTrafficLight.RED },
    }, workspace, now);

    expect(urgent.score).toBeGreaterThan(ordinary.score);
    expect(urgent.reasons).toContain("overdue");
    expect(urgent.reasons).toContain("CS2100 is red");
  });

  it("delivers urgent deadlines before housekeeping under the daily cap", () => {
    expect(studyReminderPriority(StudyReminderKind.ITEM_OVERDUE)).toBeLessThan(
      studyReminderPriority(StudyReminderKind.CANVAS_MISSING_REVIEW),
    );
    expect(studyReminderPriority(StudyReminderKind.DEADLINE_APPROACHING)).toBeLessThan(
      studyReminderPriority(StudyReminderKind.WEEKLY_REVIEW_INCOMPLETE),
    );
  });

  it("quarantines implausible Canvas deadlines instead of calling them overdue", () => {
    const deadline = assessStudyDeadline(workspace, {
      source: "CANVAS",
      dueAt: new Date("2027-10-13T15:59:00.000Z"),
      module: { canvasTermStartAt: new Date("2026-08-01T00:00:00.000Z"), canvasTermEndAt: new Date("2026-12-31T00:00:00.000Z") },
      canvasAssignment: { status: "ACTIVE", needsReview: false },
    });
    expect(deadline.status).toBe("NEEDS_CONFIRMATION");
    expect(deadline.reason).toContain("after this Canvas term");
  });

  it("derives idempotent recurring deletion mutations", () => {
    const block = { active: true, startWeek: 1, endWeek: 13, excludedWeeks: [2] };
    expect(studyScheduleDeleteMutation(block, { scope: "occurrence", weekNumber: 4 })).toEqual({ excludedWeeks: [2, 4] });
    expect(studyScheduleDeleteMutation(block, { scope: "future", weekNumber: 5 })).toEqual({ endWeek: 4, excludedWeeks: [2] });
    expect(studyScheduleDeleteMutation(block, { scope: "series" })).toEqual({ active: false });
  });
});

describe("Study resource presentation", () => {
  it("derives a compact title from the first sentence", () => {
    expect(deriveStudyResourceTitle("Cache misses stall the pipeline. More detail follows here.")).toBe("Cache misses stall the pipeline.");
  });

  it("paginates long escaped Unicode safely", () => {
    const source = `${"A & B < C > D 😀 ".repeat(120)}\n\n${"Second paragraph 🚀 ".repeat(80)}`;
    const pages = paginateStudyText(source, 240);
    const escapedLength = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .length;

    expect(pages.length).toBeGreaterThan(2);
    expect(pages.every((page) => escapedLength(page) <= 240)).toBe(true);
    expect(pages.join(" ")).not.toContain("�");
    expect(pages.join(" ")).toContain("😀");
    expect(pages.join(" ")).toContain("🚀");
  });
});
