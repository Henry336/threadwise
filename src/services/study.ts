/**
 * Core domain logic for Study Mode, the owner-only workspace bound to one private group.
 * Covers access checks (owner + configured chat), workspace binding, modules, weeks,
 * items, Deep Work sessions, mistakes, the timetable and weekly reviews. Called by the
 * Telegram handlers in src/bot/study.ts and studyCapture.ts and the dashboard Study routes;
 * other study* services build on its helpers. Timetable edits queue a Google Calendar sync.
 */
import {
  Prisma,
  StudyItemStatus,
  StudyItemType,
  StudyMistakeCategory,
  StudyMistakeStatus,
  StudyPriority,
  StudyTrafficLight,
  type StudyModule,
  type StudyScheduleBlock,
  type StudyWorkspace,
} from "@prisma/client";
import type { Context } from "grammy";
import { DateTime } from "luxon";
import { privateStudyConfig } from "../config/env";
import { prisma } from "../db/prisma";
import { normalizeClock } from "../utils/clock";
import { hasTrustedStudyDeadline } from "./studyDeadlineTrust";
import { queueStudyCalendarBlockSync } from "./studyCalendar";
import { highestPublicNumber } from "./publicIds";

/** The owner's own semester modules, seeded when the workspace is first bound. */
const DEFAULT_MODULES = [
  { code: "CS2100", name: "Computer Organisation", color: "#2C7A7B" },
  { code: "CS2102", name: "Database Systems", color: "#5A67D8" },
  { code: "CS2103T", name: "Software Engineering", color: "#B7791F", workloadGroup: "CS2103T_CS2101" },
  { code: "CS2101", name: "Effective Communication for Computing Professionals", color: "#C05621", workloadGroup: "CS2103T_CS2101" },
  { code: "IT2900", name: "Technical Management and Leadership", color: "#805AD5" },
  { code: "CFG1004", name: "Career Catalyst", color: "#4A5568" },
] as const;

/** Suggested Deep Work methods per module code, offered when starting a session. */
export const STUDY_METHODS: Record<string, string[]> = {
  CS2100: ["Trace examples", "Number-system practice", "MIPS translation/tracing", "Datapath/control tracing", "Logic/circuit problems", "Timed mixed problems"],
  CS2102: ["SQL exercises", "Relational algebra", "Schema/design reasoning", "Query debugging", "Timed mixed problems"],
  CS2103T: ["Implementation", "Codebase exploration", "Testing", "Review", "Team coordination", "Documentation"],
  CS2101: ["Drafting", "Rubric review", "Rehearsal", "Peer feedback", "Revision"],
  IT2900: ["Reading", "Reflection", "Presentation/discussion preparation"],
  CFG1004: ["Bounded completion session"],
};

/**
 * The one error type for Study rules. Its message is safe to show the owner, and `code`
 * lets the bot and dashboard map it to a reply or HTTP status.
 */
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

/**
 * The Study access rule: the actor must be the configured owner, in the configured chat,
 * and that chat must be a group. Anything missing or different fails closed.
 */
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
    topic?: string;
    focusStructure?: string;
    techniques: string[];
    startedAt: Date;
    item?: { id: string; publicId: string; title: string };
  };
};

export type StudySessionDetails = {
  topic?: string;
  focusStructure?: string;
  techniques?: string[];
  resourceIds?: string[];
};

export type StudySessionUpdate = StudySessionDetails & {
  method?: string;
  result?: string | null;
  topicsMixed?: string[];
  attemptedScore?: number | null;
  maximumScore?: number | null;
  usedNotes?: boolean | null;
  startedAt?: Date;
  endedAt?: Date;
};

const studySessionInclude = {
  module: true,
  item: true,
  resources: {
    include: {
      resource: {
        include: { module: { select: { id: true, code: true, name: true, color: true } } },
      },
    },
  },
} satisfies Prisma.StudySessionInclude;

/** Trims, caps and de-duplicates free-text session lists such as techniques. */
function cleanSessionList(values: string[] | undefined, limit = 20) {
  if (!values) return undefined;
  return [...new Set(values.map((value) => value.trim().slice(0, 160)).filter(Boolean))].slice(0, limit);
}

/**
 * Validates resources to link to a session: all must be live resources of the same module
 * and workspace, otherwise the whole request is rejected rather than partly saved.
 */
async function requireSessionResources(workspaceId: string, moduleId: string, resourceIds: string[] | undefined) {
  const ids = [...new Set(resourceIds ?? [])].slice(0, 30);
  if (ids.length === 0) return ids;
  const resources = await prisma.studyResource.findMany({
    where: { id: { in: ids }, workspaceId, moduleId, archivedAt: null },
    select: { id: true },
  });
  if (resources.length !== ids.length) {
    throw new StudyModeError("One or more linked resources are unavailable for this module.", "forbidden");
  }
  return ids;
}

