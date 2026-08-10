import {
  Prisma,
  StudyItemStatus,
  StudyItemType,
  StudyMistakeCategory,
  StudyMistakeStatus,
  StudyPriority,
  StudyTrafficLight,
  type StudyModule,
  type StudyWorkspace,
} from "@prisma/client";
import type { Context } from "grammy";
import { DateTime } from "luxon";
import { privateStudyConfig } from "../config/env";
import { prisma } from "../db/prisma";
import { normalizeClock } from "../utils/clock";

const DEFAULT_MODULES = [
  { code: "CS2100", name: "Computer Organisation", color: "#2C7A7B" },
  { code: "CS2102", name: "Database Systems", color: "#5A67D8" },
  { code: "CS2103T", name: "Software Engineering", color: "#B7791F", workloadGroup: "CS2103T_CS2101" },
  { code: "CS2101", name: "Effective Communication for Computing Professionals", color: "#C05621", workloadGroup: "CS2103T_CS2101" },
  { code: "IT2900", name: "Technical Management and Leadership", color: "#805AD5" },
  { code: "CFG1004", name: "Career Catalyst", color: "#4A5568" },
] as const;

export const STUDY_METHODS: Record<string, string[]> = {
  CS2100: ["Trace examples", "Number-system practice", "MIPS translation/tracing", "Datapath/control tracing", "Logic/circuit problems", "Timed mixed problems"],
  CS2102: ["SQL exercises", "Relational algebra", "Schema/design reasoning", "Query debugging", "Timed mixed problems"],
  CS2103T: ["Implementation", "Codebase exploration", "Testing", "Review", "Team coordination", "Documentation"],
  CS2101: ["Drafting", "Rubric review", "Rehearsal", "Peer feedback", "Revision"],
  IT2900: ["Reading", "Reflection", "Presentation/discussion preparation"],
  CFG1004: ["Bounded completion session"],
};

export class StudyModeError extends Error {
  constructor(
    message: string,
    public readonly code: "disabled" | "forbidden" | "not_bound" | "not_found" | "invalid" | "conflict",
  ) {
    super(message);
    this.name = "StudyModeError";
  }
}

export type StudyScope = {
  ownerTelegramId: string;
  chatId: string;
};

export function isStudyScopeAuthorized(
  config: { ownerTelegramId: string; allowedChatId: string } | undefined,
  actorTelegramId: string | undefined,
  chatId: string | undefined,
  chatType: string | undefined,
): boolean {
  return Boolean(
    config
    && actorTelegramId === config.ownerTelegramId
    && chatId === config.allowedChatId
    && (chatType === "group" || chatType === "supergroup"),
  );
}

export type StudyDashboardModule = {
  id: string;
  code: string;
  name: string;
  status: StudyTrafficLight;
  open: number;
  overdue: number;
  unprocessed: number;
  plannedMinutes: number;
  actualMinutes: number;
  nearestDeadline?: Date;
  mistakesDue: number;
  timedPracticeMissing: boolean;
  consecutiveRed: boolean;
};

export type StudyDashboard = {
  workspace: StudyWorkspace;
  weekNumber: number;
  week?: { id: string; number: number; reviewCompleted: boolean; topPriorities: string[] };
  modules: StudyDashboardModule[];
  overallStatus: StudyTrafficLight;
  amberWarning: boolean;
  redWarning: boolean;
  topPriorities: string[];
  nextBlock?: { label: string; moduleCode?: string; startsAt: Date };
  openSession?: {
    id: string;
    moduleCode: string;
    method: string;
    startedAt: Date;
    item?: { id: string; publicId: string; title: string };
  };
};

export function studyScopeFromContext(ctx: Context): StudyScope {
  const config = privateStudyConfig();
  if (!config) throw new StudyModeError("Study Mode is not configured on this deployment.", "disabled");
  if (!isStudyScopeAuthorized(
    config,
    ctx.from ? String(ctx.from.id) : undefined,
    ctx.chat ? String(ctx.chat.id) : undefined,
    ctx.chat?.type,
  )) {
    throw new StudyModeError("Study Mode only works in its configured private group.", "forbidden");
  }
  return { ownerTelegramId: config.ownerTelegramId, chatId: config.allowedChatId };
}

export function isStudyContext(ctx: Context): boolean {
  try {
    studyScopeFromContext(ctx);
    return true;
  } catch {
    return false;
  }
}

/**
 * The configured Study group is a sealed, single-purpose workspace. Every
 * update from its configured owner belongs to Study Mode, including ordinary
 * text, media, locations, reply-keyboard controls, and callback queries.
 */
export async function shouldHandleStudyUpdate(ctx: Context): Promise<boolean> {
  return isStudyContext(ctx);
}

export async function bindStudyWorkspace(ctx: Context): Promise<StudyWorkspace> {
  const scope = studyScopeFromContext(ctx);
  const from = ctx.from!;
  const owner = await prisma.user.upsert({
    where: { telegramId: scope.ownerTelegramId },
    update: { username: from.username, firstName: from.first_name, lastName: from.last_name },
    create: {
      telegramId: scope.ownerTelegramId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      settings: {
        create: {
          timezone: "Asia/Singapore",
          reminderChatId: scope.ownerTelegramId,
          expenseCurrency: "SGD",
          ocrLanguages: "eng",
        },
      },
    },
  });
  const workspace = await prisma.studyWorkspace.upsert({
    where: { ownerTelegramId: scope.ownerTelegramId },
    update: { boundChatId: scope.chatId, active: true },
    create: {
      ownerUserId: owner.id,
      ownerTelegramId: scope.ownerTelegramId,
      boundChatId: scope.chatId,
      active: true,
    },
  });
  await seedDefaultStudyModules(workspace.id);
  await auditStudy(owner.id, "study.workspace.bound", { workspaceId: workspace.id, chatId: scope.chatId });
  return workspace;
}

export async function unbindStudyWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.studyWorkspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new StudyModeError("Study workspace not found.", "not_found");
  await prisma.$transaction([
    prisma.studyConversation.deleteMany({ where: { workspaceId } }),
    prisma.studyWorkspace.update({ where: { id: workspaceId }, data: { active: false, boundChatId: null } }),
    prisma.auditLog.create({ data: { userId: workspace.ownerUserId, action: "study.workspace.unbound", metadata: { workspaceId } } }),
  ]);
}

export async function requireStudyWorkspace(ctx: Context): Promise<StudyWorkspace> {
  const scope = studyScopeFromContext(ctx);
  const workspace = await prisma.studyWorkspace.findUnique({ where: { ownerTelegramId: scope.ownerTelegramId } });
  if (!workspace?.active || workspace.boundChatId !== scope.chatId) {
    throw new StudyModeError("Study Mode is not bound here yet. Run /study bind.", "not_bound");
  }
  return workspace;
}

