import {
  Prisma,
  StudyAnalysisMode,
  StudyCanvasAssignmentStatus,
  StudyItemStatus,
  StudyItemType,
  StudyMistakeCategory,
  StudyPriority,
  StudyResourceKind,
  StudyTrafficLight,
  type PrismaClient,
  type StudyWorkspace,
} from "@prisma/client";
import { z } from "zod";
import { DateTime } from "luxon";
import { privateStudyConfig } from "../config/env";
import { prisma } from "../db/prisma";
import { completeSearchableContentUpdate, contentMatchesQuery, encryptedSearchClause } from "../security/contentEncryption";
import {
  addStudyModule,
  addStudyScheduleBlock,
  academicWeekNumber,
  archiveStudyScheduleBlock,
  buildStudyDashboard,
  completeStudyItem,
  configureStudyWorkspace,
  createStudyItem,
  findStudyItem,
  findStudyModule,
  listStudyMistakes,
  recordStudyMistake,
  resolveStudyMistake,
  saveWeeklyReview,
  startStudySession,
  stopStudySession,
  updateStudySession,
  archiveStudySession,
  updateStudyScheduleBlock,
  updateWeeklyPlan,
  studyScheduleOccursOnDate,
  StudyModeError,
} from "../services/study";
import { buildStudyAttentionSnapshot } from "../services/studyAttention";
import { studyCanvasConfigured, studyCanvasStatus, syncStudyCanvas } from "../services/studyCanvas";
import { assessStudyDeadline } from "../services/studyDeadlineTrust";
import { importStudyNusmodsTimetable } from "../services/studyNusmods";
import {
  archiveStudyResource,
  createStudyResource,
  findStudyResource,
} from "../services/studyResources";
import { rebuildStudyNoteLinks, recordStudyNoteRevision, studyNoteMetadata } from "../services/studyMarkdown";
import { deriveStudyResourceAnalysis, STUDY_SCALE_BUDGETS, studyResourceWikiLookupKeys } from "../services/studyScale";
import {
  activateStudyOrigin,
  addStudyOriginFromVenue,
  clearStudyScheduleTravel,
  configureStudyScheduleTravel,
  deleteStudyOrigin,
  listStudyOrigins,
  renameStudyOrigin,
  searchStudyPlaces,
  setStudyScheduleDestinationLabel,
  setDefaultStudyOrigin,
} from "../services/studyTransit";
import type { DashboardWorkspaceScope } from "./workspaces";

const MAX_STUDY_FILE_BYTES = 20_000_000;
const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;
const SAFE_INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Choose a valid calendar date.");
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const id = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timezone = text(80).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Choose a valid IANA timezone, such as Asia/Singapore.");