/** Checks a Telegram update against the Study config and returns the scope, or throws. */
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
 * The one exception outside the group: the owner sharing a location (or the
 * study_location deep link) in private chat, used for travel reminders.
 */
export async function shouldHandleStudyUpdate(ctx: Context): Promise<boolean> {
  if (isStudyContext(ctx)) return true;
  const config = privateStudyConfig();
  if (!config || ctx.chat?.type !== "private" || String(ctx.from?.id ?? "") !== config.ownerTelegramId) return false;
  const text = ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "";
  return Boolean(ctx.message && "location" in ctx.message) || /^\/start(?:@\w+)?\s+study_location\b/i.test(text);
}

/**
 * "/study bind": creates or reactivates the owner's single workspace for this chat.
 * Also ensures the owner user exists, seeds default modules once, and writes an audit entry.
 */
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

/**
 * Deactivates the workspace and clears its chat binding and in-progress conversation.
 * Study data is kept. Also used when the bot sees the group stop being a two-member chat.
 */
export async function unbindStudyWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.studyWorkspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new StudyModeError("Study workspace not found.", "not_found");
  await prisma.$transaction([
    prisma.studyConversation.deleteMany({ where: { workspaceId } }),
    prisma.studyWorkspace.update({ where: { id: workspaceId }, data: { active: false, boundChatId: null } }),
    prisma.auditLog.create({ data: { userId: workspace.ownerUserId, action: "study.workspace.unbound", metadata: { workspaceId } } }),
  ]);
}

/** Returns the active workspace bound to this exact chat; throws not_bound otherwise. */
export async function requireStudyWorkspace(ctx: Context): Promise<StudyWorkspace> {
  const scope = studyScopeFromContext(ctx);
  const workspace = await prisma.studyWorkspace.findUnique({ where: { ownerTelegramId: scope.ownerTelegramId } });
  if (!workspace?.active || workspace.boundChatId !== scope.chatId) {
    throw new StudyModeError("Study Mode is not bound here yet. Run /study bind.", "not_bound");
  }
  return workspace;
}

/**
 * Starts a multi-step Telegram flow (the bot waiting for the owner's next message).
 * Only one flow exists per workspace; starting a new one replaces the old. It expires.
 */
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

/** Returns the open flow, deleting it first if it has expired. */
export async function getStudyConversation(workspaceId: string) {
  const conversation = await prisma.studyConversation.findUnique({ where: { workspaceId } });
  if (!conversation) return undefined;
  if (conversation.expiresAt <= new Date()) {
    await prisma.studyConversation.delete({ where: { workspaceId } });
    return undefined;
  }
  return conversation;
}

/** Moves the open flow to its next step and extends its expiry. */
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

/** Reads the stored JSON payload as a plain object (empty if it is anything else). */
export function studyConversationPayload(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * The workspace for the configured owner and chat, for code with no Telegram update to
 * check (such as background reminders). Undefined when Study is unconfigured or unbound.
 */
export async function activeStudyWorkspace(): Promise<StudyWorkspace | undefined> {
  const config = privateStudyConfig();
  if (!config) return undefined;
  return (await prisma.studyWorkspace.findFirst({
    where: { ownerTelegramId: config.ownerTelegramId, boundChatId: config.allowedChatId, active: true },
  })) ?? undefined;
}

/**
 * "/study setup": saves the semester name, its Monday start date and timezone, which all
 * week numbers are counted from. Then seeds the default timetable if it is still empty.
 */
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

/** Semester week (1-based) for a date in the workspace timezone; 0 before the start or when unset. */
export function academicWeekNumber(workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">, now = new Date()): number {
  if (!workspace.semesterStartDate) return 0;
  const start = DateTime.fromJSDate(workspace.semesterStartDate).setZone(workspace.timezone).startOf("day");
  const current = DateTime.fromJSDate(now).setZone(workspace.timezone).startOf("day");
  if (current < start) return 0;
  return Math.floor(current.diff(start, "days").days / 7) + 1;
}

/** Monday 00:00 to Sunday 23:59 of a semester week, as UTC instants. */
export function academicWeekRange(
  workspace: Pick<StudyWorkspace, "semesterStartDate" | "timezone">,
  weekNumber: number,
): { start: Date; end: Date } {
  if (!workspace.semesterStartDate || weekNumber < 1) throw new StudyModeError("Run /study setup first.", "invalid");
  const start = DateTime.fromJSDate(workspace.semesterStartDate).setZone(workspace.timezone).startOf("day").plus({ weeks: weekNumber - 1 });
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 6 }).endOf("day").toUTC().toJSDate() };
}