export async function beginStudyConversation(
  workspaceId: string,
  kind: string,
  step: string,
  payload: Prisma.InputJsonObject = {},
  ttlMinutes = 60,
) {
  return prisma.studyConversation.upsert({
    where: { workspaceId },
    update: { kind, step, payload, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    create: { workspaceId, kind, step, payload, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
}

export async function getStudyConversation(workspaceId: string) {
  const conversation = await prisma.studyConversation.findUnique({ where: { workspaceId } });
  if (!conversation) return undefined;
  if (conversation.expiresAt <= new Date()) {
    await prisma.studyConversation.delete({ where: { workspaceId } });
    return undefined;
  }
  return conversation;
}

export async function advanceStudyConversation(
  workspaceId: string,
  step: string,
  payload: Prisma.InputJsonObject,
  ttlMinutes = 60,
) {
  return prisma.studyConversation.update({
    where: { workspaceId },
    data: { step, payload, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
}

export async function clearStudyConversation(workspaceId: string): Promise<void> {
  await prisma.studyConversation.deleteMany({ where: { workspaceId } });
}

export function studyConversationPayload(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function activeStudyWorkspace(): Promise<StudyWorkspace | undefined> {
  const config = privateStudyConfig();
  if (!config) return undefined;
  return (await prisma.studyWorkspace.findFirst({
    where: { ownerTelegramId: config.ownerTelegramId, boundChatId: config.allowedChatId, active: true },
  })) ?? undefined;
}

export async function configureStudyWorkspace(
  workspaceId: string,
  input: { semesterName: string; semesterStartDate: Date; timezone: string },
): Promise<StudyWorkspace> {
  validateMonday(input.semesterStartDate, input.timezone);
  if (!DateTime.now().setZone(input.timezone).isValid) throw new StudyModeError("Use a valid IANA timezone.", "invalid");
  const workspace = await prisma.studyWorkspace.update({
    where: { id: workspaceId },
    data: {
      semesterName: input.semesterName.trim().slice(0, 120),
      semesterStartDate: input.semesterStartDate,
      timezone: input.timezone,
    },
  });
  await seedDefaultStudySchedule(workspaceId);
  await auditStudy(workspace.ownerUserId, "study.workspace.configured", {
    workspaceId,
    semesterName: workspace.semesterName,
    semesterStartDate: workspace.semesterStartDate?.toISOString(),
    timezone: workspace.timezone,
  });
  return workspace;
}

export function academicWeekNumber(workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">, now = new Date()): number {
  if (!workspace.semesterStartDate) return 0;
  const start = DateTime.fromJSDate(workspace.semesterStartDate).setZone(workspace.timezone).startOf("day");
  const current = DateTime.fromJSDate(now).setZone(workspace.timezone).startOf("day");
  if (current < start) return 0;
  return Math.floor(current.diff(start, "days").days / 7) + 1;
}

export function academicWeekRange(
  workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">,
  weekNumber: number,
): { start: Date; end: Date } {
  if (!workspace.semesterStartDate || weekNumber < 1) throw new StudyModeError("Run /study setup first.", "invalid");
  const start = DateTime.fromJSDate(workspace.semesterStartDate).setZone(workspace.timezone).startOf("day").plus({ weeks: weekNumber - 1 });
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 6 }).endOf("day").toUTC().toJSDate() };
}

export async function ensureStudyWeek(workspace: StudyWorkspace, weekNumber = academicWeekNumber(workspace)): Promise<Prisma.StudyWeekGetPayload<object>> {
  if (weekNumber < 1) throw new StudyModeError("The semester has not started. Use /study setup to check the starting Monday.", "invalid");
  const range = academicWeekRange(workspace, weekNumber);
  return prisma.studyWeek.upsert({
    where: { workspaceId_number: { workspaceId: workspace.id, number: weekNumber } },
    update: { startDate: range.start, endDate: range.end },
    create: { workspaceId: workspace.id, number: weekNumber, startDate: range.start, endDate: range.end, topPriorities: [] },
  });
}

export async function listStudyModules(workspaceId: string, includeArchived = false): Promise<StudyModule[]> {
  return prisma.studyModule.findMany({
    where: { workspaceId, ...(includeArchived ? {} : { active: true }) },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}

export async function findStudyModule(workspaceId: string, reference: string): Promise<StudyModule> {
  const module = await prisma.studyModule.findFirst({
    where: {
      workspaceId,
      OR: [
        { code: reference.trim().toUpperCase() },
        ...(isUuid(reference) ? [{ id: reference }] : []),
      ],
    },
  });
  if (!module) throw new StudyModeError("I couldn't find that module.", "not_found");
  return module;
}

export async function addStudyModule(
  workspace: StudyWorkspace,
  code: string,
  name: string,
  options: { color?: string | null; workloadGroup?: string | null } = {},
): Promise<StudyModule> {
  const normalizedCode = normalizeModuleCode(code);
  if (!name.trim()) throw new StudyModeError("Give the module a name.", "invalid");
  const displayOrder = await prisma.studyModule.count({ where: { workspaceId: workspace.id } });
  try {
    const module = await prisma.studyModule.create({
      data: {
        workspaceId: workspace.id,
        code: normalizedCode,
        name: name.trim().slice(0, 160),
        displayOrder,
        ...(options.color !== undefined ? { color: options.color } : {}),
        ...(options.workloadGroup !== undefined ? { workloadGroup: options.workloadGroup } : {}),
      },
    });
    await auditStudy(workspace.ownerUserId, "study.module.created", { workspaceId: workspace.id, moduleId: module.id, code: module.code });
    return module;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StudyModeError(`${normalizedCode} already exists.`, "conflict");
    }
    throw error;
  }
}

export async function updateStudyModule(
  workspace: StudyWorkspace,
  moduleId: string,
  input: { code?: string; name?: string; active?: boolean },
): Promise<StudyModule> {
  await requireModule(workspace.id, moduleId);
  const module = await prisma.studyModule.update({
    where: { id: moduleId },
    data: {
      ...(input.code ? { code: normalizeModuleCode(input.code) } : {}),
      ...(input.name ? { name: input.name.trim().slice(0, 160) } : {}),
      ...(input.active !== undefined ? {
        active: input.active,
        userArchivedAt: input.active ? null : new Date(),
      } : {}),
    },
  });
  await auditStudy(workspace.ownerUserId, "study.module.updated", { workspaceId: workspace.id, moduleId, code: module.code, active: module.active });
  return module;
}

export async function createStudyItem(
  workspace: StudyWorkspace,
  input: {
    moduleId: string;
    type: StudyItemType;
    title: string;
    notes?: string;
    priority?: StudyPriority;
    dueAt?: Date;
    plannedMinutes?: number;
    weekNumber?: number;
  },
) {
  await requireModule(workspace.id, input.moduleId);
  const title = input.title.trim();
  if (!title) throw new StudyModeError("Give the study item a title.", "invalid");
  if (input.plannedMinutes !== undefined && (!Number.isInteger(input.plannedMinutes) || input.plannedMinutes < 1 || input.plannedMinutes > 24 * 60)) {
    throw new StudyModeError("Planned time must be between 1 and 1,440 minutes.", "invalid");
  }
  const weekNumber = input.weekNumber ?? academicWeekNumber(workspace);
  const week = weekNumber > 0 ? await ensureStudyWeek(workspace, weekNumber) : undefined;
  const publicId = await nextStudyPublicId(workspace.id, "STUDY");
  const item = await prisma.studyItem.create({
    data: {
      workspaceId: workspace.id,
      moduleId: input.moduleId,
      weekId: week?.id,
      publicId,
      type: input.type,
      title: title.slice(0, 500),
      notes: input.notes?.trim().slice(0, 8_000),
      priority: input.priority ?? StudyPriority.NORMAL,
      dueAt: input.dueAt,
      plannedMinutes: input.plannedMinutes,
    },
    include: { module: true },
  });
  await auditStudy(workspace.ownerUserId, "study.item.created", { workspaceId: workspace.id, itemId: item.id, publicId, module: item.module.code, type: item.type });
  return item;
}

export async function findStudyItem(workspaceId: string, reference: string) {
  const normalized = normalizeStudyReference(reference, "STUDY");
  const item = await prisma.studyItem.findFirst({
    where: { workspaceId, OR: [{ publicId: normalized }, ...(isUuid(reference) ? [{ id: reference }] : [])] },
    include: { module: true, week: true, canvasAssignment: true },
  });
  if (!item) throw new StudyModeError(`I couldn't find ${normalized}.`, "not_found");
  return item;
}

export async function completeStudyItem(workspace: StudyWorkspace, reference: string, processed = false) {
  const item = await findStudyItem(workspace.id, reference);
  const now = new Date();
  const updated = await prisma.studyItem.update({
    where: { id: item.id },
    data: processed
      ? { status: StudyItemStatus.PROCESSED, processedAt: now }
      : { status: StudyItemStatus.DONE, completedAt: now },
    include: { module: true },
  });
  await auditStudy(workspace.ownerUserId, processed ? "study.item.processed" : "study.item.completed", {
    workspaceId: workspace.id,
    itemId: item.id,
    publicId: item.publicId,
  });
  return updated;
}

export async function rescheduleStudyItem(workspace: StudyWorkspace, reference: string, dueAt: Date) {
  if (!Number.isFinite(dueAt.getTime())) throw new StudyModeError("Choose a valid due date.", "invalid");
  const item = await findStudyItem(workspace.id, reference);
  const weekNumber = academicWeekNumber(workspace, dueAt);
  const week = weekNumber > 0 ? await ensureStudyWeek(workspace, weekNumber) : undefined;
  const updated = await prisma.studyItem.update({
    where: { id: item.id },
    data: {
      dueAt,
      dueAtOverridden: true,
      weekId: week?.id,
    },
    include: { module: true },
  });
  await auditStudy(workspace.ownerUserId, "study.item.rescheduled", {
    workspaceId: workspace.id,
    itemId: item.id,
    publicId: item.publicId,
    dueAt: dueAt.toISOString(),
  });
  return updated;
}

export async function updateStudyMastery(
  workspace: StudyWorkspace,
  reference: string,
  mastery: StudyTrafficLight,
  reason?: string,
) {
  const module = await prisma.studyModule.findFirst({
    where: { workspaceId: workspace.id, code: reference.trim().toUpperCase(), active: true },
  });
  if (module) {
    const updated = await prisma.studyModule.update({
      where: { id: module.id },
      data: {
        currentMastery: mastery,
        masteryReason: reason?.trim().slice(0, 1_000),
        redSince: mastery === StudyTrafficLight.RED ? module.redSince ?? new Date() : null,
        ...(mastery !== StudyTrafficLight.RED ? { lastRedWarningAt: null } : {}),
      },
    });
    await auditStudy(workspace.ownerUserId, "study.module.mastery", { workspaceId: workspace.id, moduleId: module.id, mastery, reason });
    return { kind: "module" as const, value: updated };
  }
  const item = await findStudyItem(workspace.id, reference);
  const updated = await prisma.studyItem.update({
    where: { id: item.id },
    data: { mastery, masteryReason: reason?.trim().slice(0, 1_000) },
  });
  await auditStudy(workspace.ownerUserId, "study.item.mastery", { workspaceId: workspace.id, itemId: item.id, mastery, reason });
  return { kind: "item" as const, value: updated };
}

export async function startStudySession(workspace: StudyWorkspace, moduleId: string, method: string, itemId?: string) {
  await requireModule(workspace.id, moduleId);
  const open = await prisma.studySession.findFirst({ where: { workspaceId: workspace.id, endedAt: null } });
  if (open) throw new StudyModeError("A study session is already running. Use /study stop first.", "conflict");
  if (itemId) {
    const item = await prisma.studyItem.findFirst({ where: { id: itemId, workspaceId: workspace.id, moduleId } });
    if (!item) throw new StudyModeError("That study item does not belong to this module.", "forbidden");
  }
  const session = await prisma.studySession.create({
    data: {
      workspaceId: workspace.id,
      moduleId,
      itemId,
      startedAt: new Date(),
      method: method.trim().slice(0, 160) || "Focused study",
      topicsMixed: [],
      timed: /timed/i.test(method),
    },
    include: { module: true, item: true },
  });
  await auditStudy(workspace.ownerUserId, "study.session.started", { workspaceId: workspace.id, sessionId: session.id, module: session.module.code, method: session.method });
  return session;
}

export async function stopStudySession(
  workspace: StudyWorkspace,
  input: { result?: string; topicsMixed?: string[]; attemptedScore?: number; maximumScore?: number; usedNotes?: boolean },
) {
  const session = await prisma.studySession.findFirst({
    where: { workspaceId: workspace.id, endedAt: null },
    orderBy: { startedAt: "desc" },
    include: { module: true, item: true },
  });
  if (!session) throw new StudyModeError("No study session is running.", "not_found");
  const endedAt = new Date();
  const durationMinutes = Math.max(1, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60_000));
  const updated = await prisma.$transaction(async (tx) => {
    const stopped = await tx.studySession.update({
      where: { id: session.id },
      data: {
        endedAt,
        durationMinutes,
        result: input.result?.trim().slice(0, 2_000),
        topicsMixed: input.topicsMixed ?? [],
        attemptedScore: input.attemptedScore,
        maximumScore: input.maximumScore,
        usedNotes: input.usedNotes,
      },
      include: { module: true, item: true },
    });
    if (session.itemId) {
      await tx.studyItem.update({ where: { id: session.itemId }, data: { actualMinutes: { increment: durationMinutes } } });
    }
    await tx.auditLog.create({
      data: { userId: workspace.ownerUserId, action: "study.session.stopped", metadata: { workspaceId: workspace.id, sessionId: session.id, durationMinutes } },
    });
    return stopped;
  });
  return updated;
}

export async function updateStudySessionResult(
  workspace: StudyWorkspace,
  sessionId: string,
  input: { result?: string; topicsMixed?: string[]; attemptedScore?: number; maximumScore?: number; usedNotes?: boolean },
) {
  const session = await prisma.studySession.findFirst({ where: { id: sessionId, workspaceId: workspace.id, endedAt: { not: null } } });
  if (!session) throw new StudyModeError("That completed session could not be found.", "not_found");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.studySession.update({
      where: { id: session.id },
      data: {
        result: input.result?.trim().slice(0, 2_000),
        topicsMixed: input.topicsMixed ?? session.topicsMixed,
        attemptedScore: input.attemptedScore,
        maximumScore: input.maximumScore,
        usedNotes: input.usedNotes,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: workspace.ownerUserId,
        action: "study.session.dashboard_updated",
        metadata: { workspaceId: workspace.id, sessionId: session.id },
      },
    });
    return updated;
  });
}

export async function recordStudyMistake(
  workspace: StudyWorkspace,
  input: {
    moduleId: string;
    itemId?: string;
    source: string;
    category: StudyMistakeCategory;
    cause: string;
    prevention: string;
    revisitAt?: Date;
  },
) {
  await requireModule(workspace.id, input.moduleId);
  if (input.itemId) {
    const item = await prisma.studyItem.findFirst({ where: { id: input.itemId, workspaceId: workspace.id, moduleId: input.moduleId } });
    if (!item) throw new StudyModeError("That study item does not belong to this module.", "forbidden");
  }
  const publicId = await nextStudyPublicId(workspace.id, "MISTAKE");
  const mistake = await prisma.studyMistake.create({
    data: {
      workspaceId: workspace.id,
      moduleId: input.moduleId,
      itemId: input.itemId,
      publicId,
      source: requiredText(input.source, "Describe the source or question.", 2_000),
      category: input.category,
      cause: requiredText(input.cause, "Describe what caused the mistake.", 2_000),
      prevention: requiredText(input.prevention, "Record a preventive check or correction.", 2_000),
      firstAttemptAt: new Date(),
      revisitAt: input.revisitAt,
    },
    include: { module: true },
  });
  await auditStudy(workspace.ownerUserId, "study.mistake.created", { workspaceId: workspace.id, mistakeId: mistake.id, publicId, module: mistake.module.code, category: mistake.category });
  return mistake;
}

export async function listStudyMistakes(workspaceId: string, now = new Date()) {
  await prisma.studyMistake.updateMany({
    where: { workspaceId, module: { active: true }, status: StudyMistakeStatus.OPEN, revisitAt: { lte: now } },
    data: { status: StudyMistakeStatus.REATTEMPT_DUE },
  });
  return prisma.studyMistake.findMany({
    where: { workspaceId, module: { active: true }, status: { in: [StudyMistakeStatus.OPEN, StudyMistakeStatus.REATTEMPT_DUE] } },
    include: { module: true, item: true },
    orderBy: [{ revisitAt: "asc" }, { createdAt: "desc" }],
  });
}

export async function resolveStudyMistake(workspace: StudyWorkspace, reference: string) {
  const normalized = normalizeStudyReference(reference, "MISTAKE");
  const mistake = await prisma.studyMistake.findFirst({
    where: {
      workspaceId: workspace.id,
      OR: [{ id: reference }, { publicId: normalized }],
    },
  });
  if (!mistake) throw new StudyModeError(`I couldn't find ${normalized}.`, "not_found");
  const updated = await prisma.studyMistake.update({ where: { id: mistake.id }, data: { status: StudyMistakeStatus.RESOLVED, resolvedAt: new Date() } });
  await auditStudy(workspace.ownerUserId, "study.mistake.resolved", { workspaceId: workspace.id, mistakeId: mistake.id, publicId: mistake.publicId });
  return updated;
}

export async function updateWeeklyPlan(workspace: StudyWorkspace, priorities: string[], overloadNotes?: string) {
  const week = await ensureStudyWeek(workspace);
  const clean = priorities.map((value) => value.trim()).filter(Boolean).slice(0, 3);
  const updated = await prisma.studyWeek.update({
    where: { id: week.id },
    data: { topPriorities: clean, overloadNotes: overloadNotes?.trim().slice(0, 2_000) },
  });
  await auditStudy(workspace.ownerUserId, "study.week.planned", { workspaceId: workspace.id, week: week.number, priorities: clean });
  return updated;
}

export async function saveWeeklyReview(
  workspace: StudyWorkspace,
  input: {
    moduleStatuses: Array<{ moduleId: string; code: string; status: StudyTrafficLight; unclear?: string; unfinished?: string; practice?: string; mistakes?: string; nextAction?: string }>;
    wins: string[];
    unresolvedTopics: string[];
    nextWeekPriorities: string[];
    lostTimeCauses: string[];
    overloadNotes?: string;
    workloadCompatible?: boolean;
    protectedOverflowBlock?: string;
  },
) {
  const week = await ensureStudyWeek(workspace);
  const modules = await listStudyModules(workspace.id);
  const validIds = new Set(modules.map((module) => module.id));
  if (input.moduleStatuses.some((entry) => !validIds.has(entry.moduleId))) {
    throw new StudyModeError("A review answer belongs to another workspace.", "forbidden");
  }
  const overallStatus = deriveOverallStatus(input.moduleStatuses.map((entry) => entry.status));
  const now = new Date();
  const review = await prisma.$transaction(async (tx) => {
    for (const entry of input.moduleStatuses) {
      const current = modules.find((module) => module.id === entry.moduleId)!;
      await tx.studyModule.update({
        where: { id: entry.moduleId },
        data: {
          currentMastery: entry.status,
          masteryReason: entry.unclear?.slice(0, 1_000),
          redSince: entry.status === StudyTrafficLight.RED ? current.redSince ?? now : null,
          ...(entry.status !== StudyTrafficLight.RED ? { lastRedWarningAt: null } : {}),
        },
      });
    }
    const saved = await tx.weeklyReview.upsert({
      where: { weekId: week.id },
      update: {
        moduleStatuses: input.moduleStatuses as unknown as Prisma.InputJsonValue,
        wins: input.wins,
        unresolvedTopics: input.unresolvedTopics,
        nextWeekPriorities: input.nextWeekPriorities.slice(0, 3),
        lostTimeCauses: input.lostTimeCauses,
        overloadNotes: input.overloadNotes,
        workloadCompatible: input.workloadCompatible,
        protectedOverflowBlock: input.protectedOverflowBlock,
        summary: buildWeeklyReviewSummary(input),
        completedAt: now,
      },
      create: {
        workspaceId: workspace.id,
        weekId: week.id,
        moduleStatuses: input.moduleStatuses as unknown as Prisma.InputJsonValue,
        wins: input.wins,
        unresolvedTopics: input.unresolvedTopics,
        nextWeekPriorities: input.nextWeekPriorities.slice(0, 3),
        lostTimeCauses: input.lostTimeCauses,
        overloadNotes: input.overloadNotes,
        workloadCompatible: input.workloadCompatible,
        protectedOverflowBlock: input.protectedOverflowBlock,
        summary: buildWeeklyReviewSummary(input),
        completedAt: now,
      },
    });
    await tx.studyWeek.update({
      where: { id: week.id },
      data: { reviewCompleted: true, overallStatus, reflection: buildWeeklyReviewSummary(input) },
    });
    await tx.auditLog.create({ data: { userId: workspace.ownerUserId, action: "study.week.reviewed", metadata: { workspaceId: workspace.id, week: week.number, overallStatus } } });
    return saved;
  });
  return review;
}

export async function buildStudyDashboard(workspace: StudyWorkspace, now = new Date()): Promise<StudyDashboard> {
  const weekNumber = academicWeekNumber(workspace, now);
  const week = weekNumber > 0 ? await ensureStudyWeek(workspace, weekNumber) : undefined;
  const modules = await listStudyModules(workspace.id);
  const weekRange = weekNumber > 0 ? academicWeekRange(workspace, weekNumber) : undefined;
  const [items, sessions, mistakes, blocks, recentReviews, openSession] = await Promise.all([
    prisma.studyItem.findMany({
      where: {
        workspaceId: workspace.id,
        module: { active: true },
        OR: [
          { status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS] } },
          ...(week ? [{ weekId: week.id }] : []),
        ],
      },
      include: { week: true },
    }),
    weekRange ? prisma.studySession.findMany({ where: { workspaceId: workspace.id, module: { active: true }, startedAt: { gte: weekRange.start, lte: weekRange.end }, endedAt: { not: null } } }) : Promise.resolve([]),
    listStudyMistakes(workspace.id, now),
    prisma.studyScheduleBlock.findMany({ where: { workspaceId: workspace.id, active: true, OR: [{ moduleId: null }, { module: { active: true } }] }, include: { module: true } }),
    prisma.weeklyReview.findMany({ where: { workspaceId: workspace.id }, orderBy: { completedAt: "desc" }, take: 2 }),
    prisma.studySession.findFirst({
      where: { workspaceId: workspace.id, module: { active: true }, endedAt: null },
      include: { module: true, item: { select: { id: true, publicId: true, title: true } } },
    }),
  ]);
  const dashboardModules: StudyDashboardModule[] = modules.map((module) => {
    const moduleItems = items.filter((item) => item.moduleId === module.id);
    const openItems = moduleItems.filter((item) => item.status === StudyItemStatus.OPEN || item.status === StudyItemStatus.IN_PROGRESS);
    const moduleSessions = sessions.filter((session) => session.moduleId === module.id);
    const moduleMistakes = mistakes.filter((mistake) => mistake.moduleId === module.id && mistake.revisitAt && mistake.revisitAt <= now);
    const status = deriveModuleBacklogStatus(module, openItems, weekNumber, now);
    return {
      id: module.id,
      code: module.code,
      name: module.name,
      status,
      open: openItems.length,
      overdue: openItems.filter((item) => item.dueAt && item.dueAt < now).length,
      unprocessed: openItems.filter((item) => (
        item.type === StudyItemType.LECTURE
        || item.type === StudyItemType.TUTORIAL
        || item.type === StudyItemType.LAB
      )).length,
      plannedMinutes: moduleItems.filter((item) => item.weekId === week?.id).reduce((sum, item) => sum + (item.plannedMinutes ?? 0), 0),
      actualMinutes: moduleSessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0),
      nearestDeadline: openItems.map((item) => item.dueAt).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime())[0],
      mistakesDue: moduleMistakes.length,
      timedPracticeMissing: isTimedPracticeMissing(
        module.code,
        weekNumber,
        workspace.timedPracticeStartWeek,
        moduleSessions,
      ),
      consecutiveRed: hasConsecutiveRedReviews(recentReviews, module.code),
    };
  });
  const amberCount = dashboardModules.filter((module) => module.status === StudyTrafficLight.AMBER).length;
  const redWarning = dashboardModules.some((module) => module.status === StudyTrafficLight.RED || module.consecutiveRed);
  return {
    workspace,
    weekNumber,
    week: week ? { id: week.id, number: week.number, reviewCompleted: week.reviewCompleted, topPriorities: week.topPriorities } : undefined,
    modules: dashboardModules,
    overallStatus: deriveOverallStatus(dashboardModules.map((module) => module.status)),
    amberWarning: amberCount > 2,
    redWarning,
    topPriorities: week?.topPriorities ?? [],
    nextBlock: findNextScheduleBlock(workspace, blocks, weekNumber, now),
    openSession: openSession ? {
      id: openSession.id,
      moduleCode: openSession.module.code,
      method: openSession.method,
      startedAt: openSession.startedAt,
      item: openSession.item ?? undefined,
    } : undefined,
  };
}

