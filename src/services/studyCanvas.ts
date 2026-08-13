import {
  StudyCanvasAssignmentStatus,
  StudyCanvasMaterialKind,
  StudyCanvasSyncStatus,
  StudyItemSource,
  StudyItemStatus,
  StudyItemType,
  StudyPriority,
  type StudyModule,
  type StudyWorkspace,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import {
  StudyModeError,
  academicWeekNumber,
  ensureStudyWeek,
  nextStudyPublicId,
} from "./study";

const CANVAS_PAGE_LIMIT = 100;
const CANVAS_MAX_PAGES = 50;
const CANVAS_SYNC_POLL_MS = 60_000;
const CANVAS_MAX_MATERIALS_PER_COURSE = 500;
const CANVAS_MAX_PAGE_TEXT = 64_000;
const CANVAS_STALE_SYNC_MS = 5 * 60_000;

type CanvasProfile = {
  id: number | string;
  name?: string;
  short_name?: string;
};

type CanvasCourse = {
  id: number | string;
  name?: string;
  course_code?: string;
  workflow_state?: string;
};

type CanvasModule = {
  id: number | string;
  name?: string;
  position?: number;
  unlock_at?: string | null;
  state?: string;
  published?: boolean;
};

type CanvasModuleItem = {
  id: number | string;
  module_id?: number | string;
  position?: number;
  title?: string;
  type?: string;
  content_id?: number | string | null;
  html_url?: string | null;
  url?: string | null;
  external_url?: string | null;
  published?: boolean;
};

type CanvasPage = { title?: string; body?: string | null; updated_at?: string | null; published?: boolean };
type CanvasFile = { display_name?: string; filename?: string; "content-type"?: string; size?: number; url?: string | null; updated_at?: string | null; unlock_at?: string | null; locked?: boolean };

type CanvasSubmission = {
  workflow_state?: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  excused?: boolean;
};

type CanvasAssignment = {
  id: number | string;
  name?: string;
  description?: string | null;
  html_url?: string | null;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  updated_at?: string | null;
  workflow_state?: string;
  published?: boolean;
  submission?: CanvasSubmission | null;
};

export type StudyCanvasSyncSummary = {
  courses: number;
  assignmentsSeen: number;
  imported: number;
  updated: number;
  completed: number;
  missing: number;
  ignoredSubmitted: number;
  ignoredInactive: number;
  skippedUnpublished: number;
  skippedDeleted: number;
  courseModulesSeen: number;
  materialsSeen: number;
  pagesCached: number;
  filesIndexed: number;
  finishedAt: Date;
  courseDiagnostics: CanvasCourseDiagnostic[];
};

type CanvasCourseDiagnostic = {
  canvasCourseId: string;
  moduleCode: string;
  moduleActive: boolean;
  assignmentsReturned: number;
  imported: number;
  updated: number;
  ignoredSubmitted: number;
  ignoredInactive: number;
  skippedUnpublished: number;
  skippedDeleted: number;
  courseModulesSeen: number;
  materialsSeen: number;
  materialError?: string;
};

const syncInFlightByWorkspace = new Map<string, Promise<StudyCanvasSyncSummary>>();
let syncQueue: Promise<unknown> = Promise.resolve();

export function studyCanvasConfigured(): boolean {
  return Boolean(env.CANVAS_ACCESS_TOKEN);
}

export async function studyCanvasStatus(workspaceId: string) {
  return prisma.studyCanvasSync.findUnique({ where: { workspaceId } });
}

export function syncStudyCanvas(
  workspace: StudyWorkspace,
  options: { now?: Date; force?: boolean } = {},
): Promise<StudyCanvasSyncSummary> {
  const existing = syncInFlightByWorkspace.get(workspace.id);
  if (existing) return existing;
  const task = syncQueue.then(() => performStudyCanvasSync(workspace, options));
  syncQueue = task.catch(() => undefined);
  syncInFlightByWorkspace.set(workspace.id, task);
  void task.finally(() => syncInFlightByWorkspace.delete(workspace.id)).catch(() => undefined);
  return task;
}

async function performStudyCanvasSync(
  workspace: StudyWorkspace,
  options: { now?: Date; force?: boolean } = {},
): Promise<StudyCanvasSyncSummary> {
  if (!env.CANVAS_ACCESS_TOKEN) {
    throw new StudyModeError("Canvas sync is waiting for the CANVAS_ACCESS_TOKEN Render secret.", "disabled");
  }
  if (!workspace.canvasSyncEnabled && !options.force) {
    throw new StudyModeError("Canvas sync is paused in Study Mode settings.", "disabled");
  }

  const now = options.now ?? new Date();
  const nextSyncAt = new Date(now.getTime() + env.STUDY_CANVAS_SYNC_INTERVAL_MINUTES * 60_000);
  await prisma.studyCanvasSync.upsert({
    where: { workspaceId: workspace.id },
    update: {
      status: StudyCanvasSyncStatus.RUNNING,
      lastAttemptAt: now,
      nextSyncAt,
      lastError: null,
    },
    create: {
      workspaceId: workspace.id,
      status: StudyCanvasSyncStatus.RUNNING,
      lastAttemptAt: now,
      nextSyncAt,
    },
  });

  try {
    const profile = await canvasGet<CanvasProfile>("users/self/profile");
    const courses = (await canvasGetPages<CanvasCourse>("courses", {
      enrollment_state: "active",
      include: ["term"],
    })).filter((course) => course.workflow_state !== "deleted");

    const seenAssignmentIds = new Set<string>();
    let imported = 0;
    let updated = 0;
    let completed = 0;
    let ignoredSubmitted = 0;
    let ignoredInactive = 0;
    let skippedUnpublished = 0;
    let skippedDeleted = 0;
    let courseModulesSeen = 0;
    let materialsSeen = 0;
    let pagesCached = 0;
    let filesIndexed = 0;
    const courseDiagnostics: CanvasCourseDiagnostic[] = [];

    for (const course of courses) {
      const module = await mapCanvasCourse(workspace, course, now);
      const assignments = await canvasGetPages<CanvasAssignment>(
        `courses/${encodeURIComponent(String(course.id))}/assignments`,
        { include: ["submission"], order_by: "due_at" },
      );
      const diagnostic: CanvasCourseDiagnostic = {
        canvasCourseId: String(course.id),
        moduleCode: module.code,
        moduleActive: module.active,
        assignmentsReturned: assignments.length,
        imported: 0,
        updated: 0,
        ignoredSubmitted: 0,
        ignoredInactive: 0,
        skippedUnpublished: 0,
        skippedDeleted: 0,
        courseModulesSeen: 0,
        materialsSeen: 0,
      };
      for (const assignment of assignments) {
        if (assignment.published === false) { skippedUnpublished += 1; diagnostic.skippedUnpublished += 1; continue; }
        if (assignment.workflow_state === "deleted") { skippedDeleted += 1; diagnostic.skippedDeleted += 1; continue; }
        const canvasAssignmentId = String(assignment.id);
        seenAssignmentIds.add(canvasAssignmentId);
        const result = await persistCanvasAssignment(workspace, module, course, assignment, now);
        if (result === "imported") { imported += 1; diagnostic.imported += 1; }
        else if (result === "updated") { updated += 1; diagnostic.updated += 1; }
        else if (result === "ignored_submitted") { ignoredSubmitted += 1; diagnostic.ignoredSubmitted += 1; }
        else if (result === "ignored_inactive") { ignoredInactive += 1; diagnostic.ignoredInactive += 1; }
        if (result === "updated" && isSubmitted(assignment.submission)) completed += 1;
      }
      try {
        const materials = await syncCanvasCourseMaterials(workspace, module, course, now);
        courseModulesSeen += materials.courseModulesSeen;
        materialsSeen += materials.materialsSeen;
        pagesCached += materials.pagesCached;
        filesIndexed += materials.filesIndexed;
        diagnostic.courseModulesSeen = materials.courseModulesSeen;
        diagnostic.materialsSeen = materials.materialsSeen;
      } catch (error) {
        diagnostic.materialError = canvasErrorMessage(error).slice(0, 300);
        logger.warn("Canvas course materials could not be indexed; assignment reconciliation continued.", {
          workspaceId: workspace.id,
          canvasCourseId: String(course.id),
          error: diagnostic.materialError,
        });
      }
      courseDiagnostics.push(diagnostic);
    }

    const previouslyTracked = await prisma.studyCanvasAssignment.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, canvasAssignmentId: true, status: true, needsReview: true },
    });
    const disappeared = previouslyTracked.filter((row) => (
      row.status === StudyCanvasAssignmentStatus.ACTIVE
      && !seenAssignmentIds.has(row.canvasAssignmentId)
    ));
    if (disappeared.length > 0) {
      await prisma.studyCanvasAssignment.updateMany({
        where: { id: { in: disappeared.map((row) => row.id) } },
        data: {
          status: StudyCanvasAssignmentStatus.MISSING,
          needsReview: true,
          missingSince: now,
        },
      });
    }

    const finishedAt = new Date();
    await prisma.studyCanvasSync.update({
      where: { workspaceId: workspace.id },
      data: {
        status: StudyCanvasSyncStatus.READY,
        canvasUserId: String(profile.id),
        canvasUserName: profile.name ?? profile.short_name,
        lastSuccessfulAt: finishedAt,
        nextSyncAt,
        lastError: null,
        lastSummary: {
          courses: courses.length,
          assignmentsSeen: seenAssignmentIds.size,
          imported,
          updated,
          completed,
          missing: disappeared.length,
          ignoredSubmitted,
          ignoredInactive,
          skippedUnpublished,
          skippedDeleted,
          courseModulesSeen,
          materialsSeen,
          pagesCached,
          filesIndexed,
          courseDiagnostics,
        },
        consecutiveFailures: 0,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: workspace.ownerUserId,
        action: "study.canvas.synced",
        metadata: {
          workspaceId: workspace.id,
          courses: courses.length,
          assignmentsSeen: seenAssignmentIds.size,
          imported,
          updated,
          completed,
          missing: disappeared.length,
          ignoredSubmitted,
          ignoredInactive,
          skippedUnpublished,
          skippedDeleted,
          courseModulesSeen,
          materialsSeen,
          pagesCached,
          filesIndexed,
          courseDiagnostics,
        },
      },
    });
    return {
      courses: courses.length,
      assignmentsSeen: seenAssignmentIds.size,
      imported,
      updated,
      completed,
      missing: disappeared.length,
      ignoredSubmitted,
      ignoredInactive,
      skippedUnpublished,
      skippedDeleted,
      courseModulesSeen,
      materialsSeen,
      pagesCached,
      filesIndexed,
      finishedAt,
      courseDiagnostics,
    };
  } catch (error) {
    const message = canvasErrorMessage(error);
    await prisma.studyCanvasSync.update({
      where: { workspaceId: workspace.id },
      data: {
        status: StudyCanvasSyncStatus.ERROR,
        lastError: message.slice(0, 1_000),
        nextSyncAt,
        consecutiveFailures: { increment: 1 },
      },
    }).catch(() => undefined);
    logger.error("Study Mode Canvas sync failed.", { workspaceId: workspace.id, error: message });
    throw new StudyModeError(message, "invalid");
  }
}