/** Gets or creates the week row (upsert), so items can be filed under a week on first use. */
export async function ensureStudyWeek(workspace: StudyWorkspace, weekNumber = academicWeekNumber(workspace)): Promise<Prisma.StudyWeekGetPayload<object>> {
  if (weekNumber < 1) throw new StudyModeError("The semester has not started. Use /study setup to check the starting Monday.", "invalid");
  const range = academicWeekRange(workspace, weekNumber);
  return prisma.studyWeek.upsert({
    where: { workspaceId_number: { workspaceId: workspace.id, number: weekNumber } },
    update: { startDate: range.start, endDate: range.end },
    create: { workspaceId: workspace.id, number: weekNumber, startDate: range.start, endDate: range.end, topPriorities: [] },
  });
}

/** Active modules (or all), pinned first, then the owner's display order. */
export async function listStudyModules(workspaceId: string, includeArchived = false): Promise<StudyModule[]> {
  return prisma.studyModule.findMany({
    where: { workspaceId, ...(includeArchived ? {} : { active: true }) },
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { displayOrder: "asc" }, { code: "asc" }],
  });
}

/** Looks up a module by code (case-insensitive) or id, within this workspace only. */
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

/** Creates a module; a duplicate code becomes a friendly "already exists" conflict. */
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

/**
 * Renames, archives/restores or pins a module. Archiving records userArchivedAt, which
 * marks the hide as the owner's choice rather than Canvas discovery state.
 */
export async function updateStudyModule(
  workspace: StudyWorkspace,
  moduleId: string,
  input: { code?: string; name?: string; active?: boolean; pinned?: boolean },
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
      ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date() : null } : {}),
    },
  });
  await auditStudy(workspace.ownerUserId, "study.module.updated", { workspaceId: workspace.id, moduleId, code: module.code, active: module.active, pinned: Boolean(module.pinnedAt) });
  return module;
}

/**
 * Creates a manual Study item with the next STUDY-n public id, filed under the current
 * (or given) semester week. Validates module ownership and the planned-minutes range.
 */
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

/** Looks up an item by public id (accepts "4" or "STUDY-4") or internal id, within this workspace. */
export async function findStudyItem(workspaceId: string, reference: string) {
  const normalized = normalizeStudyReference(reference, "STUDY");
  const item = await prisma.studyItem.findFirst({
    where: { workspaceId, OR: [{ publicId: normalized }, ...(isUuid(reference) ? [{ id: reference }] : [])] },
    include: { module: true, week: true, canvasAssignment: true },
  });
  if (!item) throw new StudyModeError(`I couldn't find ${normalized}.`, "not_found");
  return item;
}

/** Marks an item DONE, or PROCESSED (for example a lecture or tutorial that has been worked through). Audited. */
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

/**
 * Sets a new due date and marks it as the owner's override, so the next Canvas sync keeps
 * this date instead of restoring Canvas's. Also moves the item to the matching week.
 */
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

/**
 * Sets a red/amber/green mastery light. The reference is tried as a module code first,
 * then as an item. For modules, redSince records when it first went red (for warnings).
 */
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

/**
 * Starts a Deep Work session. Only one session may be open per workspace at a time.
 * The linked item and resources must belong to the same module.
 */
export async function startStudySession(
  workspace: StudyWorkspace,
  moduleId: string,
  method: string,
  itemId?: string,
  details: StudySessionDetails = {},
) {
  await requireModule(workspace.id, moduleId);
  const open = await prisma.studySession.findFirst({ where: { workspaceId: workspace.id, endedAt: null, archivedAt: null } });
  if (open) throw new StudyModeError("A study session is already running. Use /study stop first.", "conflict");
  if (itemId) {
    const item = await prisma.studyItem.findFirst({ where: { id: itemId, workspaceId: workspace.id, moduleId } });
    if (!item) throw new StudyModeError("That study item does not belong to this module.", "forbidden");
  }
  const resourceIds = await requireSessionResources(workspace.id, moduleId, details.resourceIds);
  const session = await prisma.studySession.create({
    data: {
      workspaceId: workspace.id,
      moduleId,
      itemId,
      startedAt: new Date(),
      method: method.trim().slice(0, 160) || "Focused study",
      topic: details.topic?.trim().slice(0, 240) || null,
      focusStructure: details.focusStructure?.trim().slice(0, 80) || null,
      techniques: cleanSessionList(details.techniques, 10) ?? [],
      topicsMixed: [],
      timed: /timed/i.test(method),
      resources: { create: resourceIds.map((resourceId) => ({ resourceId })) },
    },
    include: studySessionInclude,
  });
  await auditStudy(workspace.ownerUserId, "study.session.started", { workspaceId: workspace.id, sessionId: session.id, module: session.module.code, method: session.method });
  return session;
}