export async function upcomingStudyItems(workspaceId: string, now = new Date()) {
  return prisma.studyItem.findMany({
    where: { workspaceId, module: { active: true }, status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS] } },
    include: { module: true },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
}

export async function listStudyScheduleBlocks(workspaceId: string) {
  return prisma.studyScheduleBlock.findMany({
    where: { workspaceId, active: true, OR: [{ moduleId: null }, { module: { active: true } }] },
    include: { module: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}

export async function addStudyScheduleBlock(
  workspace: StudyWorkspace,
  input: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    label: string;
    moduleId?: string | null;
    blockType?: string;
    startWeek?: number | null;
    endWeek?: number | null;
    venueId?: string;
    venueName?: string;
    destinationStopId?: string;
    defaultOriginId?: string | null;
    travelBufferMinutes?: number;
    reminderLeadMinutes?: number;
  },
) {
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) throw new StudyModeError("Day must be Monday through Sunday.", "invalid");
  const startTime = normalizeClock(input.startTime);
  const endTime = normalizeClock(input.endTime);
  if (!startTime || !endTime || startTime >= endTime) {
    throw new StudyModeError("Use a valid time range such as 14:00-16:00.", "invalid");
  }
  if (input.moduleId) await requireModule(workspace.id, input.moduleId);
  if (input.defaultOriginId) {
    const origin = await prisma.studyLocationOrigin.findFirst({ where: { id: input.defaultOriginId, workspaceId: workspace.id, active: true } });
    if (!origin) throw new StudyModeError("That travel origin was not found.", "not_found");
  }
  const block = await prisma.studyScheduleBlock.create({
    data: {
      workspaceId: workspace.id,
      moduleId: input.moduleId,
      dayOfWeek: input.dayOfWeek,
      startTime,
      endTime,
      label: requiredText(input.label, "Give the block a label.", 200),
      blockType: input.blockType ?? "study",
      startWeek: input.startWeek,
      endWeek: input.endWeek,
      venueId: input.venueId,
      venueName: input.venueName,
      destinationStopId: input.destinationStopId,
      defaultOriginId: input.defaultOriginId,
      travelBufferMinutes: input.travelBufferMinutes,
      reminderLeadMinutes: input.reminderLeadMinutes,
    },
  });
  await auditStudy(workspace.ownerUserId, "study.schedule.created", { workspaceId: workspace.id, blockId: block.id, label: block.label });
  return block;
}

export async function updateStudyScheduleBlock(
  workspace: StudyWorkspace,
  blockId: string,
  input: {
    moduleId?: string | null;
    dayOfWeek?: number;
    startTime?: string;
    endTime?: string;
    label?: string;
    blockType?: string;
    startWeek?: number | null;
    endWeek?: number | null;
    venueId?: string | null;
    venueName?: string | null;
    destinationStopId?: string | null;
    defaultOriginId?: string | null;
    travelBufferMinutes?: number;
    reminderLeadMinutes?: number;
  },
) {
  const block = await prisma.studyScheduleBlock.findFirst({ where: { id: blockId, workspaceId: workspace.id, active: true } });
  if (!block) throw new StudyModeError("That schedule block was not found.", "not_found");
  if (input.dayOfWeek !== undefined && (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7)) {
    throw new StudyModeError("Day must be Monday through Sunday.", "invalid");
  }
  if (input.moduleId) await requireModule(workspace.id, input.moduleId);
  if (input.defaultOriginId) {
    const origin = await prisma.studyLocationOrigin.findFirst({ where: { id: input.defaultOriginId, workspaceId: workspace.id, active: true } });
    if (!origin) throw new StudyModeError("That travel origin was not found.", "not_found");
  }
  const startTime = input.startTime === undefined ? undefined : normalizeClock(input.startTime);
  const endTime = input.endTime === undefined ? undefined : normalizeClock(input.endTime);
  const effectiveStart = startTime ?? block.startTime;
  const effectiveEnd = endTime ?? block.endTime;
  if (!effectiveStart || !effectiveEnd || effectiveStart >= effectiveEnd) {
    throw new StudyModeError("Use a valid time range such as 14:00-16:00.", "invalid");
  }
  const effectiveStartWeek = input.startWeek === undefined ? block.startWeek : input.startWeek;
  const effectiveEndWeek = input.endWeek === undefined ? block.endWeek : input.endWeek;
  if (effectiveStartWeek && effectiveEndWeek && effectiveEndWeek < effectiveStartWeek) {
    throw new StudyModeError("The final teaching week cannot be before the first week.", "invalid");
  }
  const travelBufferMinutes = input.travelBufferMinutes === undefined
    ? undefined
    : Math.min(90, Math.max(0, Math.round(input.travelBufferMinutes)));
  const reminderLeadMinutes = input.reminderLeadMinutes === undefined
    ? undefined
    : Math.min(120, Math.max(0, Math.round(input.reminderLeadMinutes)));
  const updated = await prisma.studyScheduleBlock.update({
    where: { id: block.id },
    data: {
      moduleId: input.moduleId,
      dayOfWeek: input.dayOfWeek,
      startTime,
      endTime,
      label: input.label === undefined ? undefined : requiredText(input.label, "Give the block a label.", 200),
      blockType: input.blockType,
      startWeek: input.startWeek,
      endWeek: input.endWeek,
      venueId: input.venueId,
      venueName: input.venueName,
      destinationStopId: input.destinationStopId,
      defaultOriginId: input.defaultOriginId,
      travelBufferMinutes,
      reminderLeadMinutes,
    },
  });
  await auditStudy(workspace.ownerUserId, "study.schedule.updated", {
    workspaceId: workspace.id,
    blockId,
    dayOfWeek: updated.dayOfWeek,
    startTime: updated.startTime,
    endTime: updated.endTime,
    label: updated.label,
    destination: updated.venueName,
    defaultOriginId: updated.defaultOriginId,
    travelBufferMinutes: updated.travelBufferMinutes,
  });
  return updated;
}

export async function archiveStudyScheduleBlock(workspace: StudyWorkspace, blockId: string) {
  const block = await prisma.studyScheduleBlock.findFirst({ where: { id: blockId, workspaceId: workspace.id } });
  if (!block) throw new StudyModeError("That schedule block was not found.", "not_found");
  await prisma.studyScheduleBlock.update({ where: { id: block.id }, data: { active: false } });
  await auditStudy(workspace.ownerUserId, "study.schedule.archived", { workspaceId: workspace.id, blockId });
}

export async function createStudyExports(workspace: StudyWorkspace, now = new Date()): Promise<Array<{ fileName: string; content: string }>> {
  const dashboard = await buildStudyDashboard(workspace, now);
  const [items, sessions, mistakes, reviews, modules] = await Promise.all([
    prisma.studyItem.findMany({ where: { workspaceId: workspace.id, module: { active: true } }, include: { module: true, week: true }, orderBy: { createdAt: "asc" } }),
    prisma.studySession.findMany({ where: { workspaceId: workspace.id, module: { active: true } }, include: { module: true, item: true }, orderBy: { startedAt: "asc" } }),
    prisma.studyMistake.findMany({ where: { workspaceId: workspace.id, module: { active: true } }, include: { module: true, item: true }, orderBy: { createdAt: "asc" } }),
    prisma.weeklyReview.findMany({ where: { workspaceId: workspace.id }, include: { week: true }, orderBy: { completedAt: "asc" } }),
    listStudyModules(workspace.id),
  ]);
  return [
    {
      fileName: "threadwise-study-weekly-dashboard.csv",
      content: toCsv(
        ["week", "module", "status", "open_items", "overdue", "unprocessed", "planned_minutes", "actual_minutes", "nearest_deadline", "mistakes_due", "timed_practice_missing", "weekly_review_complete"],
        dashboard.modules.map((module) => [dashboard.weekNumber, module.code, module.status, module.open, module.overdue, module.unprocessed, module.plannedMinutes, module.actualMinutes, iso(module.nearestDeadline), module.mistakesDue, module.timedPracticeMissing, dashboard.week?.reviewCompleted ?? false]),
      ),
    },
    {
      fileName: "threadwise-study-items.csv",
      content: toCsv(
        ["id", "module", "week", "type", "title", "notes", "status", "priority", "due_at", "planned_minutes", "actual_minutes", "mastery", "mastery_reason", "processed_at", "completed_at", "created_at"],
        items.map((item) => [item.publicId, item.module.code, item.week?.number, item.type, item.title, item.notes, item.status, item.priority, iso(item.dueAt), item.plannedMinutes, item.actualMinutes, item.mastery, item.masteryReason, iso(item.processedAt), iso(item.completedAt), iso(item.createdAt)]),
      ),
    },
    {
      fileName: "threadwise-study-sessions.csv",
      content: toCsv(
        ["module", "item_id", "started_at", "ended_at", "duration_minutes", "method", "result", "topics_mixed", "timed", "attempted_score", "maximum_score", "used_notes"],
        sessions.map((session) => [session.module.code, session.item?.publicId, iso(session.startedAt), iso(session.endedAt), session.durationMinutes, session.method, session.result, session.topicsMixed.join(" | "), session.timed, session.attemptedScore, session.maximumScore, session.usedNotes]),
      ),
    },
    {
      fileName: "threadwise-study-mastery.csv",
      content: toCsv(
        ["module", "name", "active", "mastery", "reason", "red_since"],
        modules.map((module) => [module.code, module.name, module.active, module.currentMastery, module.masteryReason, iso(module.redSince)]),
      ),
    },
    {
      fileName: "threadwise-study-mistakes.csv",
      content: toCsv(
        ["id", "module", "item_id", "source", "category", "cause", "prevention", "first_attempt_at", "revisit_at", "status", "resolved_at"],
        mistakes.map((mistake) => [mistake.publicId, mistake.module.code, mistake.item?.publicId, mistake.source, mistake.category, mistake.cause, mistake.prevention, iso(mistake.firstAttemptAt), iso(mistake.revisitAt), mistake.status, iso(mistake.resolvedAt)]),
      ),
    },
    {
      fileName: "threadwise-study-weekly-reviews.csv",
      content: toCsv(
        ["week", "completed_at", "module_statuses", "wins", "unresolved_topics", "next_week_priorities", "lost_time_causes", "workload_compatible", "protected_overflow_block", "overload_notes", "summary"],
        reviews.map((review) => [review.week.number, iso(review.completedAt), JSON.stringify(review.moduleStatuses), review.wins.join(" | "), review.unresolvedTopics.join(" | "), review.nextWeekPriorities.join(" | "), review.lostTimeCauses.join(" | "), review.workloadCompatible, review.protectedOverflowBlock, review.overloadNotes, review.summary]),
      ),
    },
  ];
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function deriveOverallStatus(statuses: StudyTrafficLight[]): StudyTrafficLight {
  if (statuses.includes(StudyTrafficLight.RED)) return StudyTrafficLight.RED;
  if (statuses.includes(StudyTrafficLight.AMBER)) return StudyTrafficLight.AMBER;
  if (statuses.length > 0 && statuses.every((status) => status === StudyTrafficLight.GREEN)) return StudyTrafficLight.GREEN;
  return StudyTrafficLight.UNASSESSED;
}

export function isTimedPracticeMissing(
  moduleCode: string,
  currentWeek: number,
  startWeek: number,
  sessions: Array<{ timed: boolean }>,
): boolean {
  return currentWeek >= startWeek
    && (moduleCode === "CS2100" || moduleCode === "CS2102")
    && !sessions.some((session) => session.timed);
}

export function deriveModuleBacklogStatus(
  module: Pick<StudyModule, "currentMastery">,
  items: Array<{
    status: StudyItemStatus;
    priority: StudyPriority;
    dueAt: Date | null;
    weekId: string | null;
    week?: { number: number } | null;
    mastery: StudyTrafficLight;
  }>,
  currentWeek: number,
  now: Date,
): StudyTrafficLight {
  if (module.currentMastery === StudyTrafficLight.RED) return StudyTrafficLight.RED;
  const important = (priority: StudyPriority) => priority === StudyPriority.HIGH || priority === StudyPriority.CRITICAL;
  const moreThanOneWeekBehind = currentWeek > 1 && items.some((item) => item.week && item.week.number < currentWeek - 1);
  const criticalOverdue = items.some((item) => item.dueAt && item.dueAt < now && important(item.priority));
  const approachingUnstarted = items.some((item) => item.status === StudyItemStatus.OPEN && item.dueAt && item.dueAt.getTime() - now.getTime() <= 48 * 60 * 60_000 && important(item.priority));
  if (moreThanOneWeekBehind || criticalOverdue || approachingUnstarted || items.filter((item) => item.dueAt && item.dueAt < now).length > 1) return StudyTrafficLight.RED;
  if (
    module.currentMastery === StudyTrafficLight.AMBER
    || items.some((item) => item.mastery === StudyTrafficLight.AMBER || item.mastery === StudyTrafficLight.RED)
  ) return StudyTrafficLight.AMBER;
  if (items.some((item) => item.dueAt && item.dueAt.getTime() - now.getTime() <= 7 * 24 * 60 * 60_000)) return StudyTrafficLight.AMBER;
  if (items.length === 0 && module.currentMastery === StudyTrafficLight.UNASSESSED) return StudyTrafficLight.UNASSESSED;
  return StudyTrafficLight.GREEN;
}

async function seedDefaultStudyModules(workspaceId: string): Promise<void> {
  for (const [displayOrder, module] of DEFAULT_MODULES.entries()) {
    await prisma.studyModule.upsert({
      where: { workspaceId_code: { workspaceId, code: module.code } },
      update: {},
      create: { workspaceId, displayOrder, ...module },
    });
  }
}

async function seedDefaultStudySchedule(workspaceId: string): Promise<void> {
  if (await prisma.studyScheduleBlock.count({ where: { workspaceId } })) return;
  const modules = await listStudyModules(workspaceId);
  const id = (code: string) => modules.find((module) => module.code === code)?.id;
  const blocks = [
    [1, "10:00", "12:00", "CS2103T", "CS2103T class", "timetable", 1, null],
    [1, "14:00", "15:00", "CS2100", "CS2100 tutorial", "timetable", 3, 13],
    [1, "16:00", "18:00", "CS2102", "CS2102 lecture", "timetable", 1, null],
    [2, "14:00", "15:00", "CS2100", "CS2100 lab", "timetable", 3, 13],
    [2, "18:30", "20:30", "IT2900", "IT2900 lecture", "timetable", 1, null],
    [3, "10:00", "12:00", "CS2103T", "CS2103T class", "timetable", 1, null],
    [4, "10:00", "12:00", "IT2900", "IT2900 tutorial", "timetable", 2, 13],
    [4, "16:00", "17:00", "CS2102", "CS2102 tutorial", "timetable", 3, 13],
    [5, "13:00", "14:00", "CS2103T", "CS2103T class", "timetable", 1, null],
    [5, "14:00", "16:00", "CS2100", "CS2100 e-learning lecture", "timetable", 1, null],
    [5, "16:00", "18:00", "CS2103T", "CS2103T class", "timetable", 1, null],
    [1, "18:30", "19:30", "CS2102", "Same-day CS2102 review", "study", 1, null],
    [1, "12:15", "12:45", "CS2103T", "Same-day CS2103T processing", "study", 1, null],
    [2, "10:00", "12:00", "CS2100", "CS2100 deep study", "study", 1, null],
    [2, "15:30", "17:30", "CS2103T", "CS2103T/CS2101 project block", "study", 1, null],
    [3, "13:00", "15:00", "CS2103T", "CS2103T/CS2101 project block", "study", 1, null],
    [3, "16:00", "17:30", "CS2102", "CS2102 practice", "study", 1, null],
    [4, "13:30", "15:00", "CS2100", "CS2100 problem practice", "study", 1, null],
    [4, "19:00", "20:30", null, "Protected overflow/recovery", "protected", 1, null],
    [5, "10:30", "11:30", null, "Tutorial preparation", "study", 1, null],
    [5, "19:00", "23:00", null, "Protected evening", "protected", 1, null],
    [6, "10:00", "12:00", null, "Timed cumulative technical practice", "study", 4, null],
    [6, "14:00", "17:00", "CS2103T", "Project/deadline block", "study", 1, null],
    [7, "18:00", "19:00", null, "Cumulative review and weekly planning", "study", 1, null],
    [7, "19:00", "19:30", null, "Preview upcoming material", "study", 1, null],
  ] as const;
  await prisma.studyScheduleBlock.createMany({
    data: blocks.map(([dayOfWeek, startTime, endTime, code, label, blockType, startWeek, endWeek]) => ({
      workspaceId,
      moduleId: code ? id(code) : undefined,
      dayOfWeek,
      startTime,
      endTime,
      label,
      blockType,
      startWeek,
      endWeek,
    })),
  });
}

async function requireModule(workspaceId: string, moduleId: string): Promise<StudyModule> {
  const module = await prisma.studyModule.findFirst({ where: { id: moduleId, workspaceId, active: true } });
  if (!module) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  return module;
}

export async function nextStudyPublicId(workspaceId: string, prefix: "STUDY" | "MISTAKE"): Promise<string> {
  const rows = prefix === "STUDY"
    ? await prisma.studyItem.findMany({ where: { workspaceId }, select: { publicId: true } })
    : await prisma.studyMistake.findMany({ where: { workspaceId }, select: { publicId: true } });
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const row of rows) {
    const suffix = Number(row.publicId.match(pattern)?.[1]);
    if (Number.isSafeInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${prefix}-${highest + 1}`;
}

function normalizeStudyReference(value: string, prefix: "STUDY" | "MISTAKE"): string {
  const clean = value.trim().toUpperCase();
  if (/^\d+$/.test(clean)) return `${prefix}-${clean}`;
  return clean;
}

function normalizeModuleCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{2,6}\d{3,5}[A-Z]?$/.test(code)) throw new StudyModeError("Use a module code such as CS2100 or CS2103T.", "invalid");
  return code;
}

function requiredText(value: string, message: string, max: number): string {
  const clean = value.trim();
  if (!clean) throw new StudyModeError(message, "invalid");
  return clean.slice(0, max);
}

function validateMonday(value: Date, timezone: string): void {
  const local = DateTime.fromJSDate(value).setZone(timezone);
  if (!local.isValid || local.weekday !== 1) throw new StudyModeError("The semester start date must be a Monday.", "invalid");
}

function buildWeeklyReviewSummary(input: { wins: string[]; unresolvedTopics: string[]; nextWeekPriorities: string[] }): string {
  return [
    input.wins.length ? `Wins: ${input.wins.join("; ")}` : undefined,
    input.unresolvedTopics.length ? `Unresolved: ${input.unresolvedTopics.join("; ")}` : undefined,
    input.nextWeekPriorities.length ? `Next: ${input.nextWeekPriorities.slice(0, 3).join("; ")}` : undefined,
  ].filter(Boolean).join("\n").slice(0, 4_000);
}

function hasConsecutiveRedReviews(reviews: Array<{ moduleStatuses: Prisma.JsonValue }>, moduleCode: string): boolean {
  if (reviews.length < 2) return false;
  return reviews.slice(0, 2).every((review) => {
    const rows = Array.isArray(review.moduleStatuses) ? review.moduleStatuses : [];
    return rows.some((row) => row && typeof row === "object" && !Array.isArray(row)
      && "code" in row && row.code === moduleCode && "status" in row && row.status === StudyTrafficLight.RED);
  });
}

function findNextScheduleBlock(
  workspace: StudyWorkspace,
  blocks: Array<{ dayOfWeek: number; startTime: string; startWeek: number | null; endWeek: number | null; label: string; module: { code: string } | null }>,
  weekNumber: number,
  now: Date,
): { label: string; moduleCode?: string; startsAt: Date } | undefined {
  if (weekNumber < 1) return undefined;
  const localNow = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const candidates = blocks.flatMap((block) => {
    if ((block.startWeek && weekNumber < block.startWeek) || (block.endWeek && weekNumber > block.endWeek)) return [];
    const [hour, minute] = block.startTime.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return [];
    const daysAhead = (block.dayOfWeek - localNow.weekday + 7) % 7;
    let start = localNow.startOf("day").plus({ days: daysAhead }).set({ hour, minute, second: 0, millisecond: 0 });
    if (start <= localNow) start = start.plus({ weeks: 1 });
    return [{ label: block.label, moduleCode: block.module?.code, startsAt: start.toUTC().toJSDate() }];
  });
  return candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function iso(value: Date | null | undefined): string {
  return value?.toISOString() ?? "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function auditStudy(userId: string, action: string, metadata: Prisma.InputJsonObject): Promise<void> {
  await prisma.auditLog.create({ data: { userId, action, metadata } });
}