export const studyIdParamsSchema = z.object({ id });
export const studyAnalysisRequestSchema = z.object({
  mode: z.nativeEnum(StudyAnalysisMode).default(StudyAnalysisMode.CONNECTIONS),
}).strict();
export const studyNoteSuggestionReviewSchema = z.object({
  action: z.enum(["APPLY", "DISMISS"]),
  replacementText: z.string().trim().min(1).max(5_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "DISMISS" && value.replacementText !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["replacementText"], message: "A dismissed suggestion cannot include replacement text." });
  }
});
export const studyNusmodsImportSchema = z.object({
  url: z.string().trim().url().max(4_000),
}).strict();
export const studyModuleCreateSchema = z.object({
  code: text(20),
  name: text(160),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  workloadGroup: nullableText(80),
}).strict();
export const studyModuleUpdateSchema = z.object({
  code: text(20).optional(),
  name: text(160).optional(),
  active: z.boolean().optional(),
  selected: z.boolean().optional(),
  pinned: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  workloadGroup: nullableText(80),
  mastery: z.nativeEnum(StudyTrafficLight).optional(),
  masteryReason: nullableText(1_000),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one module change.");

export const studyItemCreateSchema = z.object({
  moduleId: id,
  type: z.nativeEnum(StudyItemType),
  title: text(500),
  notes: optionalText(8_000),
  priority: z.nativeEnum(StudyPriority).optional(),
  dueAt: isoDate.optional(),
  plannedFor: dateOnly.nullable().optional(),
  plannedMinutes: z.number().int().min(1).max(1_440).optional(),
  weekNumber: z.number().int().min(1).max(80).optional(),
}).strict();

export const studyItemUpdateSchema = z.object({
  moduleId: id.optional(),
  type: z.nativeEnum(StudyItemType).optional(),
  title: text(500).optional(),
  notes: nullableText(8_000),
  status: z.nativeEnum(StudyItemStatus).optional(),
  priority: z.nativeEnum(StudyPriority).optional(),
  dueAt: isoDate.nullable().optional(),
  plannedFor: dateOnly.nullable().optional(),
  plannedMinutes: z.number().int().min(1).max(1_440).nullable().optional(),
  mastery: z.nativeEnum(StudyTrafficLight).optional(),
  masteryReason: nullableText(1_000),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one work-item change.");

export const studyResourceQuerySchema = z.object({
  moduleId: id.optional(),
  kind: z.nativeEnum(StudyResourceKind).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(STUDY_SCALE_BUDGETS.dashboardResourcePage).default(STUDY_SCALE_BUDGETS.dashboardResourcePage),
}).strict();

export const studyResourceCreateSchema = z.object({
  moduleId: id,
  kind: z.enum([StudyResourceKind.NOTE, StudyResourceKind.LINK, StudyResourceKind.QUESTION]),
  title: optionalText(500),
  body: z.string().max(100_000).optional(),
  url: z.string().url().max(4_000).optional(),
  tags: z.array(text(100)).max(20).optional(),
  caption: optionalText(4_000),
}).strict().superRefine((value, context) => {
  if (value.kind === StudyResourceKind.LINK && !value.url) {
    context.addIssue({ code: "custom", path: ["url"], message: "Add a valid link." });
  }
  if ((value.kind === StudyResourceKind.NOTE || value.kind === StudyResourceKind.QUESTION) && !value.body?.trim()) {
    context.addIssue({ code: "custom", path: ["body"], message: "Add some text." });
  }
});

export const studyResourceUpdateSchema = z.object({
  moduleId: id.optional(),
  title: text(500).optional(),
  body: z.string().max(100_000).nullable().optional(),
  url: z.string().url().max(4_000).nullable().optional(),
  tags: z.array(text(100)).max(20).optional(),
  caption: nullableText(4_000),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: isoDate.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one resource change.");

export const studyNoteDraftQuerySchema = z.object({
  resourceId: id.optional(),
}).strict();

export const studyNoteDraftSaveSchema = z.object({
  resourceId: id.nullable().optional(),
  resourceUpdatedAt: isoDate.nullable().optional(),
  moduleId: id.nullable().optional(),
  title: z.string().max(500).default(""),
  body: z.string().max(100_000).default(""),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().refine((value) => !value.resourceId || Boolean(value.resourceUpdatedAt), {
  message: "The saved note version is required for an editing draft.",
  path: ["resourceUpdatedAt"],
});

export const studySearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  moduleId: id.optional(),
  kinds: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(80).default(40),
}).strict();

export const studySessionStartSchema = z.object({
  moduleId: id,
  method: text(160),
  itemId: id.optional(),
  topic: optionalText(240),
  focusStructure: optionalText(80),
  techniques: z.array(text(160)).max(10).optional(),
  resourceIds: z.array(id).max(30).optional(),
}).strict();
export const studySessionStopSchema = z.object({
  result: optionalText(2_000),
  topicsMixed: z.array(text(160)).max(20).optional(),
  attemptedScore: z.number().min(0).max(100_000).optional(),
  maximumScore: z.number().positive().max(100_000).optional(),
  usedNotes: z.boolean().optional(),
}).strict();
export const studySessionResultSchema = studySessionStopSchema.refine((value) => Object.keys(value).length > 0, "Add at least one session result.");
export const studySessionUpdateSchema = z.object({
  method: text(160).optional(),
  topic: optionalText(240),
  focusStructure: optionalText(80),
  techniques: z.array(text(160)).max(10).optional(),
  resourceIds: z.array(id).max(30).optional(),
  result: nullableText(2_000),
  topicsMixed: z.array(text(160)).max(20).optional(),
  attemptedScore: z.number().min(0).max(100_000).nullable().optional(),
  maximumScore: z.number().positive().max(100_000).nullable().optional(),
  usedNotes: z.boolean().nullable().optional(),
  startedAt: isoDate.optional(),
  endedAt: isoDate.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one session change.");

export const studyMistakeCreateSchema = z.object({
  moduleId: id,
  itemId: id.optional(),
  source: text(2_000),
  category: z.nativeEnum(StudyMistakeCategory),
  cause: text(2_000),
  prevention: text(2_000),
  revisitAt: isoDate.optional(),
}).strict();

const reviewLine = z.string().trim().max(2_000);
export const studyWeeklyPlanSchema = z.object({
  priorities: z.array(text(500)).max(3),
  overloadNotes: optionalText(2_000),
}).strict();
export const studyWeeklyReviewSchema = z.object({
  moduleStatuses: z.array(z.object({
    moduleId: id,
    code: text(20),
    status: z.nativeEnum(StudyTrafficLight),
    unclear: reviewLine.optional(),
    unfinished: reviewLine.optional(),
    practice: reviewLine.optional(),
    mistakes: reviewLine.optional(),
    nextAction: reviewLine.optional(),
  }).strict()).min(1).max(40),
  wins: z.array(reviewLine).max(30),
  unresolvedTopics: z.array(reviewLine).max(30),
  nextWeekPriorities: z.array(reviewLine).max(3),
  lostTimeCauses: z.array(reviewLine).max(30),
  overloadNotes: optionalText(2_000),
  workloadCompatible: z.boolean().optional(),
  protectedOverflowBlock: optionalText(500),
}).strict();

export const studySettingsUpdateSchema = z.object({
  semesterName: text(120).optional(),
  semesterStartDate: isoDate.optional(),
  timezone: timezone.optional(),
  weeklyReviewDay: z.number().int().min(1).max(7).optional(),
  weeklyReviewTime: clock.optional(),
  weeklyPreviewDay: z.number().int().min(1).max(7).optional(),
  weeklyPreviewTime: clock.optional(),
  quietHoursStart: clock.nullable().optional(),
  quietHoursEnd: clock.nullable().optional(),
  maxRemindersPerDay: z.number().int().min(1).max(24).optional(),
  timedPracticeStartWeek: z.number().int().min(1).max(80).optional(),
  studyBlockRemindersEnabled: z.boolean().optional(),
  canvasSyncEnabled: z.boolean().optional(),
}).strip().refine((value) => Object.keys(value).length > 0, "Choose at least one Study setting.");

export const studyCanvasAssignmentActionSchema = z.object({ action: z.enum(["keep", "archive"]) }).strict();
export const studyOriginCreateSchema = z.object({
  name: text(80),
  venue: text(200),
  makeDefault: z.boolean().optional(),
  activateHours: z.number().int().min(1).max(24).optional(),
}).strict();
export const studyOriginUpdateSchema = z.object({
  name: text(80).optional(),
  makeDefault: z.boolean().optional(),
  activateHours: z.number().int().min(1).max(24).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one origin change.");
export const studyPlaceSearchSchema = z.object({ q: z.string().trim().min(2).max(100) }).strict();
export const studyScheduleCreateSchema = z.object({
  moduleId: z.union([id, z.null()]).optional(),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: clock,
  endTime: clock,
  label: text(200),
  blockType: optionalText(80),
  customTypeLabel: optionalText(80),
  recurrenceStartDate: z.union([dateOnly, z.null()]).optional(),
  recurrenceEndDate: z.union([dateOnly, z.null()]).optional(),
  startWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  endWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  destination: z.union([text(200), z.null()]).optional(),
  destinationPlaceId: z.union([text(240), z.null()]).optional(),
  defaultOriginId: z.union([id, z.null()]).optional(),
  travelBufferMinutes: z.number().int().min(0).max(90).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(120).optional(),
}).strict();
export const studyScheduleUpdateSchema = z.object({
  moduleId: z.union([id, z.null()]).optional(),
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  startTime: clock.optional(),
  endTime: clock.optional(),
  label: text(200).optional(),
  blockType: text(80).optional(),
  customTypeLabel: z.union([text(80), z.null()]).optional(),
  recurrenceStartDate: z.union([dateOnly, z.null()]).optional(),
  recurrenceEndDate: z.union([dateOnly, z.null()]).optional(),
  startWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  endWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  destination: z.union([text(200), z.null()]).optional(),
  destinationPlaceId: z.union([text(240), z.null()]).optional(),
  defaultOriginId: z.union([id, z.null()]).optional(),
  travelBufferMinutes: z.number().int().min(0).max(90).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(120).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one schedule change.");
export const studyScheduleDeleteSchema = z.object({
  scope: z.enum(["occurrence", "future", "series"]).default("series"),
  weekNumber: z.number().int().min(1).max(80).optional(),
  occurrenceDate: dateOnly.optional(),
}).strict().superRefine((value, context) => {
  if (value.scope !== "series" && value.weekNumber === undefined && value.occurrenceDate === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["occurrenceDate"], message: "Choose the occurrence to remove." });
  }
});

export class DashboardStudyAccessError extends Error {
  constructor() {
    super("Not found.");
    this.name = "DashboardStudyAccessError";
  }
}

export async function requireDashboardStudyWorkspace(
  scope: DashboardWorkspaceScope,
  database: PrismaClient = prisma,
  config = privateStudyConfig(),
): Promise<StudyWorkspace> {
  if (
    !config
    || scope.workspace.kind !== "GROUP"
    || scope.workspace.mode !== "STUDY"
    || scope.principalTelegramId !== config.ownerTelegramId
    || scope.telegramChatId !== config.allowedChatId
  ) {
    throw new DashboardStudyAccessError();
  }
  const workspace = await database.studyWorkspace.findFirst({
    where: {
      ownerTelegramId: config.ownerTelegramId,
      boundChatId: config.allowedChatId,
      active: true,
    },
  });
  if (!workspace) throw new DashboardStudyAccessError();
  return workspace;
}

export async function getDashboardStudySnapshot(workspace: StudyWorkspace, now = new Date()) {
  const [dashboard, attention, canvas] = await Promise.all([
    buildStudyDashboard(workspace, now),
    buildStudyAttentionSnapshot(workspace, now, 12),
    studyCanvasStatus(workspace.id),
  ]);
  const [modules, inactiveModules, items, resources, mistakes] = await Promise.all([
    prisma.studyModule.findMany({
      where: { workspaceId: workspace.id, active: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    }),
    prisma.studyModule.findMany({
      where: { workspaceId: workspace.id, active: false },
      orderBy: [{ userArchivedAt: { sort: "desc", nulls: "last" } }, { displayOrder: "asc" }, { code: "asc" }],
    }),
    prisma.studyItem.findMany({
      where: { workspaceId: workspace.id, module: { active: true }, status: { not: StudyItemStatus.SKIPPED } },
      include: {
        module: { select: { id: true, code: true, name: true, color: true, canvasTermStartAt: true, canvasTermEndAt: true } },
        week: { select: { number: true } },
        canvasAssignment: {
          select: {
            id: true,
            htmlUrl: true,
            status: true,
            submissionState: true,
            needsReview: true,
            missingSince: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.studyResource.findMany({
      where: { workspaceId: workspace.id, module: { active: true }, archivedAt: null },
      select: studyResourcePreviewSelect,
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: STUDY_SCALE_BUDGETS.dashboardSnapshotResources,
    }),
    listStudyMistakes(workspace.id, now),
  ]);
  const [sessions, reviews, scheduleBlocks, canvasAssignments, origins] = await Promise.all([
    prisma.studySession.findMany({
      where: { workspaceId: workspace.id, module: { active: true }, archivedAt: null },
      include: {
        module: { select: { code: true, name: true } },
        item: { select: { publicId: true, title: true } },
        resources: { include: { resource: { select: studyResourcePreviewSelect } } },
      },
      orderBy: { startedAt: "desc" },
      take: 80,
    }),
    prisma.weeklyReview.findMany({
      where: { workspaceId: workspace.id },
      include: { week: { select: { number: true, startDate: true, endDate: true, overallStatus: true } } },
      orderBy: { completedAt: "desc" },
      take: 16,
    }),
    prisma.studyScheduleBlock.findMany({
      where: { workspaceId: workspace.id, active: true, OR: [{ moduleId: null }, { module: { active: true } }] },
      include: {
        module: { select: { id: true, code: true, name: true } },
        defaultOrigin: { select: { id: true, name: true } },
        travelStates: { orderBy: { occurrenceDate: "desc" }, take: 1 },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    prisma.studyCanvasAssignment.findMany({
      where: { workspaceId: workspace.id, module: { active: true }, needsReview: true },
      include: { module: { select: { code: true, name: true } }, item: { select: { publicId: true, title: true, status: true } } },
      orderBy: { missingSince: "asc" },
      take: 100,
    }),
    listStudyOrigins(workspace.id),
  ]);
  const hydratedResourcePreviews = await hydrateLegacyStudyResourceAnalysis([
    ...resources,
    ...sessions.flatMap((session) => session.resources.map((link) => link.resource)),
  ]);
  const resourcePreviewById = new Map(hydratedResourcePreviews.map((resource) => [resource.id, resource]));
  const summaryByModule = new Map(dashboard.modules.map((module) => [module.id, module]));
  return {
    generatedAt: now,
    workspace: studyWorkspaceView(workspace),
    weekNumber: dashboard.weekNumber,
    week: dashboard.week,
    overview: {
      overallStatus: dashboard.overallStatus,
      amberWarning: dashboard.amberWarning,
      redWarning: dashboard.redWarning,
      topPriorities: dashboard.topPriorities,
      nextBlock: dashboard.nextBlock,
      openSession: dashboard.openSession,
      attention,
    },
    modules: modules.map((module) => ({ ...module, summary: summaryByModule.get(module.id) })),
    inactiveModules,
    items: items.map((item) => ({
      ...item,
      ...deadlineView(workspace, item),
    })),
    resources: resources.map((resource) => studyResourcePreview(resourcePreviewById.get(resource.id) ?? resource)),
    mistakes,
    sessions: sessions.map((session) => ({
      ...session,
      resources: session.resources.map((link) => ({
        ...link,
        resource: studyResourcePreview(resourcePreviewById.get(link.resource.id) ?? link.resource),
      })),
    })),
    reviews,
    scheduleBlocks: scheduleBlocks.map((block) => ({
      ...block,
      reminderReadiness: scheduleBlockReminderReadiness(workspace, block, origins, now),
    })),
    reminderDiagnostics: {
      lastCheckedAt: workspace.lastReminderCheckAt,
      status: workspace.lastReminderStatus ?? "NOT_CHECKED",
      summary: workspace.lastReminderSummary,
    },
    canvas: {
      configured: studyCanvasConfigured(),
      state: canvas,
      missingAssignments: canvasAssignments,
    },
    origins,
  };
}

export async function createDashboardStudyModule(workspace: StudyWorkspace, input: z.infer<typeof studyModuleCreateSchema>) {
  return addStudyModule(workspace, input.code, input.name, {
    color: input.color,
    workloadGroup: input.workloadGroup || null,
  });
}

export async function updateDashboardStudyModule(workspace: StudyWorkspace, moduleId: string, input: z.infer<typeof studyModuleUpdateSchema>) {
  const current = await findStudyModule(workspace.id, moduleId);
  const code = input.code ? normalizeModuleCode(input.code) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const module = await tx.studyModule.update({
      where: { id: current.id },
      data: {
        ...(code ? { code } : {}),
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.active !== undefined ? {
          active: input.active,
          userArchivedAt: input.active ? null : new Date(),
        } : {}),
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date() : null } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.workloadGroup !== undefined ? { workloadGroup: input.workloadGroup || null } : {}),
        ...(input.mastery !== undefined ? {
          currentMastery: input.mastery,
          ...(input.masteryReason !== undefined ? { masteryReason: input.masteryReason || null } : {}),
          redSince: input.mastery === StudyTrafficLight.RED ? current.redSince ?? new Date() : null,
          ...(input.mastery !== StudyTrafficLight.RED ? { lastRedWarningAt: null } : {}),
        } : input.masteryReason !== undefined ? { masteryReason: input.masteryReason || null } : {}),
      },
    });
    if (input.active === false && workspace.activeModuleId === current.id) {
      await tx.studyWorkspace.update({ where: { id: workspace.id }, data: { activeModuleId: null } });
    } else if (input.selected) {
      await tx.studyWorkspace.update({ where: { id: workspace.id }, data: { activeModuleId: current.id } });
    }
    await tx.auditLog.create({
      data: { userId: workspace.ownerUserId, action: "study.module.dashboard_updated", metadata: { workspaceId: workspace.id, moduleId: current.id } },
    });
    return module;
  });
  return updated;
}

export async function createDashboardStudyItem(workspace: StudyWorkspace, input: z.infer<typeof studyItemCreateSchema>) {
  const { dueAt, plannedFor, ...values } = input;
  return createStudyItem(workspace, {
    ...values,
    ...(dueAt ? { dueAt: new Date(dueAt) } : {}),
    ...(plannedFor ? { plannedFor: new Date(`${plannedFor}T00:00:00.000Z`), firstPlannedFor: new Date(`${plannedFor}T00:00:00.000Z`) } : {}),
  });
}

export async function updateDashboardStudyItem(workspace: StudyWorkspace, itemId: string, input: z.infer<typeof studyItemUpdateSchema>) {
  const current = await findStudyItem(workspace.id, itemId);
  if (input.moduleId) await findStudyModule(workspace.id, input.moduleId);
  const now = new Date();
  const dueAt = input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt);
  const plannedFor = input.plannedFor === undefined
    ? undefined
    : input.plannedFor === null
      ? null
      : new Date(`${input.plannedFor}T00:00:00.000Z`);
  const data: Prisma.StudyItemUncheckedUpdateInput = {
    ...(input.moduleId ? { moduleId: input.moduleId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.title ? { title: input.title, titleOverridden: Boolean(current.canvasAssignment) } : {}),
    ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.dueAt !== undefined ? { dueAt, dueAtOverridden: Boolean(current.canvasAssignment) } : {}),
    ...(input.plannedFor !== undefined ? {
      plannedFor,
      ...(!current.firstPlannedFor && plannedFor ? { firstPlannedFor: plannedFor } : {}),
    } : {}),
    ...(input.plannedMinutes !== undefined ? { plannedMinutes: input.plannedMinutes } : {}),
    ...(input.mastery ? { mastery: input.mastery } : {}),
    ...(input.masteryReason !== undefined ? { masteryReason: input.masteryReason || null } : {}),
    ...(input.status ? {
      status: input.status,
      completedAt: input.status === StudyItemStatus.DONE ? now : null,
      processedAt: input.status === StudyItemStatus.PROCESSED ? now : null,
    } : {}),
  };
  return prisma.$transaction(async (tx) => {
    const item = await tx.studyItem.update({ where: { id: current.id }, data, include: { module: true, week: true, canvasAssignment: true } });
    if (input.moduleId && current.canvasAssignment) {
      await tx.studyCanvasAssignment.update({ where: { itemId: current.id }, data: { moduleId: input.moduleId } });
    }
    if (input.status && current.canvasAssignment) {
      await tx.studyCanvasAssignment.update({
        where: { itemId: current.id },
        data: { userArchivedAt: input.status === StudyItemStatus.SKIPPED ? now : null },
      });
    }
    await tx.auditLog.create({
      data: { userId: workspace.ownerUserId, action: "study.item.dashboard_updated", metadata: { workspaceId: workspace.id, itemId: current.id, publicId: current.publicId } },
    });
    return item;
  });
}

export async function archiveDashboardStudyItem(workspace: StudyWorkspace, itemId: string) {
  const item = await findStudyItem(workspace.id, itemId);
  const archived = await prisma.$transaction(async (tx) => {
    const saved = await tx.studyItem.update({ where: { id: item.id }, data: { status: StudyItemStatus.SKIPPED } });
    if (item.canvasAssignment) {
      await tx.studyCanvasAssignment.update({ where: { itemId: item.id }, data: { userArchivedAt: new Date() } });
    }
    return saved;
  });
  await audit(workspace, "study.item.dashboard_archived", { itemId: item.id, publicId: item.publicId });
  return archived;
}

export async function completeDashboardStudyItem(workspace: StudyWorkspace, itemId: string, processed = false) {
  return completeStudyItem(workspace, itemId, processed);
}

export async function listDashboardStudyResources(workspace: StudyWorkspace, input: z.infer<typeof studyResourceQuerySchema>) {
  const query = input.q?.trim();
  const where: Prisma.StudyResourceWhereInput = {
    workspaceId: workspace.id,
    archivedAt: null,
    module: { active: true },
    ...(input.moduleId ? { moduleId: input.moduleId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(query ? { OR: resourceSearchWhere(query) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.studyResource.count({ where }),
    query
      ? prisma.studyResource.findMany({
          where,
          include: { module: { select: { id: true, code: true, name: true, color: true } } },
          orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        })
      : prisma.studyResource.findMany({
          where,
          select: studyResourcePreviewSelect,
          orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
  ]);
  const previewRows = query ? rows : await hydrateLegacyStudyResourceAnalysis(rows);
  const visible = query ? previewRows.filter((row) => contentMatchesQuery("StudyResource", row, query)) : previewRows;
  return { items: visible.map(studyResourcePreview), page: input.page, limit: input.limit, total, hasMore: input.page * input.limit < total };
}

export async function getDashboardStudyResource(workspace: StudyWorkspace, resourceId: string) {
  const resource = await findStudyResource(workspace.id, resourceId);
  return { ...resource, noteMeta: await studyNoteMetadata(resource) };
}

export async function getDashboardStudyItem(workspace: StudyWorkspace, itemId: string) {
  const item = await findStudyItem(workspace.id, itemId);
  return { ...item, ...deadlineView(workspace, item) };
}

function deadlineView(
  workspace: StudyWorkspace,
  item: {
    source: string;
    dueAt: Date | null;
    module: { canvasTermStartAt: Date | null; canvasTermEndAt: Date | null };
    canvasAssignment: { needsReview: boolean; status: string } | null;
  },
) {
  const assessment = assessStudyDeadline(workspace, item);
  return { deadlineStatus: assessment.status, deadlineIssue: assessment.reason };
}

function scheduleBlockReminderReadiness(
  workspace: StudyWorkspace,
  block: {
    startWeek: number | null;
    endWeek: number | null;
    excludedWeeks: number[];
    recurrenceStartDate: Date | null;
    recurrenceEndDate: Date | null;
    excludedDates: Date[];
    venueName: string | null;
    destinationStopId: string | null;
    defaultOriginId: string | null;
  },
  origins: Array<{ id: string; isDefault: boolean; active: boolean }>,
  now: Date,
) {
  const reasons: string[] = [];
  const weekNumber = academicWeekNumber(workspace, now);
  const localDate = DateTime.fromJSDate(now).setZone(workspace.timezone).toISODate();
  const calendarDay = localDate ? new Date(`${localDate}T00:00:00.000Z`) : now;
  const inRange = block.recurrenceStartDate || block.recurrenceEndDate || block.excludedDates.length
    ? studyScheduleOccursOnDate(block, calendarDay)
    : weekNumber > 0
      && (!block.startWeek || weekNumber >= block.startWeek)
      && (!block.endWeek || weekNumber <= block.endWeek)
      && !block.excludedWeeks.includes(weekNumber);
  if (!inRange) reasons.push("This block does not occur in the current academic week.");
  if (!workspace.boundChatId) reasons.push("Study Mode is not bound to a Telegram chat.");
  const travelRequested = Boolean(block.venueName || block.destinationStopId);
  if (travelRequested && (!block.venueName || !block.destinationStopId)) {
    reasons.push("Pick a recognized destination to arm live travel reminders.");
  }
  const hasOrigin = Boolean(
    block.defaultOriginId
    || workspace.activeOriginId
    || origins.some((origin) => origin.active && origin.isDefault),
  );
  if (travelRequested && !hasOrigin) reasons.push("Choose a current or default travel origin.");
  if (travelRequested && workspace.travelMutedUntil && workspace.travelMutedUntil > now) {
    reasons.push("Travel reminders are muted for today.");
  }
  if (!travelRequested && !workspace.studyBlockRemindersEnabled) {
    reasons.push("Study-block reminders are turned off.");
  }
  if (workspace.lastReminderStatus === "UNSAFE_CHAT") {
    reasons.push("The last reminder check could not verify the private Study chat.");
  }
  return {
    status: reasons.length === 0 ? "READY" : inRange ? "BLOCKED" : "OUT_OF_RANGE",
    mode: travelRequested ? "TRAVEL" : "BLOCK",
    reasons,
  };
}

export async function createDashboardStudyResource(workspace: StudyWorkspace, input: z.infer<typeof studyResourceCreateSchema>) {
  const result = await createStudyResource(workspace, {
    moduleId: input.moduleId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    url: input.url,
    tags: input.tags,
    caption: input.caption,
  });
  return result.resource;
}

const STUDY_NOTE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export async function getDashboardStudyNoteDraft(
  workspace: StudyWorkspace,
  input: z.infer<typeof studyNoteDraftQuerySchema>,
) {
  await purgeExpiredStudyNoteDrafts(workspace);
  return prisma.studyNoteDraft.findFirst({
    where: {
      workspaceId: workspace.id,
      ownerUserId: workspace.ownerUserId,
      draftKey: input.resourceId ?? "new",
      expiresAt: { gt: new Date() },
    },
  });
}

export async function saveDashboardStudyNoteDraft(
  workspace: StudyWorkspace,
  input: z.infer<typeof studyNoteDraftSaveSchema>,
) {
  const resourceId = input.resourceId ?? null;
  const draftKey = resourceId ?? "new";
  if (input.moduleId) await findStudyModule(workspace.id, input.moduleId);
  if (resourceId) {
    const resource = await findStudyResource(workspace.id, resourceId);
    if (resource.kind !== StudyResourceKind.NOTE) throw new StudyModeError("Only Study notes can have writing drafts.", "invalid");
    if (resource.updatedAt.toISOString() !== input.resourceUpdatedAt) {
      throw new StudyModeError("The saved note changed before this draft started. Reload it before continuing.", "conflict");
    }
  }
  await purgeExpiredStudyNoteDrafts(workspace);
  const expiresAt = new Date(Date.now() + STUDY_NOTE_DRAFT_TTL_MS);
  const existing = await prisma.studyNoteDraft.findUnique({
    where: { workspaceId_draftKey: { workspaceId: workspace.id, draftKey } },
  });
  if (!existing) {
    if (input.expectedRevision !== 0) throw new StudyModeError("This draft changed somewhere else. Reload it before continuing.", "conflict");
    try {
      return await prisma.studyNoteDraft.create({
        data: {
          workspaceId: workspace.id,
          ownerUserId: workspace.ownerUserId,
          draftKey,
          resourceId,
          resourceUpdatedAt: resourceId ? new Date(input.resourceUpdatedAt!) : null,
          moduleId: input.moduleId ?? null,
          title: input.title,
          body: input.body,
          expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new StudyModeError("This draft changed somewhere else. Reload it before continuing.", "conflict");
      }
      throw error;
    }
  }
  const updated = await prisma.studyNoteDraft.updateMany({
    where: {
      id: existing.id,
      workspaceId: workspace.id,
      ownerUserId: workspace.ownerUserId,
      revision: input.expectedRevision,
    },
    data: {
      moduleId: input.moduleId ?? null,
      title: input.title,
      body: input.body,
      expiresAt,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new StudyModeError("This draft changed somewhere else. Reload it before continuing.", "conflict");
  return prisma.studyNoteDraft.findUniqueOrThrow({ where: { id: existing.id } });
}

export async function deleteDashboardStudyNoteDraft(workspace: StudyWorkspace, draftId: string) {
  const removed = await prisma.studyNoteDraft.deleteMany({
    where: { id: draftId, workspaceId: workspace.id, ownerUserId: workspace.ownerUserId },
  });
  if (removed.count !== 1) throw new StudyModeError("Draft not found.", "not_found");
}

async function purgeExpiredStudyNoteDrafts(workspace: StudyWorkspace) {
  await prisma.studyNoteDraft.deleteMany({
    where: { workspaceId: workspace.id, ownerUserId: workspace.ownerUserId, expiresAt: { lte: new Date() } },
  });
}

export async function updateDashboardStudyResource(workspace: StudyWorkspace, resourceId: string, input: z.infer<typeof studyResourceUpdateSchema>) {
  const resource = await findStudyResource(workspace.id, resourceId);
  if (input.moduleId) await findStudyModule(workspace.id, input.moduleId);
  const partialData = {
    ...(input.moduleId ? { moduleId: input.moduleId } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date() : null } : {}),
  };
  const nextTitle = input.title ?? resource.title;
  const nextBody = input.body !== undefined ? input.body : resource.body;
  const nextCaption = input.caption !== undefined ? input.caption : resource.caption;
  if (input.body !== undefined || input.caption !== undefined) {
    Object.assign(partialData, deriveStudyResourceAnalysis({ ...resource, body: nextBody, caption: nextCaption }));
  }
  if (input.title !== undefined) {
    Object.assign(partialData, { wikiLookupKeys: studyResourceWikiLookupKeys({ kind: resource.kind, title: nextTitle, publicId: resource.publicId }) });
  }
  const data = completeSearchableContentUpdate("StudyResource", resource, partialData);
  const noteContentChanged = resource.kind === StudyResourceKind.NOTE && (
    input.title !== undefined || input.body !== undefined || input.tags !== undefined || input.moduleId !== undefined
  );
  const updated = await prisma.$transaction(async (tx) => {
    if (input.expectedUpdatedAt) {
      const written = await tx.studyResource.updateMany({
        where: { id: resource.id, workspaceId: workspace.id, updatedAt: new Date(input.expectedUpdatedAt) },
        data,
      });
      if (written.count !== 1) throw new StudyModeError("This note changed somewhere else. Reopen it before saving so nothing is overwritten.", "conflict");
    } else {
      await tx.studyResource.update({ where: { id: resource.id }, data });
    }
    const saved = await tx.studyResource.findUniqueOrThrow({ where: { id: resource.id }, include: { module: true } });
    if (noteContentChanged) {
      await recordStudyNoteRevision(saved, "DASHBOARD", tx);
      await rebuildStudyNoteLinks(workspace.id, saved.id, tx);
    }
    await tx.auditLog.create({ data: { userId: workspace.ownerUserId, action: "study.resource.dashboard_updated", metadata: { workspaceId: workspace.id, resourceId: resource.id, publicId: resource.publicId } } });
    return saved;
  });
  return { ...updated, noteMeta: await studyNoteMetadata(updated) };
}

export async function archiveDashboardStudyResource(workspace: StudyWorkspace, resourceId: string) {
  return archiveStudyResource(workspace, resourceId);
}

export async function loadDashboardStudyResourceContent(
  workspace: StudyWorkspace,
  resourceId: string,
  botToken: string | undefined,
  fetcher: typeof fetch = fetch,
  resourceLoader: typeof findStudyResource = findStudyResource,
) {
  if (!botToken) throw new StudyModeError("This file is temporarily unavailable.", "invalid");
  const resource = await resourceLoader(workspace.id, resourceId);
  if (!resource.telegramFileId) throw new StudyModeError("This resource has no stored Telegram file.", "not_found");
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let metadata: Response;
    try {
      metadata = await fetcher(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(resource.telegramFileId)}`, {
        signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
      });
    } catch {
      if (attempt === 0) continue;
      throw new StudyModeError("Telegram is temporarily unavailable. Retry in a moment.", "invalid");
    }
    if (metadata.status === 400 || metadata.status === 404) {
      throw new StudyModeError("The original Telegram file is no longer available.", "not_found");
    }
    if (!metadata.ok) {
      if (attempt === 0) continue;
      throw new StudyModeError("Telegram is temporarily unavailable. Retry in a moment.", "invalid");
    }
    const payload = await metadata.json() as { ok?: boolean; result?: { file_path?: string } };
    const filePath = payload.ok ? payload.result?.file_path : undefined;
    if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
      throw new StudyModeError("The original Telegram file is no longer available.", "not_found");
    }
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    try {
      response = await fetcher(`https://api.telegram.org/file/bot${botToken}/${encodedPath}`, {
        signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
      });
    } catch {
      response = undefined;
    }
    if (response?.ok) break;
    // Telegram download paths are short-lived. Resolve a fresh path once before failing.
    if (attempt === 0 && (!response || response.status === 404 || response.status === 410 || response.status >= 500)) continue;
    throw new StudyModeError("Telegram is temporarily unavailable. Retry in a moment.", "invalid");
  }
  if (!response?.ok) throw new StudyModeError("Telegram is temporarily unavailable. Retry in a moment.", "invalid");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_STUDY_FILE_BYTES) throw new StudyModeError("This file is too large to open here.", "invalid");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_STUDY_FILE_BYTES) throw new StudyModeError("This file is too large to open here.", "invalid");
  const detectedType = detectImageMime(bytes);
  const upstreamType = safeMime(response.headers.get("content-type"));
  const storedType = safeMime(resource.mimeType);
  const contentType = detectedType
    || (upstreamType && upstreamType !== "application/octet-stream" ? upstreamType : undefined)
    || storedType
    || upstreamType
    || "application/octet-stream";
  return {
    bytes,
    contentType,
    inline: SAFE_INLINE_TYPES.has(contentType),
    fileName: safeFileName(resource.fileName || `${resource.publicId}.${extensionFor(contentType)}`),
  };
}

export async function searchDashboardStudy(workspace: StudyWorkspace, input: z.infer<typeof studySearchQuerySchema>) {
  const allowed = new Set(["work", "notes", "images", "links", "files", "questions", "mistakes"]);
  const requested = input.kinds?.split(",").map((kind) => kind.trim().toLowerCase()).filter(Boolean) ?? [];
  if (requested.some((kind) => !allowed.has(kind))) throw new StudyModeError("Choose a valid Study search filter.", "invalid");
  const kinds = new Set(requested.length ? requested : [...allowed]);
  const query = input.q.trim();
  const perCollection = Math.max(4, Math.ceil(input.limit / 3));
  const [items, resources, mistakes] = await Promise.all([
    kinds.has("work") ? prisma.studyItem.findMany({
      where: {
        workspaceId: workspace.id,
        module: { active: true },
        status: { not: StudyItemStatus.SKIPPED },
        ...(input.moduleId ? { moduleId: input.moduleId } : {}),
        OR: [{ title: { contains: query, mode: "insensitive" } }, { notes: { contains: query, mode: "insensitive" } }],
      },
      include: { module: { select: { code: true, name: true } } },
      orderBy: { updatedAt: "desc" }, take: perCollection,
    }) : Promise.resolve([]),
    [...kinds].some((kind) => kind !== "work" && kind !== "mistakes") ? prisma.studyResource.findMany({
      where: {
        workspaceId: workspace.id,
        module: { active: true },
        archivedAt: null,
        ...(input.moduleId ? { moduleId: input.moduleId } : {}),
        kind: { in: resourceKindsForSearch(kinds) },
        OR: resourceSearchWhere(query),
      },
      include: { module: { select: { code: true, name: true } } },
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }], take: perCollection,
    }) : Promise.resolve([]),
    kinds.has("mistakes") ? prisma.studyMistake.findMany({
      where: {
        workspaceId: workspace.id,
        module: { active: true },
        ...(input.moduleId ? { moduleId: input.moduleId } : {}),
        OR: [
          { source: { contains: query, mode: "insensitive" } },
          { cause: { contains: query, mode: "insensitive" } },
          { prevention: { contains: query, mode: "insensitive" } },
        ],
      },
      include: { module: { select: { code: true, name: true } } },
      orderBy: { updatedAt: "desc" }, take: perCollection,
    }) : Promise.resolve([]),
  ]);
  return [
    ...items.map((item) => ({ id: item.id, publicId: item.publicId, kind: "work" as const, title: item.title, excerpt: excerpt(item.notes), module: item.module, updatedAt: item.updatedAt })),
    ...resources.filter((resource) => contentMatchesQuery("StudyResource", resource, query)).map((resource) => ({ id: resource.id, publicId: resource.publicId, kind: resource.kind.toLowerCase(), title: resource.title, excerpt: excerpt(resource.body || resource.caption || resource.ocrText || resource.url), module: resource.module, updatedAt: resource.updatedAt })),
    ...mistakes.map((mistake) => ({ id: mistake.id, publicId: mistake.publicId, kind: "mistake" as const, title: mistake.source, excerpt: excerpt(`${mistake.cause} ${mistake.prevention}`), module: mistake.module, updatedAt: mistake.updatedAt })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, input.limit);
}

export async function startDashboardStudySession(workspace: StudyWorkspace, input: z.infer<typeof studySessionStartSchema>) {
  return startStudySession(workspace, input.moduleId, input.method, input.itemId, input);
}

export async function stopDashboardStudySession(workspace: StudyWorkspace, input: z.infer<typeof studySessionStopSchema>) {
  return stopStudySession(workspace, input);
}

export async function updateDashboardStudySession(workspace: StudyWorkspace, sessionId: string, input: z.infer<typeof studySessionUpdateSchema>) {
  const { startedAt, endedAt, ...values } = input;
  return updateStudySession(workspace, sessionId, {
    ...values,
    ...(startedAt ? { startedAt: new Date(startedAt) } : {}),
    ...(endedAt ? { endedAt: new Date(endedAt) } : {}),
  });
}

export async function archiveDashboardStudySession(workspace: StudyWorkspace, sessionId: string) {
  return archiveStudySession(workspace, sessionId);
}

export async function createDashboardStudyMistake(workspace: StudyWorkspace, input: z.infer<typeof studyMistakeCreateSchema>) {
  const { revisitAt, ...values } = input;
  return recordStudyMistake(workspace, { ...values, ...(revisitAt ? { revisitAt: new Date(revisitAt) } : {}) });
}

export async function resolveDashboardStudyMistake(workspace: StudyWorkspace, mistakeId: string) {
  return resolveStudyMistake(workspace, mistakeId);
}

export async function saveDashboardStudyWeeklyPlan(workspace: StudyWorkspace, input: z.infer<typeof studyWeeklyPlanSchema>) {
  return updateWeeklyPlan(workspace, input.priorities, input.overloadNotes);
}

export async function saveDashboardStudyWeeklyReview(workspace: StudyWorkspace, input: z.infer<typeof studyWeeklyReviewSchema>) {
  return saveWeeklyReview(workspace, input);
}

export async function updateDashboardStudySettings(workspace: StudyWorkspace, input: z.infer<typeof studySettingsUpdateSchema>) {
  const nextTimezone = input.timezone ?? workspace.timezone;
  let configured = workspace;
  if (input.semesterName !== undefined || input.semesterStartDate !== undefined || input.timezone !== undefined) {
    const start = input.semesterStartDate ? new Date(input.semesterStartDate) : workspace.semesterStartDate;
    if (!start) throw new StudyModeError("Choose the semester's starting Monday.", "invalid");
    configured = await configureStudyWorkspace(workspace.id, {
      semesterName: input.semesterName ?? workspace.semesterName,
      semesterStartDate: start,
      timezone: nextTimezone,
    });
  }
  if ((input.quietHoursStart === null) !== (input.quietHoursEnd === null)
    && (input.quietHoursStart !== undefined || input.quietHoursEnd !== undefined)) {
    throw new StudyModeError("Set both quiet-hour times, or turn both off.", "invalid");
  }
  const updated = await prisma.studyWorkspace.update({
    where: { id: workspace.id },
    data: {
      ...(input.weeklyReviewDay !== undefined ? { weeklyReviewDay: input.weeklyReviewDay } : {}),
      ...(input.weeklyReviewTime !== undefined ? { weeklyReviewTime: input.weeklyReviewTime } : {}),
      ...(input.weeklyPreviewDay !== undefined ? { weeklyPreviewDay: input.weeklyPreviewDay } : {}),
      ...(input.weeklyPreviewTime !== undefined ? { weeklyPreviewTime: input.weeklyPreviewTime } : {}),
      ...(input.quietHoursStart !== undefined ? { quietHoursStart: input.quietHoursStart } : {}),
      ...(input.quietHoursEnd !== undefined ? { quietHoursEnd: input.quietHoursEnd } : {}),
      ...(input.maxRemindersPerDay !== undefined ? { maxRemindersPerDay: input.maxRemindersPerDay } : {}),
      ...(input.timedPracticeStartWeek !== undefined ? { timedPracticeStartWeek: input.timedPracticeStartWeek } : {}),
      ...(input.studyBlockRemindersEnabled !== undefined ? { studyBlockRemindersEnabled: input.studyBlockRemindersEnabled } : {}),
      ...(input.canvasSyncEnabled !== undefined ? { canvasSyncEnabled: input.canvasSyncEnabled } : {}),
    },
  });
  await audit(updated, "study.settings.dashboard_updated", { timezone: configured.timezone });
  return updated;
}

export async function syncDashboardStudyCanvas(workspace: StudyWorkspace) {
  return syncStudyCanvas(workspace, { force: true });
}

export async function importDashboardStudyNusmods(workspace: StudyWorkspace, input: z.infer<typeof studyNusmodsImportSchema>) {
  return importStudyNusmodsTimetable(workspace, input.url);
}

export async function resolveDashboardStudyCanvasAssignment(workspace: StudyWorkspace, assignmentId: string, action: "keep" | "archive") {
  const assignment = await prisma.studyCanvasAssignment.findFirst({ where: { id: assignmentId, workspaceId: workspace.id } });
  if (!assignment?.needsReview) throw new StudyModeError("That Canvas review item is no longer pending.", "not_found");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.studyCanvasAssignment.update({
      where: { id: assignment.id },
      data: { needsReview: false, ...(action === "archive" ? { userArchivedAt: new Date() } : {}) },
    });
    if (action === "archive") {
      await tx.studyItem.update({ where: { id: assignment.itemId }, data: { status: StudyItemStatus.SKIPPED } });
    }
    await tx.auditLog.create({
      data: { userId: workspace.ownerUserId, action: `study.canvas.missing_${action}`, metadata: { workspaceId: workspace.id, assignmentId: assignment.id, itemId: assignment.itemId } },
    });
    return updated;
  });
}

export async function createDashboardStudyOrigin(workspace: StudyWorkspace, input: z.infer<typeof studyOriginCreateSchema>) {
  return addStudyOriginFromVenue(workspace, input.name, input.venue, input);
}

export async function updateDashboardStudyOrigin(workspace: StudyWorkspace, originId: string, input: z.infer<typeof studyOriginUpdateSchema>) {
  let origin = input.name ? await renameStudyOrigin(workspace, originId, input.name) : undefined;
  if (input.makeDefault) origin = (await setDefaultStudyOrigin(workspace, originId)) as typeof origin;
  if (input.activateHours) origin = (await activateStudyOrigin(workspace, originId, input.activateHours)).origin;
  return origin ?? (await listStudyOrigins(workspace.id)).find((value) => value.id === originId);
}

export async function deleteDashboardStudyOrigin(workspace: StudyWorkspace, originId: string) {
  await deleteStudyOrigin(workspace, originId);
}

export async function searchDashboardStudyPlaces(workspace: StudyWorkspace, query: string) {
  void workspace;
  return searchStudyPlaces(query, 10);
}

export async function createDashboardStudyScheduleBlock(workspace: StudyWorkspace, input: z.infer<typeof studyScheduleCreateSchema>) {
  const block = await addStudyScheduleBlock(workspace, input);
  if (!input.destination) return block;
  if (!input.destinationPlaceId) return setStudyScheduleDestinationLabel(workspace, block.id, input.destination);
  return configureStudyScheduleTravel(workspace, block.id, {
    destination: input.destination,
    destinationPlaceId: input.destinationPlaceId,
    originReference: input.defaultOriginId,
    travelBufferMinutes: input.travelBufferMinutes,
  });
}

export async function updateDashboardStudyScheduleBlock(
  workspace: StudyWorkspace,
  blockId: string,
  input: z.infer<typeof studyScheduleUpdateSchema>,
) {
  const core = {
    moduleId: input.moduleId,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    label: input.label,
    blockType: input.blockType,
    customTypeLabel: input.customTypeLabel,
    recurrenceStartDate: input.recurrenceStartDate,
    recurrenceEndDate: input.recurrenceEndDate,
    startWeek: input.startWeek,
    endWeek: input.endWeek,
    defaultOriginId: input.destination === null ? undefined : input.defaultOriginId,
    travelBufferMinutes: input.travelBufferMinutes,
    reminderLeadMinutes: input.reminderLeadMinutes,
  };
  if (Object.values(core).some((value) => value !== undefined)) {
    await updateStudyScheduleBlock(workspace, blockId, core);
  }
  if (input.destination === null) return clearStudyScheduleTravel(workspace, blockId);
  if (input.destination) {
    if (!input.destinationPlaceId) return setStudyScheduleDestinationLabel(workspace, blockId, input.destination);
    return configureStudyScheduleTravel(workspace, blockId, {
      destination: input.destination,
      destinationPlaceId: input.destinationPlaceId,
      originReference: input.defaultOriginId,
      travelBufferMinutes: input.travelBufferMinutes,
    });
  }
  return prisma.studyScheduleBlock.findFirstOrThrow({ where: { id: blockId, workspaceId: workspace.id, active: true } });
}

export async function archiveDashboardStudyScheduleBlock(
  workspace: StudyWorkspace,
  blockId: string,
  input: z.infer<typeof studyScheduleDeleteSchema>,
) {
  return archiveStudyScheduleBlock(workspace, blockId, input);
}

function studyWorkspaceView(workspace: StudyWorkspace) {
  return {
    id: workspace.id,
    semesterName: workspace.semesterName,
    semesterStartDate: workspace.semesterStartDate,
    timezone: workspace.timezone,
    activeModuleId: workspace.activeModuleId,
    weeklyReviewDay: workspace.weeklyReviewDay,
    weeklyReviewTime: workspace.weeklyReviewTime,
    weeklyPreviewDay: workspace.weeklyPreviewDay,
    weeklyPreviewTime: workspace.weeklyPreviewTime,
    quietHoursStart: workspace.quietHoursStart,
    quietHoursEnd: workspace.quietHoursEnd,
    maxRemindersPerDay: workspace.maxRemindersPerDay,
    timedPracticeStartWeek: workspace.timedPracticeStartWeek,
    studyBlockRemindersEnabled: workspace.studyBlockRemindersEnabled,
    canvasSyncEnabled: workspace.canvasSyncEnabled,
    activeOriginId: workspace.activeOriginId,
    activeOriginUntil: workspace.activeOriginUntil,
  };
}

export const studyResourcePreviewSelect = {
  id: true, workspaceId: true, moduleId: true, publicId: true, kind: true, title: true, url: true, tags: true,
  mediaKind: true, mimeType: true, fileName: true, fileSize: true, ocrConfidence: true, pinnedAt: true,
  sourceSentAt: true, createdAt: true, updatedAt: true, analysisExcerpt: true, analysisExcerptReady: true,
  analysisExcerptTruncated: true, captionPreview: true, ocrPreview: true, ocrPreviewTruncated: true,
  module: { select: { id: true, code: true, name: true, color: true } },
} satisfies Prisma.StudyResourceSelect;

function studyResourcePreview<T extends {
  kind: StudyResourceKind; analysisExcerpt?: string | null; analysisExcerptReady?: boolean; analysisExcerptTruncated?: boolean;
  captionPreview?: string | null; ocrPreview?: string | null; ocrPreviewTruncated?: boolean;
  body?: string | null; ocrText?: string | null; caption?: string | null;
}>(resource: T) {
  const {
    analysisExcerpt, analysisExcerptReady: _analysisExcerptReady, analysisExcerptTruncated,
    captionPreview, ocrPreview, ocrPreviewTruncated, ...rest
  } = resource;
  const bodyPreview = excerpt(analysisExcerpt ?? resource.body ?? null, STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars);
  const imageCaptionPreview = excerpt(captionPreview ?? resource.caption ?? null, STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars);
  const imageOcrPreview = excerpt(ocrPreview ?? resource.ocrText ?? null, STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars);
  const documentLike = resource.kind === StudyResourceKind.NOTE || resource.kind === StudyResourceKind.QUESTION || resource.kind === StudyResourceKind.LINK;
  return {
    ...rest,
    body: documentLike ? bodyPreview : null,
    ocrText: documentLike ? null : imageOcrPreview,
    caption: documentLike ? null : imageCaptionPreview,
    hasMoreBody: documentLike && Boolean(analysisExcerptTruncated),
    hasMoreOcr: !documentLike && Boolean(ocrPreviewTruncated || (resource.ocrText && Array.from(resource.ocrText).length > STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars)),
  };
}

async function hydrateLegacyStudyResourceAnalysis<
  T extends {
    id: string; workspaceId: string; kind: StudyResourceKind; analysisExcerpt: string | null; analysisExcerptReady: boolean;
    analysisExcerptTruncated: boolean; captionPreview: string | null; ocrPreview: string | null; ocrPreviewTruncated: boolean;
  },
>(resources: T[]): Promise<T[]> {
  const legacyIds = [...new Set(resources.filter((resource) => !resource.analysisExcerptReady).map((resource) => resource.id))];
  if (!legacyIds.length) return resources;
  const legacyRows = await prisma.studyResource.findMany({
    where: { workspaceId: resources[0]!.workspaceId, id: { in: legacyIds } },
    select: { id: true, kind: true, body: true, caption: true, ocrText: true },
  });
  const derivedById = new Map(legacyRows.map((resource) => [resource.id, deriveStudyResourceAnalysis(resource)]));
  return resources.map((resource) => ({ ...resource, ...derivedById.get(resource.id) }));
}

function resourceSearchWhere(query: string): Prisma.StudyResourceWhereInput[] {
  const encrypted = encryptedSearchClause("StudyResource", query);
  return [
    { title: { contains: query, mode: "insensitive" } },
    { body: { contains: query, mode: "insensitive" } },
    { caption: { contains: query, mode: "insensitive" } },
    { ocrText: { contains: query, mode: "insensitive" } },
    { fileName: { contains: query, mode: "insensitive" } },
    { url: { contains: query, mode: "insensitive" } },
    { tags: { has: query.toLowerCase().replace(/^#/, "") } },
    ...(encrypted ? [encrypted] : []),
  ];
}

function resourceKindsForSearch(kinds: Set<string>): StudyResourceKind[] {
  const result: StudyResourceKind[] = [];
  if (kinds.has("notes")) result.push(StudyResourceKind.NOTE);
  if (kinds.has("images")) result.push(StudyResourceKind.IMAGE);
  if (kinds.has("links")) result.push(StudyResourceKind.LINK);
  if (kinds.has("files")) result.push(StudyResourceKind.FILE);
  if (kinds.has("questions")) result.push(StudyResourceKind.QUESTION);
  return result;
}

function normalizeModuleCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{2,6}\d{3,5}[A-Z]?$/.test(code)) throw new StudyModeError("Use a module code such as CS2100 or CS2103T.", "invalid");
  return code;
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 20);
}

function excerpt(value: string | null | undefined, max = 240): string | undefined {
  if (!value) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}...`;
}

function safeMime(value: string | null | undefined): string | undefined {
  const mime = value?.toLowerCase().split(";")[0]?.trim();
  if (!mime || !/^(?:image\/(?:jpeg|png|webp|gif)|application\/pdf|text\/plain|application\/(?:zip|octet-stream)|application\/vnd\.[a-z0-9.+-]+)$/i.test(mime)) return undefined;
  return mime;
}

function detectImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" || String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  return undefined;
}

function safeFileName(value: string): string {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "study-resource";
}

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "text/plain") return "txt";
  return contentType.startsWith("image/") ? contentType.slice(6) : "bin";
}

async function audit(workspace: StudyWorkspace, action: string, metadata: Prisma.InputJsonObject) {
  await prisma.auditLog.create({ data: { userId: workspace.ownerUserId, action, metadata: { workspaceId: workspace.id, ...metadata } } });
}