/**
 * Ends the open session, records its result, and adds its minutes to the linked item's
 * actual time. All writes, including the audit entry, happen in one transaction.
 */
export async function stopStudySession(
  workspace: StudyWorkspace,
  input: { result?: string; topicsMixed?: string[]; attemptedScore?: number; maximumScore?: number; usedNotes?: boolean },
) {
  const session = await prisma.studySession.findFirst({
    where: { workspaceId: workspace.id, endedAt: null, archivedAt: null },
    orderBy: { startedAt: "desc" },
    include: studySessionInclude,
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
      include: studySessionInclude,
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

/**
 * Dashboard edit of a session record (details, times, linked resources). If the duration
 * changes, the linked item's actual minutes are adjusted by the difference so totals stay
 * consistent. Runs in one transaction.
 */
export async function updateStudySession(
  workspace: StudyWorkspace,
  sessionId: string,
  input: StudySessionUpdate,
) {
  const session = await prisma.studySession.findFirst({
    where: { id: sessionId, workspaceId: workspace.id, archivedAt: null },
    include: studySessionInclude,
  });
  if (!session) throw new StudyModeError("That study session could not be found.", "not_found");
  const resourceIds = input.resourceIds === undefined
    ? undefined
    : await requireSessionResources(workspace.id, session.moduleId, input.resourceIds);
  const startedAt = input.startedAt ?? session.startedAt;
  const endedAt = input.endedAt ?? session.endedAt;
  if (endedAt && endedAt.getTime() < startedAt.getTime()) {
    throw new StudyModeError("The session must end after it starts.", "invalid");
  }
  const durationMinutes = endedAt
    ? Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000))
    : null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.studySession.update({
      where: { id: session.id },
      data: {
        ...(input.method !== undefined ? { method: input.method.trim().slice(0, 160) || "Focused study" } : {}),
        ...(input.topic !== undefined ? { topic: input.topic.trim().slice(0, 240) || null } : {}),
        ...(input.focusStructure !== undefined ? { focusStructure: input.focusStructure.trim().slice(0, 80) || null } : {}),
        ...(input.techniques !== undefined ? { techniques: cleanSessionList(input.techniques, 10) ?? [] } : {}),
        ...(input.result !== undefined ? { result: input.result?.trim().slice(0, 2_000) || null } : {}),
        ...(input.topicsMixed !== undefined ? { topicsMixed: cleanSessionList(input.topicsMixed) ?? [] } : {}),
        attemptedScore: input.attemptedScore,
        maximumScore: input.maximumScore,
        usedNotes: input.usedNotes,
        ...(input.startedAt !== undefined || input.endedAt !== undefined ? { startedAt, endedAt, durationMinutes } : {}),
        ...(resourceIds !== undefined ? {
          resources: {
            deleteMany: {},
            create: resourceIds.map((resourceId) => ({ resourceId })),
          },
        } : {}),
      },
      include: studySessionInclude,
    });
    if (session.itemId && session.endedAt && durationMinutes !== null && durationMinutes !== session.durationMinutes) {
      const item = await tx.studyItem.findUnique({ where: { id: session.itemId }, select: { actualMinutes: true } });
      if (item) {
        const delta = durationMinutes - (session.durationMinutes ?? 0);
        await tx.studyItem.update({ where: { id: session.itemId }, data: { actualMinutes: Math.max(0, (item.actualMinutes ?? 0) + delta) } });
      }
    }
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

/**
 * Soft-removes a finished session from history (archivedAt, not a hard delete) and
 * subtracts its minutes from the linked item. A running session cannot be archived.
 */
export async function archiveStudySession(workspace: StudyWorkspace, sessionId: string) {
  const session = await prisma.studySession.findFirst({
    where: { id: sessionId, workspaceId: workspace.id, archivedAt: null },
  });
  if (!session) throw new StudyModeError("That study session could not be found.", "not_found");
  if (!session.endedAt) throw new StudyModeError("End the session before removing it from history.", "conflict");
  return prisma.$transaction(async (tx) => {
    const archived = await tx.studySession.update({ where: { id: session.id }, data: { archivedAt: new Date() } });
    if (session.itemId && session.durationMinutes) {
      const item = await tx.studyItem.findUnique({ where: { id: session.itemId }, select: { actualMinutes: true } });
      if (item) {
        await tx.studyItem.update({
          where: { id: session.itemId },
          data: { actualMinutes: Math.max(0, (item.actualMinutes ?? 0) - session.durationMinutes) },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: workspace.ownerUserId,
        action: "study.session.archived",
        metadata: { workspaceId: workspace.id, sessionId: session.id },
      },
    });
    return archived;
  });
}

/**
 * Logs a mistake (source, cause, prevention) with the next MISTAKE-n id and an optional
 * revisit date, so it can come back later as a re-attempt.
 */
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

/**
 * Lists unresolved mistakes of active modules. Side effect: open mistakes whose revisit
 * date has passed are first promoted to REATTEMPT_DUE.
 */
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

/** Saves up to three top priorities (and overload notes) for the current week. */
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

/**
 * Saves the end-of-week review in one transaction: each module's new mastery light, the
 * review record (upserted per week, so redoing it overwrites), and the week's overall
 * status. Rejects answers that mention modules outside this workspace.
 */
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

/**
 * Builds the Study home summary: per-module traffic light, open/overdue counts, planned vs
 * actual minutes this week, due mistakes, the next timetable block and any running session.
 * Writes only this week's row and due-mistake promotion. Overdue counts use trusted deadlines only.
 */
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
      include: {
        week: true,
        module: { select: { canvasTermStartAt: true, canvasTermEndAt: true } },
        canvasAssignment: { select: { needsReview: true, status: true } },
      },
    }),
    weekRange ? prisma.studySession.findMany({ where: { workspaceId: workspace.id, module: { active: true }, archivedAt: null, startedAt: { gte: weekRange.start, lte: weekRange.end }, endedAt: { not: null } } }) : Promise.resolve([]),
    listStudyMistakes(workspace.id, now),
    prisma.studyScheduleBlock.findMany({ where: { workspaceId: workspace.id, active: true, OR: [{ moduleId: null }, { module: { active: true } }] }, include: { module: true } }),
    prisma.weeklyReview.findMany({ where: { workspaceId: workspace.id }, orderBy: { completedAt: "desc" }, take: 2 }),
    prisma.studySession.findFirst({
      where: { workspaceId: workspace.id, module: { active: true }, endedAt: null, archivedAt: null },
      include: { module: true, item: { select: { id: true, publicId: true, title: true } } },
    }),
  ]);
  const dashboardModules: StudyDashboardModule[] = modules.map((module) => {
    const moduleItems = items.filter((item) => item.moduleId === module.id);
    const openItems = moduleItems.filter((item) => item.status === StudyItemStatus.OPEN || item.status === StudyItemStatus.IN_PROGRESS);
    const deadlineSafeOpenItems = openItems.map((item) => ({
      ...item,
      dueAt: hasTrustedStudyDeadline(workspace, item) ? item.dueAt : null,
    }));
    const moduleSessions = sessions.filter((session) => session.moduleId === module.id);
    const moduleMistakes = mistakes.filter((mistake) => mistake.moduleId === module.id && mistake.revisitAt && mistake.revisitAt <= now);
    const status = deriveModuleBacklogStatus(module, deadlineSafeOpenItems, weekNumber, now);
    return {
      id: module.id,
      code: module.code,
      name: module.name,
      status,
      open: openItems.length,
      overdue: deadlineSafeOpenItems.filter((item) => item.dueAt && item.dueAt < now).length,
      unprocessed: openItems.filter((item) => (
        item.type === StudyItemType.LECTURE
        || item.type === StudyItemType.TUTORIAL
        || item.type === StudyItemType.LAB
      )).length,
      plannedMinutes: moduleItems.filter((item) => item.weekId === week?.id).reduce((sum, item) => sum + (item.plannedMinutes ?? 0), 0),
      actualMinutes: moduleSessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0),
      nearestDeadline: deadlineSafeOpenItems.map((item) => item.dueAt).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime())[0],
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
      topic: openSession.topic ?? undefined,
      focusStructure: openSession.focusStructure ?? undefined,
      techniques: openSession.techniques,
      startedAt: openSession.startedAt,
      item: openSession.item ?? undefined,
    } : undefined,
  };
}

