import {
  Prisma,
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
import { privateStudyConfig } from "../config/env";
import { prisma } from "../db/prisma";
import {
  addStudyModule,
  addStudyScheduleBlock,
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
  updateStudySessionResult,
  updateStudyScheduleBlock,
  updateWeeklyPlan,
  StudyModeError,
} from "../services/study";
import { buildStudyAttentionSnapshot } from "../services/studyAttention";
import { studyCanvasConfigured, studyCanvasStatus, syncStudyCanvas } from "../services/studyCanvas";
import {
  archiveStudyResource,
  createStudyResource,
  findStudyResource,
} from "../services/studyResources";
import {
  activateStudyOrigin,
  addStudyOriginFromVenue,
  clearStudyScheduleTravel,
  configureStudyScheduleTravel,
  deleteStudyOrigin,
  listStudyOrigins,
  renameStudyOrigin,
  setDefaultStudyOrigin,
} from "../services/studyTransit";
import type { DashboardWorkspaceScope } from "./workspaces";

const MAX_STUDY_FILE_BYTES = 20_000_000;
const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;
const SAFE_INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
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
  plannedMinutes: z.number().int().min(1).max(1_440).nullable().optional(),
  mastery: z.nativeEnum(StudyTrafficLight).optional(),
  masteryReason: nullableText(1_000),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one work-item change.");

export const studyResourceQuerySchema = z.object({
  moduleId: id.optional(),
  kind: z.nativeEnum(StudyResourceKind).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(30),
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
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one resource change.");

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
}).strict();
export const studySessionStopSchema = z.object({
  result: optionalText(2_000),
  topicsMixed: z.array(text(160)).max(20).optional(),
  attemptedScore: z.number().min(0).max(100_000).optional(),
  maximumScore: z.number().positive().max(100_000).optional(),
  usedNotes: z.boolean().optional(),
}).strict();
export const studySessionResultSchema = studySessionStopSchema.refine((value) => Object.keys(value).length > 0, "Add at least one session result.");

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
export const studyScheduleCreateSchema = z.object({
  moduleId: z.union([id, z.null()]).optional(),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: clock,
  endTime: clock,
  label: text(200),
  blockType: optionalText(80),
  startWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  endWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  destination: optionalText(200),
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
  startWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  endWeek: z.union([z.number().int().min(1).max(80), z.null()]).optional(),
  destination: z.union([text(200), z.null()]).optional(),
  defaultOriginId: z.union([id, z.null()]).optional(),
  travelBufferMinutes: z.number().int().min(0).max(90).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(120).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one schedule change.");

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
        module: { select: { id: true, code: true, name: true, color: true } },
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
      include: { module: { select: { id: true, code: true, name: true, color: true } } },
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 400,
    }),
    listStudyMistakes(workspace.id, now),
  ]);
  const [sessions, reviews, scheduleBlocks, canvasAssignments, origins] = await Promise.all([
    prisma.studySession.findMany({
      where: { workspaceId: workspace.id, module: { active: true } },
      include: { module: { select: { code: true, name: true } }, item: { select: { publicId: true, title: true } } },
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
      include: { module: { select: { id: true, code: true, name: true } }, defaultOrigin: { select: { id: true, name: true } } },
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
    items,
    resources: resources.map(studyResourcePreview),
    mistakes,
    sessions,
    reviews,
    scheduleBlocks,
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
  const { dueAt, ...values } = input;
  return createStudyItem(workspace, {
    ...values,
    ...(dueAt ? { dueAt: new Date(dueAt) } : {}),
  });
}

export async function updateDashboardStudyItem(workspace: StudyWorkspace, itemId: string, input: z.infer<typeof studyItemUpdateSchema>) {
  const current = await findStudyItem(workspace.id, itemId);
  if (input.moduleId) await findStudyModule(workspace.id, input.moduleId);
  const now = new Date();
  const dueAt = input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt);
  const data: Prisma.StudyItemUncheckedUpdateInput = {
    ...(input.moduleId ? { moduleId: input.moduleId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.title ? { title: input.title, titleOverridden: Boolean(current.canvasAssignment) } : {}),
    ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.dueAt !== undefined ? { dueAt, dueAtOverridden: Boolean(current.canvasAssignment) } : {}),
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
    prisma.studyResource.findMany({
      where,
      include: { module: { select: { id: true, code: true, name: true, color: true } } },
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
  ]);
  return { items: rows.map(studyResourcePreview), page: input.page, limit: input.limit, total, hasMore: input.page * input.limit < total };
}

export async function getDashboardStudyResource(workspace: StudyWorkspace, resourceId: string) {
  return findStudyResource(workspace.id, resourceId);
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

export async function updateDashboardStudyResource(workspace: StudyWorkspace, resourceId: string, input: z.infer<typeof studyResourceUpdateSchema>) {
  const resource = await findStudyResource(workspace.id, resourceId);
  if (input.moduleId) await findStudyModule(workspace.id, input.moduleId);
  const updated = await prisma.studyResource.update({
    where: { id: resource.id },
    data: {
      ...(input.moduleId ? { moduleId: input.moduleId } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date() : null } : {}),
    },
    include: { module: true },
  });
  await audit(workspace, "study.resource.dashboard_updated", { resourceId: resource.id, publicId: resource.publicId });
  return updated;
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
  const contentType = safeMime(response.headers.get("content-type")) || safeMime(resource.mimeType) || "application/octet-stream";
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
    ...resources.map((resource) => ({ id: resource.id, publicId: resource.publicId, kind: resource.kind.toLowerCase(), title: resource.title, excerpt: excerpt(resource.body || resource.caption || resource.ocrText || resource.url), module: resource.module, updatedAt: resource.updatedAt })),
    ...mistakes.map((mistake) => ({ id: mistake.id, publicId: mistake.publicId, kind: "mistake" as const, title: mistake.source, excerpt: excerpt(`${mistake.cause} ${mistake.prevention}`), module: mistake.module, updatedAt: mistake.updatedAt })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, input.limit);
}

export async function startDashboardStudySession(workspace: StudyWorkspace, input: z.infer<typeof studySessionStartSchema>) {
  return startStudySession(workspace, input.moduleId, input.method, input.itemId);
}

export async function stopDashboardStudySession(workspace: StudyWorkspace, input: z.infer<typeof studySessionStopSchema>) {
  return stopStudySession(workspace, input);
}

export async function updateDashboardStudySession(workspace: StudyWorkspace, sessionId: string, input: z.infer<typeof studySessionResultSchema>) {
  return updateStudySessionResult(workspace, sessionId, input);
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

export async function createDashboardStudyScheduleBlock(workspace: StudyWorkspace, input: z.infer<typeof studyScheduleCreateSchema>) {
  const block = await addStudyScheduleBlock(workspace, input);
  if (!input.destination) return block;
  return configureStudyScheduleTravel(workspace, block.id, {
    destination: input.destination,
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
    return configureStudyScheduleTravel(workspace, blockId, {
      destination: input.destination,
      originReference: input.defaultOriginId,
      travelBufferMinutes: input.travelBufferMinutes,
    });
  }
  return prisma.studyScheduleBlock.findFirstOrThrow({ where: { id: blockId, workspaceId: workspace.id, active: true } });
}

export async function archiveDashboardStudyScheduleBlock(workspace: StudyWorkspace, blockId: string) {
  return archiveStudyScheduleBlock(workspace, blockId);
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

function studyResourcePreview<T extends { body: string | null; ocrText: string | null; caption: string | null }>(resource: T) {
  return {
    ...resource,
    body: excerpt(resource.body, 700),
    ocrText: excerpt(resource.ocrText, 700),
    caption: excerpt(resource.caption, 700),
    hasMoreBody: Boolean(resource.body && resource.body.length > 700),
    hasMoreOcr: Boolean(resource.ocrText && resource.ocrText.length > 700),
  };
}

function resourceSearchWhere(query: string): Prisma.StudyResourceWhereInput[] {
  return [
    { title: { contains: query, mode: "insensitive" } },
    { body: { contains: query, mode: "insensitive" } },
    { caption: { contains: query, mode: "insensitive" } },
    { ocrText: { contains: query, mode: "insensitive" } },
    { fileName: { contains: query, mode: "insensitive" } },
    { url: { contains: query, mode: "insensitive" } },
    { tags: { has: query.toLowerCase().replace(/^#/, "") } },
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