export async function runDueStudyCanvasSync(now = new Date()): Promise<StudyCanvasSyncSummary[]> {
  if (!studyCanvasConfigured()) return [];
  const workspaces = await prisma.studyWorkspace.findMany({
    where: { active: true, canvasSyncEnabled: true, boundChatId: { not: null } },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  const summaries: StudyCanvasSyncSummary[] = [];
  for (const workspace of workspaces) {
    if (syncInFlightByWorkspace.has(workspace.id)) continue;
    const state = await prisma.studyCanvasSync.findUnique({ where: { workspaceId: workspace.id } });
    if (!studyCanvasSyncIsDue(state, now)) continue;
    const summary = await syncStudyCanvas(workspace, { now }).catch(() => undefined);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

export function studyCanvasSyncIsDue(state: {
  status: StudyCanvasSyncStatus;
  lastAttemptAt: Date | null;
  nextSyncAt: Date;
} | null | undefined, now: Date): boolean {
  if (!state || state.status === StudyCanvasSyncStatus.NEVER) return true;
  if (state.status === StudyCanvasSyncStatus.RUNNING) {
    return !state.lastAttemptAt || state.lastAttemptAt.getTime() <= now.getTime() - CANVAS_STALE_SYNC_MS;
  }
  return state.nextSyncAt <= now;
}

export function startStudyCanvasSyncLoop(pollMs = CANVAS_SYNC_POLL_MS): NodeJS.Timeout {
  void runDueStudyCanvasSync();
  const timer = setInterval(() => void runDueStudyCanvasSync(), pollMs);
  timer.unref?.();
  return timer;
}

export function canvasModuleCode(course: Pick<CanvasCourse, "id" | "name" | "course_code">): string {
  for (const value of [course.course_code, course.name]) {
    const match = value?.toUpperCase().match(/\b([A-Z]{2,6}\d{3,5}[A-Z]?)\b/);
    if (match?.[1]) return match[1];
  }
  const numeric = String(course.id).replace(/\D/g, "").slice(-6) || "000";
  return `CV${numeric}`;
}

export function isSubmitted(submission: CanvasSubmission | null | undefined): boolean {
  if (!submission) return false;
  if (submission.excused) return true;
  if (submission.submitted_at || submission.graded_at) return true;
  return ["submitted", "graded", "pending_review", "complete"].includes((submission.workflow_state ?? "").toLowerCase());
}

export function canvasPriority(dueAt: Date | undefined, now = new Date()): StudyPriority {
  if (!dueAt) return StudyPriority.NORMAL;
  const hours = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (hours <= 24) return StudyPriority.CRITICAL;
  if (hours <= 7 * 24) return StudyPriority.HIGH;
  return StudyPriority.NORMAL;
}

export async function mapCanvasCourse(workspace: StudyWorkspace, course: CanvasCourse, now: Date): Promise<StudyModule> {
  const canvasCourseId = String(course.id);
  const code = canvasModuleCode(course);
  const canvasCourseName = (course.name ?? course.course_code ?? code).trim().slice(0, 240);
  const existing = await prisma.studyModule.findFirst({
    where: {
      workspaceId: workspace.id,
      OR: [{ canvasCourseId }, { code }],
    },
  });
  if (existing) {
    return prisma.studyModule.update({
      where: { id: existing.id },
      data: {
        canvasCourseId,
        canvasCourseName,
        canvasLastSeenAt: now,
      },
    });
  }
  const displayOrder = await prisma.studyModule.count({ where: { workspaceId: workspace.id } });
  return prisma.studyModule.create({
    data: {
      workspaceId: workspace.id,
      code,
      name: canvasCourseName,
      canvasCourseId,
      canvasCourseName,
      canvasLastSeenAt: now,
      // Canvas discovery is source state, not a user visibility decision.
      // The owner explicitly activates courses that belong to this semester.
      active: false,
      displayOrder,
    },
  });
}

export async function persistCanvasAssignment(
  workspace: StudyWorkspace,
  module: StudyModule,
  course: CanvasCourse,
  assignment: CanvasAssignment,
  now: Date,
): Promise<"imported" | "updated" | "ignored_submitted" | "ignored_inactive"> {
  const canvasAssignmentId = String(assignment.id);
  const canvasCourseId = String(course.id);
  const title = (assignment.name ?? `Canvas assignment ${canvasAssignmentId}`).trim().slice(0, 500);
  const dueAt = canvasDate(assignment.due_at);
  const submittedAt = canvasDate(assignment.submission?.submitted_at ?? assignment.submission?.graded_at);
  const submitted = isSubmitted(assignment.submission);
  const existing = await prisma.studyCanvasAssignment.findUnique({
    where: { workspaceId_canvasAssignmentId: { workspaceId: workspace.id, canvasAssignmentId } },
    include: { item: true },
  });
  const weekNumber = dueAt ? academicWeekNumber(workspace, dueAt) : academicWeekNumber(workspace, now);
  const week = weekNumber > 0 ? await ensureStudyWeek(workspace, weekNumber) : undefined;

  if (existing) {
    const keepLocallyClosed = existing.item.status === StudyItemStatus.DONE
      || existing.item.status === StudyItemStatus.PROCESSED
      || existing.item.status === StudyItemStatus.SKIPPED;
    await prisma.$transaction([
      prisma.studyItem.update({
        where: { id: existing.itemId },
        data: {
          moduleId: module.id,
          weekId: week?.id,
          ...(!existing.item.titleOverridden ? { title } : {}),
          ...(!existing.item.dueAtOverridden ? { dueAt } : {}),
          ...(submitted && !keepLocallyClosed
            ? { status: StudyItemStatus.DONE, completedAt: submittedAt ?? now }
            : {}),
        },
      }),
      prisma.studyCanvasAssignment.update({
        where: { id: existing.id },
        data: canvasAssignmentData(workspace.id, module.id, canvasCourseId, assignment, title, dueAt, submittedAt, now),
      }),
    ]);
    return "updated";
  }

  // Canvas history can contain years of already-submitted work. It is useful
  // only when Threadwise was already tracking the assignment and needs to
  // close it; importing completed history would bury the active workload.
  if (submitted) return "ignored_submitted";
  // Assignments discovered under an inactive/unreviewed module remain source
  // metadata only. Activating the module and syncing again imports them.
  if (!module.active) return "ignored_inactive";

  const publicId = await nextStudyPublicId(workspace.id, "STUDY");
  const item = await prisma.studyItem.create({
    data: {
      workspaceId: workspace.id,
      moduleId: module.id,
      weekId: week?.id,
      publicId,
      type: StudyItemType.ASSIGNMENT,
      title,
      notes: assignment.html_url ? `Canvas: ${assignment.html_url}` : undefined,
      source: StudyItemSource.CANVAS,
      status: submitted ? StudyItemStatus.DONE : StudyItemStatus.OPEN,
      priority: canvasPriority(dueAt, now),
      dueAt,
      completedAt: submitted ? submittedAt ?? now : undefined,
    },
  });
  await prisma.studyCanvasAssignment.create({
    data: {
      itemId: item.id,
      ...canvasAssignmentData(workspace.id, module.id, canvasCourseId, assignment, title, dueAt, submittedAt, now),
    },
  });
  return "imported";
}

function canvasAssignmentData(
  workspaceId: string,
  moduleId: string,
  canvasCourseId: string,
  assignment: CanvasAssignment,
  title: string,
  dueAt: Date | undefined,
  submittedAt: Date | undefined,
  now: Date,
) {
  const submitted = isSubmitted(assignment.submission);
  return {
    workspaceId,
    moduleId,
    canvasCourseId,
    canvasAssignmentId: String(assignment.id),
    title,
    description: htmlToPlainText(assignment.description)?.slice(0, 16_000),
    htmlUrl: assignment.html_url ?? undefined,
    dueAt,
    unlockAt: canvasDate(assignment.unlock_at),
    lockAt: canvasDate(assignment.lock_at),
    submissionState: assignment.submission?.workflow_state,
    submittedAt,
    workflowState: assignment.workflow_state,
    status: submitted ? StudyCanvasAssignmentStatus.SUBMITTED : StudyCanvasAssignmentStatus.ACTIVE,
    sourceUpdatedAt: canvasDate(assignment.updated_at),
    lastSeenAt: now,
    missingSince: null,
    needsReview: false,
  };
}

async function syncCanvasCourseMaterials(
  workspace: StudyWorkspace,
  module: StudyModule,
  course: CanvasCourse,
  now: Date,
): Promise<{ courseModulesSeen: number; materialsSeen: number; pagesCached: number; filesIndexed: number }> {
  const canvasCourseId = String(course.id);
  const canvasModules = await canvasGetPages<CanvasModule>(
    `courses/${encodeURIComponent(canvasCourseId)}/modules`,
    {},
  );
  const seenModuleIds = new Set<string>();
  const seenMaterialIds = new Set<string>();
  let pagesCached = 0;
  let filesIndexed = 0;

  for (const canvasModule of canvasModules) {
    const canvasModuleId = String(canvasModule.id);
    seenModuleIds.add(canvasModuleId);
    const courseModule = await prisma.studyCanvasCourseModule.upsert({
      where: { workspaceId_canvasModuleId: { workspaceId: workspace.id, canvasModuleId } },
      update: {
        moduleId: module.id,
        canvasCourseId,
        name: (canvasModule.name ?? `Canvas module ${canvasModuleId}`).trim().slice(0, 500),
        position: canvasModule.position ?? 0,
        unlockAt: canvasDate(canvasModule.unlock_at),
        workflowState: canvasModule.state,
        published: canvasModule.published,
        active: true,
        lastSeenAt: now,
      },
      create: {
        workspaceId: workspace.id,
        moduleId: module.id,
        canvasCourseId,
        canvasModuleId,
        name: (canvasModule.name ?? `Canvas module ${canvasModuleId}`).trim().slice(0, 500),
        position: canvasModule.position ?? 0,
        unlockAt: canvasDate(canvasModule.unlock_at),
        workflowState: canvasModule.state,
        published: canvasModule.published,
        lastSeenAt: now,
      },
    });
    const items = await canvasGetPages<CanvasModuleItem>(
      `courses/${encodeURIComponent(canvasCourseId)}/modules/${encodeURIComponent(canvasModuleId)}/items`,
      {},
    );
    if (seenMaterialIds.size + items.length > CANVAS_MAX_MATERIALS_PER_COURSE) {
      throw new Error(`Canvas course ${module.code} exposes more than ${CANVAS_MAX_MATERIALS_PER_COURSE} module items; sync stopped before marking unseen material missing.`);
    }
    for (const item of items) {
      if (item.published === false) continue;
      const canvasModuleItemId = String(item.id);
      seenMaterialIds.add(canvasModuleItemId);
      const kind = canvasMaterialKind(item.type);
      let page: CanvasPage | undefined;
      let file: CanvasFile | undefined;
      if (kind === StudyCanvasMaterialKind.PAGE && item.url) {
        page = await canvasGetFromApiUrl<CanvasPage>(item.url).catch(() => undefined);
        if (page?.body) pagesCached += 1;
      } else if (kind === StudyCanvasMaterialKind.FILE && item.url) {
        file = await canvasGetFromApiUrl<CanvasFile>(item.url).catch(() => undefined);
        if (file) filesIndexed += 1;
      }
      const extractedText = page?.body ? htmlToPlainText(page.body)?.slice(0, CANVAS_MAX_PAGE_TEXT) : undefined;
      const title = (page?.title ?? file?.display_name ?? file?.filename ?? item.title ?? `Canvas material ${canvasModuleItemId}`).trim().slice(0, 500);
      await prisma.studyCanvasMaterial.upsert({
        where: { workspaceId_canvasModuleItemId: { workspaceId: workspace.id, canvasModuleItemId } },
        update: {
          moduleId: module.id,
          courseModuleId: courseModule.id,
          canvasCourseId,
          canvasContentId: item.content_id == null ? undefined : String(item.content_id),
          kind,
          title,
          position: item.position ?? 0,
          htmlUrl: item.html_url ?? undefined,
          apiUrl: item.url ?? undefined,
          externalUrl: item.external_url ?? undefined,
          contentType: file?.["content-type"],
          byteSize: safeCanvasByteSize(file?.size),
          extractedText,
          contentHash: extractedText ? createHash("sha256").update(extractedText).digest("hex") : undefined,
          sourceUpdatedAt: canvasDate(page?.updated_at ?? file?.updated_at),
          unlockAt: canvasDate(file?.unlock_at),
          published: page?.published ?? item.published,
          active: true,
          lastSeenAt: now,
        },
        create: {
          workspaceId: workspace.id,
          moduleId: module.id,
          courseModuleId: courseModule.id,
          canvasCourseId,
          canvasModuleItemId,
          canvasContentId: item.content_id == null ? undefined : String(item.content_id),
          kind,
          title,
          position: item.position ?? 0,
          htmlUrl: item.html_url ?? undefined,
          apiUrl: item.url ?? undefined,
          externalUrl: item.external_url ?? undefined,
          contentType: file?.["content-type"],
          byteSize: safeCanvasByteSize(file?.size),
          extractedText,
          contentHash: extractedText ? createHash("sha256").update(extractedText).digest("hex") : undefined,
          sourceUpdatedAt: canvasDate(page?.updated_at ?? file?.updated_at),
          unlockAt: canvasDate(file?.unlock_at),
          published: page?.published ?? item.published,
          lastSeenAt: now,
        },
      });
    }
  }

  await prisma.studyCanvasCourseModule.updateMany({
    where: { workspaceId: workspace.id, canvasCourseId, active: true, canvasModuleId: { notIn: [...seenModuleIds] } },
    data: { active: false },
  });
  await prisma.studyCanvasMaterial.updateMany({
    where: { workspaceId: workspace.id, canvasCourseId, active: true, canvasModuleItemId: { notIn: [...seenMaterialIds] } },
    data: { active: false },
  });
  return { courseModulesSeen: seenModuleIds.size, materialsSeen: seenMaterialIds.size, pagesCached, filesIndexed };
}

export function canvasMaterialKind(value: string | undefined): StudyCanvasMaterialKind {
  const type = value?.toLowerCase();
  if (type === "page") return StudyCanvasMaterialKind.PAGE;
  if (type === "file") return StudyCanvasMaterialKind.FILE;
  if (type === "assignment") return StudyCanvasMaterialKind.ASSIGNMENT;
  if (type === "quiz") return StudyCanvasMaterialKind.QUIZ;
  if (type === "discussion") return StudyCanvasMaterialKind.DISCUSSION;
  if (type === "externalurl" || type === "external_url") return StudyCanvasMaterialKind.EXTERNAL_URL;
  return StudyCanvasMaterialKind.OTHER;
}

function safeCanvasByteSize(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= 2_147_483_647 ? value : undefined;
}

async function canvasGetFromApiUrl<T>(value: string): Promise<T> {
  const base = new URL(env.CANVAS_BASE_URL);
  const url = new URL(value, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.replace(/\/$/, ""))) {
    throw new Error("Canvas returned a material API URL outside the configured Canvas API origin.");
  }
  const response = await canvasFetch(url.toString());
  return response.json() as Promise<T>;
}

async function canvasGetPages<T>(path: string, params: Record<string, string | string[]>): Promise<T[]> {
  const first = canvasUrl(path, { ...params, per_page: String(CANVAS_PAGE_LIMIT) });
  const rows: T[] = [];
  let next: string | undefined = first;
  let page = 0;
  while (next && page < CANVAS_MAX_PAGES) {
    const response = await canvasFetch(next);
    const value = await response.json() as unknown;
    if (!Array.isArray(value)) throw new Error("Canvas returned an unexpected list response.");
    rows.push(...value as T[]);
    next = nextCanvasLink(response.headers.get("link"));
    page += 1;
  }
  if (next) throw new Error("Canvas returned too many pages to sync safely.");
  return rows;
}

async function canvasGet<T>(path: string): Promise<T> {
  const response = await canvasFetch(canvasUrl(path));
  return response.json() as Promise<T>;
}

async function canvasFetch(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.STUDY_EXTERNAL_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${env.CANVAS_ACCESS_TOKEN!}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.ok) return response;
      const body = (await response.text()).slice(0, 400);
      if (response.status === 401 || response.status === 403) {
        throw new CanvasRequestError("Canvas rejected the access token. Replace CANVAS_ACCESS_TOKEN in Render.", false);
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new CanvasRequestError(
        `Canvas request failed (${response.status})${body ? `: ${body}` : "."}`,
        retryable,
        retryDelayMs(response.headers.get("retry-after"), attempt),
      );
    } catch (error) {
      lastError = error;
      const retryable = error instanceof CanvasRequestError ? error.retryable : true;
      if (!retryable || attempt === 2) throw error;
      await delay(error instanceof CanvasRequestError ? error.retryAfterMs : retryDelayMs(null, attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function canvasUrl(path: string, params: Record<string, string | string[]> = {}): string {
  const base = `${env.CANVAS_BASE_URL.replace(/\/$/, "")}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  for (const [key, raw] of Object.entries(params)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) url.searchParams.append(`${key}${Array.isArray(raw) ? "[]" : ""}`, value);
  }
  return url.toString();
}

export function nextCanvasLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[1] && match[2]?.split(/\s+/).includes("next")) return match[1];
  }
  return undefined;
}

class CanvasRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "CanvasRequestError";
  }
}

function retryDelayMs(value: string | null, attempt: number): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(5_000, Math.max(0, date - Date.now()));
  }
  return [250, 750, 1_500][attempt] ?? 1_500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canvasDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed.toUTC().toJSDate() : undefined;
}

function htmlToPlainText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const plain = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain || undefined;
}

function canvasErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Canvas took too long to respond. Threadwise will retry automatically.";
  return error instanceof Error ? error.message : "Canvas sync failed. Threadwise will retry automatically.";
}