/** Up to 50 open items of active modules, soonest due first (undated last). */
export async function upcomingStudyItems(workspaceId: string, now = new Date()) {
  return prisma.studyItem.findMany({
    where: { workspaceId, module: { active: true }, status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS] } },
    include: { module: true },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
}

/**
 * Parses a strict YYYY-MM-DD date to UTC midnight. Keeps the undefined (leave unchanged)
 * vs null (clear) distinction that partial updates rely on.
 */
function calendarDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  if (!parsed.isValid || value !== parsed.toISODate()) {
    throw new StudyModeError("Choose a valid calendar date.", "invalid");
  }
  return parsed.startOf("day").toJSDate();
}

function optionalLabel(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const clean = value?.replace(/\s+/gu, " ").trim();
  return clean ? clean.slice(0, 80) : null;
}

/** De-duplicates dates by calendar day and sorts them. */
function uniqueCalendarDates(values: Date[]): Date[] {
  return [...new Map(values.map((date) => [date.toISOString().slice(0, 10), date])).values()]
    .sort((left, right) => left.getTime() - right.getTime());
}

/** True if a date-based recurring block runs on this calendar day (inside its range, not excluded). */
export function studyScheduleOccursOnDate(
  block: Partial<Pick<StudyScheduleBlock, "recurrenceStartDate" | "recurrenceEndDate" | "excludedDates">>,
  occurrenceDate: Date,
): boolean {
  const key = occurrenceDate.toISOString().slice(0, 10);
  if (block.recurrenceStartDate && key < block.recurrenceStartDate.toISOString().slice(0, 10)) return false;
  if (block.recurrenceEndDate && key > block.recurrenceEndDate.toISOString().slice(0, 10)) return false;
  return !(block.excludedDates ?? []).some((date) => date.toISOString().slice(0, 10) === key);
}

/** Active timetable blocks (unlinked or linked to an active module), Monday first, by start time. */
export async function listStudyScheduleBlocks(workspaceId: string) {
  return prisma.studyScheduleBlock.findMany({
    where: { workspaceId, active: true, OR: [{ moduleId: null }, { module: { active: true } }] },
    include: { module: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}

/**
 * Adds a weekly timetable block after validating day, time range, module, travel origin
 * and recurrence dates. Then audits it and queues it for the Google Calendar mirror.
 */
export async function addStudyScheduleBlock(
  workspace: StudyWorkspace,
  input: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    label: string;
    moduleId?: string | null;
    blockType?: string;
    customTypeLabel?: string;
    recurrenceStartDate?: string | null;
    recurrenceEndDate?: string | null;
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
  const recurrenceStartDate = calendarDate(input.recurrenceStartDate);
  const recurrenceEndDate = calendarDate(input.recurrenceEndDate);
  if (recurrenceStartDate && recurrenceEndDate && recurrenceEndDate < recurrenceStartDate) {
    throw new StudyModeError("The recurrence end date cannot be before its start date.", "invalid");
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
      customTypeLabel: optionalLabel(input.customTypeLabel),
      recurrenceStartDate,
      recurrenceEndDate,
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
  await queueStudyCalendarBlockSync(workspace, block.id);
  return block;
}

/**
 * Partial edit of a timetable block. Each check combines the new value with the stored
 * one, so changing only the end time still validates the full range. Travel buffer and
 * reminder lead are clamped. Queues a Calendar sync afterwards.
 */
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
    customTypeLabel?: string | null;
    recurrenceStartDate?: string | null;
    recurrenceEndDate?: string | null;
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
  const recurrenceStartDate = input.recurrenceStartDate === undefined ? undefined : calendarDate(input.recurrenceStartDate);
  const recurrenceEndDate = input.recurrenceEndDate === undefined ? undefined : calendarDate(input.recurrenceEndDate);
  const effectiveRecurrenceStart = recurrenceStartDate === undefined ? block.recurrenceStartDate : recurrenceStartDate;
  const effectiveRecurrenceEnd = recurrenceEndDate === undefined ? block.recurrenceEndDate : recurrenceEndDate;
  if (effectiveRecurrenceStart && effectiveRecurrenceEnd && effectiveRecurrenceEnd < effectiveRecurrenceStart) {
    throw new StudyModeError("The recurrence end date cannot be before its start date.", "invalid");
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
      customTypeLabel: input.customTypeLabel === undefined ? undefined : optionalLabel(input.customTypeLabel),
      recurrenceStartDate,
      recurrenceEndDate,
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
  await queueStudyCalendarBlockSync(workspace, updated.id);
  return updated;
}

export type StudyScheduleDeleteScope = "occurrence" | "future" | "series";

/**
 * Works out the update for removing a recurring block without deleting the row:
 * "occurrence" excludes one date or week, "future" ends the series before it, and
 * "series" deactivates it. Pure function, so the rules can be unit tested directly.
 */
export function studyScheduleDeleteMutation(
  block: Pick<StudyScheduleBlock, "active" | "startWeek" | "endWeek" | "excludedWeeks"> & Partial<Pick<StudyScheduleBlock, "recurrenceStartDate" | "recurrenceEndDate" | "excludedDates">>,
  input: { scope?: StudyScheduleDeleteScope; weekNumber?: number; occurrenceDate?: string },
) {
  const scope = input.scope ?? "series";
  const weekNumber = input.weekNumber;
  if (scope === "series") return { active: false };
  const occurrenceDate = calendarDate(input.occurrenceDate);
  if (occurrenceDate) {
    if (!studyScheduleOccursOnDate(block, occurrenceDate)) {
      throw new StudyModeError("That block does not occur on the selected date.", "invalid");
    }
    if (scope === "occurrence") {
      const dates = [...(block.excludedDates ?? []), occurrenceDate];
      return { excludedDates: uniqueCalendarDates(dates) };
    }
    return block.recurrenceStartDate && occurrenceDate <= block.recurrenceStartDate
      ? { active: false }
      : {
          recurrenceEndDate: DateTime.fromJSDate(occurrenceDate, { zone: "utc" }).minus({ days: 1 }).startOf("day").toJSDate(),
          excludedDates: (block.excludedDates ?? []).filter((date) => date < occurrenceDate),
        };
  }
  if (!weekNumber || !Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 80) {
    throw new StudyModeError("Choose the academic week to remove.", "invalid");
  }
  if ((block.startWeek && weekNumber < block.startWeek) || (block.endWeek && weekNumber > block.endWeek)) {
    throw new StudyModeError("That block does not occur in the selected week.", "invalid");
  }
  if (scope === "occurrence") {
    return { excludedWeeks: [...new Set([...block.excludedWeeks, weekNumber])].sort((a, b) => a - b) };
  }
  return block.startWeek && weekNumber <= block.startWeek
    ? { active: false }
    : { endWeek: weekNumber - 1, excludedWeeks: block.excludedWeeks.filter((week) => week < weekNumber) };
}

/**
 * Applies a removal scope to a block, then queues the Calendar mirror: a still-active block
 * is re-sent (UPSERT) with its new range or exclusions, a deactivated one is DELETEd.
 */
export async function archiveStudyScheduleBlock(
  workspace: StudyWorkspace,
  blockId: string,
  input: { scope?: StudyScheduleDeleteScope; weekNumber?: number; occurrenceDate?: string } = {},
) {
  const block = await prisma.studyScheduleBlock.findFirst({ where: { id: blockId, workspaceId: workspace.id, active: true } });
  if (!block) throw new StudyModeError("That schedule block was not found.", "not_found");
  const scope = input.scope ?? "series";
  const data = studyScheduleDeleteMutation(block, input);
  const updated = await prisma.studyScheduleBlock.update({ where: { id: block.id }, data });
  await queueStudyCalendarBlockSync(workspace, block.id, updated.active ? "UPSERT" : "DELETE");
  await auditStudy(workspace.ownerUserId, "study.schedule.removed", { workspaceId: workspace.id, blockId, scope, weekNumber: input.weekNumber });
}

/** Builds the Study CSV export files (dashboard, items, sessions, mastery, mistakes, reviews) in memory. */
export async function createStudyExports(workspace: StudyWorkspace, now = new Date()): Promise<Array<{ fileName: string; content: string }>> {
  const dashboard = await buildStudyDashboard(workspace, now);
  const [items, sessions, mistakes, reviews, modules] = await Promise.all([
    prisma.studyItem.findMany({ where: { workspaceId: workspace.id, module: { active: true } }, include: { module: true, week: true }, orderBy: { createdAt: "asc" } }),
    prisma.studySession.findMany({ where: { workspaceId: workspace.id, module: { active: true }, archivedAt: null }, include: studySessionInclude, orderBy: { startedAt: "asc" } }),
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

/** CSV with a UTF-8 byte-order mark and CRLF rows, so Excel opens non-ASCII text correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Worst light wins: any red is red, then amber; green only if every module is green. */
export function deriveOverallStatus(statuses: StudyTrafficLight[]): StudyTrafficLight {
  if (statuses.includes(StudyTrafficLight.RED)) return StudyTrafficLight.RED;
  if (statuses.includes(StudyTrafficLight.AMBER)) return StudyTrafficLight.AMBER;
  if (statuses.length > 0 && statuses.every((status) => status === StudyTrafficLight.GREEN)) return StudyTrafficLight.GREEN;
  return StudyTrafficLight.UNASSESSED;
}

/** Flags CS2100/CS2102 when no timed practice session happened this week, once timed practice has begun. */
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

/**
 * Rule-based traffic light for one module from its open items. Red if mastery is red,
 * work is over a week behind, important work is overdue or due within 48 hours unstarted,
 * or more than one item is overdue. Amber for amber mastery or anything due within 7 days.
 */
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

/** Creates any missing default modules; existing ones are never changed (empty update). */
async function seedDefaultStudyModules(workspaceId: string): Promise<void> {
  for (const [displayOrder, module] of DEFAULT_MODULES.entries()) {
    await prisma.studyModule.upsert({
      where: { workspaceId_code: { workspaceId, code: module.code } },
      update: {},
      create: { workspaceId, displayOrder, ...module },
    });
  }
}

/**
 * Seeds the owner's starting weekly timetable (classes plus planned study and protected
 * blocks), only when the workspace has no blocks yet. Rows are tagged SYSTEM_SEED.
 */
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
      source: "SYSTEM_SEED",
    })),
  });
}

/** Ownership guard: the module must be active and belong to this workspace. */
async function requireModule(workspaceId: string, moduleId: string): Promise<StudyModule> {
  const module = await prisma.studyModule.findFirst({ where: { id: moduleId, workspaceId, active: true } });
  if (!module) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  return module;
}

/**
 * Next human id (STUDY-n or MISTAKE-n), one above the highest ever used in this workspace,
 * including archived rows, so ids are never reused.
 */
export async function nextStudyPublicId(workspaceId: string, prefix: "STUDY" | "MISTAKE"): Promise<string> {
  const rows = prefix === "STUDY"
    ? await prisma.studyItem.findMany({ where: { workspaceId }, select: { publicId: true } })
    : await prisma.studyMistake.findMany({ where: { workspaceId }, select: { publicId: true } });
  return `${prefix}-${highestPublicNumber(rows, prefix) + 1}`;
}

/** Lets the owner type just "4" for STUDY-4 (or MISTAKE-4). */
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

/** Week numbering assumes the semester starts on a Monday in the workspace timezone. */
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

/** True when the module was red in both of the two most recent weekly reviews. */
function hasConsecutiveRedReviews(reviews: Array<{ moduleStatuses: Prisma.JsonValue }>, moduleCode: string): boolean {
  if (reviews.length < 2) return false;
  return reviews.slice(0, 2).every((review) => {
    const rows = Array.isArray(review.moduleStatuses) ? review.moduleStatuses : [];
    return rows.some((row) => row && typeof row === "object" && !Array.isArray(row)
      && "code" in row && row.code === moduleCode && "status" in row && row.status === StudyTrafficLight.RED);
  });
}

/**
 * Finds the next upcoming block start after `now`. Each block is walked forward week by
 * week (up to a year), honouring either its date range and excluded dates or its
 * semester week range and excluded weeks.
 */
function findNextScheduleBlock(
  workspace: StudyWorkspace,
  blocks: Array<{
    dayOfWeek: number;
    startTime: string;
    startWeek: number | null;
    endWeek: number | null;
    excludedWeeks: number[];
    recurrenceStartDate: Date | null;
    recurrenceEndDate: Date | null;
    excludedDates: Date[];
    label: string;
    module: { code: string } | null;
  }>,
  weekNumber: number,
  now: Date,
): { label: string; moduleCode?: string; startsAt: Date } | undefined {
  void weekNumber;
  const localNow = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const candidates = blocks.flatMap((block) => {
    const [hour, minute] = block.startTime.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return [];
    const daysAhead = (block.dayOfWeek - localNow.weekday + 7) % 7;
    let start = localNow.startOf("day").plus({ days: daysAhead }).set({ hour, minute, second: 0, millisecond: 0 });
    if (start <= localNow) start = start.plus({ weeks: 1 });
    const usesCalendarRecurrence = Boolean(block.recurrenceStartDate || block.recurrenceEndDate || block.excludedDates.length);
    for (let attempt = 0; attempt < 52; attempt += 1) {
      const candidateDate = start.toISODate();
      const calendarDay = candidateDate ? new Date(`${candidateDate}T00:00:00.000Z`) : start.toUTC().toJSDate();
      if (usesCalendarRecurrence) {
        if (studyScheduleOccursOnDate(block, calendarDay)) {
          return [{ label: block.label, moduleCode: block.module?.code, startsAt: start.toUTC().toJSDate() }];
        }
        if (block.recurrenceEndDate && calendarDay > block.recurrenceEndDate) return [];
      } else {
        const candidateWeek = academicWeekNumber(workspace, start.toUTC().toJSDate());
        if ((!block.startWeek || candidateWeek >= block.startWeek)
          && (!block.endWeek || candidateWeek <= block.endWeek)
          && !block.excludedWeeks.includes(candidateWeek)) {
          return [{ label: block.label, moduleCode: block.module?.code, startsAt: start.toUTC().toJSDate() }];
        }
        if (block.endWeek && candidateWeek > block.endWeek) return [];
      }
      start = start.plus({ weeks: 1 });
    }
    return [];
  });
  return candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
}

/** Quotes a CSV cell only when it contains a comma, quote or newline. */
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

/** Writes one AuditLog row for a Study change, owned by the workspace owner. */
async function auditStudy(userId: string, action: string, metadata: Prisma.InputJsonObject): Promise<void> {
  await prisma.auditLog.create({ data: { userId, action, metadata } });
}
