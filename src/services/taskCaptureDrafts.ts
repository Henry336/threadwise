import {
  PlanningScope,
  Prisma,
  type PrismaClient,
  StudyItemSource,
  StudyItemStatus,
  StudyItemType,
  StudyPriority,
  TaskAssigneeStatus,
  TaskAudience,
  TaskCaptureDraftItemStatus,
  TaskCaptureDraftStatus,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { createGoogleCalendarUrl } from "./calendar";
import { recordCreateUndo } from "./undo";
import {
  TASK_CAPTURE_DRAFT_LIMIT,
  TASK_CAPTURE_DRAFT_TTL_MS,
  parseTaskTimingIntent,
  splitTaskDraftText,
  taskContinuationDescription,
} from "./taskPlanning";

const activeStatuses = [TaskCaptureDraftStatus.COLLECTING, TaskCaptureDraftStatus.REVIEWING] as const;
const draftInclude = { items: { orderBy: { position: "asc" as const } } };

export type TaskCaptureDraftRecord = Prisma.TaskCaptureDraftGetPayload<{ include: typeof draftInclude }>;

export type TaskCaptureScope = {
  ownerUserId: string;
  principalTelegramId: string;
  scope: PlanningScope;
  timezone: string;
  groupWorkspaceId?: string;
  studyWorkspaceId?: string;
};

export type DraftAssignee = {
  telegramId?: string;
  username?: string;
  displayName?: string;
};

export type DraftItemPatch = {
  title?: string;
  plannedFor?: Date | null;
  dueAt?: Date | null;
  moduleId?: string | null;
  studyItemType?: StudyItemType | null;
  assignees?: DraftAssignee[];
  teamOwnerLabel?: string | null;
  linkedTaskId?: string | null;
  linkedStudyItemId?: string | null;
  included?: boolean;
  resolveWarnings?: boolean;
};

export class TaskCaptureDraftError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "forbidden" | "conflict" | "expired") {
    super(message);
    this.name = "TaskCaptureDraftError";
  }
}

export async function createTaskCaptureDraft(
  scope: TaskCaptureScope,
  sourceText: string,
  options: { moduleId?: string; studyItemType?: StudyItemType; telegramChatId?: string; telegramReviewMessageId?: number; now?: Date } = {},
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  validateScope(scope);
  const now = options.now ?? new Date();
  const parsed = parseDraftItems(sourceText, scope.timezone, now, options.moduleId, options.studyItemType, scope.scope);
  if (!parsed.length) throw new TaskCaptureDraftError("Add at least one task.", "invalid");

  return database.$transaction(async (tx) => {
    await tx.taskCaptureDraft.updateMany({
      where: {
        principalTelegramId: scope.principalTelegramId,
        status: { in: [...activeStatuses] },
        ...(scope.scope === PlanningScope.PERSONAL ? { scope: PlanningScope.PERSONAL } : {}),
        ...(scope.groupWorkspaceId ? { groupWorkspaceId: scope.groupWorkspaceId } : {}),
        ...(scope.studyWorkspaceId ? { studyWorkspaceId: scope.studyWorkspaceId } : {}),
      },
      data: { status: TaskCaptureDraftStatus.CANCELED, canceledAt: now },
    });
    const prepared = scope.scope === PlanningScope.STUDY
      ? await linkMatchingStudyItems(tx, scope, parsed)
      : parsed;
    return tx.taskCaptureDraft.create({
      data: {
        ownerUserId: scope.ownerUserId,
        principalTelegramId: scope.principalTelegramId,
        scope: scope.scope,
        timezone: scope.timezone,
        groupWorkspaceId: scope.groupWorkspaceId,
        studyWorkspaceId: scope.studyWorkspaceId,
        sourceText: sourceText.trim(),
        status: TaskCaptureDraftStatus.REVIEWING,
        telegramChatId: options.telegramChatId,
        telegramReviewMessageId: options.telegramReviewMessageId,
        expiresAt: new Date(now.getTime() + TASK_CAPTURE_DRAFT_TTL_MS),
        items: { create: prepared },
      },
      include: draftInclude,
    });
  });
}

async function linkMatchingStudyItems(
  tx: Prisma.TransactionClient,
  scope: TaskCaptureScope,
  items: ReturnType<typeof parseDraftItems>,
) {
  if (!scope.studyWorkspaceId) return items;
  const moduleIds = [...new Set(items.map((item) => item.moduleId).filter((value): value is string => Boolean(value)))];
  if (!moduleIds.length) return items;
  const existing = await tx.studyItem.findMany({
    where: {
      workspaceId: scope.studyWorkspaceId,
      moduleId: { in: moduleIds },
      source: StudyItemSource.CANVAS,
      status: StudyItemStatus.OPEN,
    },
    select: { id: true, moduleId: true, title: true, dueAt: true },
  });
  return items.map((item) => {
    if (!item.moduleId) return item;
    const itemTitles = new Set([normalizedStudyTitle(item.title), normalizedStudyTitle(item.sourceText)]);
    const matches = existing.filter((candidate) => candidate.moduleId === item.moduleId
      && itemTitles.has(normalizedStudyTitle(candidate.title)));
    if (matches.length !== 1) return item;
    return {
      ...item,
      linkedStudyItemId: matches[0]!.id,
      // Canvas remains authoritative for its deadline. The draft only adds a plan.
      dueAt: matches[0]!.dueAt ?? undefined,
    };
  });
}

function normalizedStudyTitle(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export async function getTaskCaptureDraft(
  draftId: string,
  principalTelegramId: string,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  let draft = await database.taskCaptureDraft.findFirst({
    where: { id: draftId, principalTelegramId },
    include: draftInclude,
  });
  if (!draft) throw new TaskCaptureDraftError("That task draft no longer exists.", "not_found");
  if (draft.expiresAt <= new Date() && activeStatuses.includes(draft.status as typeof activeStatuses[number])) {
    draft = await database.taskCaptureDraft.update({
      where: { id: draft.id },
      data: { status: TaskCaptureDraftStatus.EXPIRED },
      include: draftInclude,
    });
  }
  return draft;
}

export async function findActiveTaskCaptureDraft(
  scope: TaskCaptureScope,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord | undefined> {
  validateScope(scope);
  const draft = await database.taskCaptureDraft.findFirst({
    where: {
      principalTelegramId: scope.principalTelegramId,
      status: { in: [...activeStatuses] },
      ...(scope.scope === PlanningScope.PERSONAL ? { scope: PlanningScope.PERSONAL } : {}),
      ...(scope.groupWorkspaceId ? { groupWorkspaceId: scope.groupWorkspaceId } : {}),
      ...(scope.studyWorkspaceId ? { studyWorkspaceId: scope.studyWorkspaceId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: draftInclude,
  });
  if (!draft) return undefined;
  return getTaskCaptureDraft(draft.id, scope.principalTelegramId, database);
}

export async function collectTaskCaptureDraft(
  draftId: string,
  principalTelegramId: string,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await requireEditableDraft(draftId, principalTelegramId, database);
  return database.taskCaptureDraft.update({
    where: { id: draft.id },
    data: { status: TaskCaptureDraftStatus.COLLECTING, expiresAt: new Date(Date.now() + TASK_CAPTURE_DRAFT_TTL_MS) },
    include: draftInclude,
  });
}

export async function rememberTaskCaptureDraftTelegramReview(
  draftId: string,
  principalTelegramId: string,
  chatId: string,
  messageId: number,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await requireEditableDraft(draftId, principalTelegramId, database);
  return database.taskCaptureDraft.update({
    where: { id: draft.id },
    data: { telegramChatId: chatId, telegramReviewMessageId: messageId },
    include: draftInclude,
  });
}

export type ExpiredTaskCaptureDraftCard = {
  id: string;
  telegramChatId: string;
  telegramReviewMessageId: number;
};

export async function expireTaskCaptureDrafts(
  principalTelegramId: string,
  now: Date = new Date(),
  database: PrismaClient = prisma,
): Promise<ExpiredTaskCaptureDraftCard[]> {
  const candidates = await database.taskCaptureDraft.findMany({
    where: {
      principalTelegramId,
      status: { in: [...activeStatuses] },
      expiresAt: { lte: now },
    },
    select: { id: true, telegramChatId: true, telegramReviewMessageId: true },
    orderBy: { expiresAt: "asc" },
    take: 50,
  });
  const expired: ExpiredTaskCaptureDraftCard[] = [];
  for (const candidate of candidates) {
    const claimed = await database.taskCaptureDraft.updateMany({
      where: { id: candidate.id, status: { in: [...activeStatuses] }, expiresAt: { lte: now } },
      data: { status: TaskCaptureDraftStatus.EXPIRED },
    });
    if (claimed.count && candidate.telegramChatId && candidate.telegramReviewMessageId) {
      expired.push({
        id: candidate.id,
        telegramChatId: candidate.telegramChatId,
        telegramReviewMessageId: candidate.telegramReviewMessageId,
      });
    }
  }
  return expired;
}

export async function appendTaskCaptureDraft(
  draftId: string,
  principalTelegramId: string,
  sourceText: string,
  options: { moduleId?: string; studyItemType?: StudyItemType; now?: Date } = {},
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await requireEditableDraft(draftId, principalTelegramId, database);
  const now = options.now ?? new Date();
  const parsed = parseDraftItems(sourceText, draft.timezone, now, options.moduleId, options.studyItemType, draft.scope);
  if (!parsed.length) throw new TaskCaptureDraftError("Add at least one task.", "invalid");
  if (draft.items.length + parsed.length > TASK_CAPTURE_DRAFT_LIMIT) {
    throw new TaskCaptureDraftError(`A draft can contain at most ${TASK_CAPTURE_DRAFT_LIMIT} tasks.`, "invalid");
  }
  const nextPosition = Math.max(0, ...draft.items.map((item) => item.position)) + 1;
  return database.taskCaptureDraft.update({
    where: { id: draft.id },
    data: {
      sourceText: `${draft.sourceText}\n${sourceText.trim()}`,
      status: TaskCaptureDraftStatus.COLLECTING,
      expiresAt: new Date(now.getTime() + TASK_CAPTURE_DRAFT_TTL_MS),
      items: { create: parsed.map((item, index) => ({ ...item, position: nextPosition + index })) },
    },
    include: draftInclude,
  });
}

export async function reviewTaskCaptureDraft(
  draftId: string,
  principalTelegramId: string,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await requireEditableDraft(draftId, principalTelegramId, database);
  return database.taskCaptureDraft.update({
    where: { id: draft.id },
    data: { status: TaskCaptureDraftStatus.REVIEWING, expiresAt: new Date(Date.now() + TASK_CAPTURE_DRAFT_TTL_MS) },
    include: draftInclude,
  });
}

export async function updateTaskCaptureDraftItem(
  draftId: string,
  itemId: string,
  principalTelegramId: string,
  patch: DraftItemPatch,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await requireEditableDraft(draftId, principalTelegramId, database);
  const item = draft.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new TaskCaptureDraftError("That draft item no longer exists.", "not_found");
  const title = patch.title?.trim();
  if (patch.title !== undefined && !title) throw new TaskCaptureDraftError("Give the task a title.", "invalid");
  const assignees = patch.assignees ? normalizeAssignees(patch.assignees) : undefined;
  let warnings = patch.resolveWarnings ? [] : [...item.warnings];
  if (!patch.resolveWarnings && patch.moduleId) warnings = warnings.filter((warning) => warning !== "STUDY_MODULE_REQUIRED");
  if (!patch.resolveWarnings && (patch.plannedFor !== undefined || patch.dueAt !== undefined)) {
    warnings = warnings.filter((warning) => warning !== "AMBIGUOUS_BARE_DATE");
  }
  await database.taskCaptureDraftItem.update({
    where: { id: item.id },
    data: {
      ...(title ? { title: title.slice(0, 500) } : {}),
      ...(patch.plannedFor !== undefined ? { plannedFor: patch.plannedFor } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      ...(patch.moduleId !== undefined ? { moduleId: patch.moduleId } : {}),
      ...(patch.studyItemType !== undefined ? { studyItemType: patch.studyItemType } : {}),
      ...(assignees ? { assignees: assignees as Prisma.InputJsonValue } : {}),
      ...(patch.teamOwnerLabel !== undefined ? { teamOwnerLabel: patch.teamOwnerLabel?.trim().slice(0, 120) || null } : {}),
      ...(patch.linkedTaskId !== undefined ? { linkedTaskId: patch.linkedTaskId } : {}),
      ...(patch.linkedStudyItemId !== undefined ? { linkedStudyItemId: patch.linkedStudyItemId } : {}),
      ...(patch.included !== undefined ? { included: patch.included } : {}),
      ...(patch.resolveWarnings || patch.moduleId || patch.plannedFor !== undefined || patch.dueAt !== undefined ? {
        warnings,
        status: warnings.length ? TaskCaptureDraftItemStatus.NEEDS_REVIEW : TaskCaptureDraftItemStatus.READY,
      } : {}),
    },
  });
  return database.taskCaptureDraft.update({
    where: { id: draft.id },
    data: { status: TaskCaptureDraftStatus.REVIEWING, expiresAt: new Date(Date.now() + TASK_CAPTURE_DRAFT_TTL_MS) },
    include: draftInclude,
  });
}

export async function cancelTaskCaptureDraft(
  draftId: string,
  principalTelegramId: string,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await getTaskCaptureDraft(draftId, principalTelegramId, database);
  if (draft.status === TaskCaptureDraftStatus.COMMITTED) throw new TaskCaptureDraftError("That draft was already saved.", "conflict");
  return database.taskCaptureDraft.update({
    where: { id: draft.id },
    data: { status: TaskCaptureDraftStatus.CANCELED, canceledAt: new Date() },
    include: draftInclude,
  });
}

export async function commitTaskCaptureDraft(
  draftId: string,
  principalTelegramId: string,
  database: PrismaClient = prisma,
): Promise<TaskCaptureDraftRecord> {
  const draft = await requireEditableDraft(draftId, principalTelegramId, database);
  const included = draft.items.filter((item) => item.included);
  if (!included.length) throw new TaskCaptureDraftError("Keep at least one task in the draft.", "invalid");
  if (included.some((item) => item.status === TaskCaptureDraftItemStatus.NEEDS_REVIEW || item.warnings.length)) {
    throw new TaskCaptureDraftError("Review the highlighted dates or reminder requests before saving.", "conflict");
  }

  return database.$transaction(async (tx) => {
    const claimed = await tx.taskCaptureDraft.updateMany({
      where: { id: draft.id, principalTelegramId, status: { in: [...activeStatuses] }, expiresAt: { gt: new Date() } },
      data: { status: TaskCaptureDraftStatus.COMMITTING },
    });
    if (claimed.count !== 1) throw new TaskCaptureDraftError("That draft changed or expired. Review it again.", "conflict");
    if (draft.scope === PlanningScope.STUDY) {
      await commitStudyItems(tx, draft, included);
    } else {
      await commitTasks(tx, draft, included);
    }
    return tx.taskCaptureDraft.update({
      where: { id: draft.id },
      data: { status: TaskCaptureDraftStatus.COMMITTED, committedAt: new Date() },
      include: draftInclude,
    });
  });
}

async function requireEditableDraft(draftId: string, principalTelegramId: string, database: PrismaClient): Promise<TaskCaptureDraftRecord> {
  const draft = await getTaskCaptureDraft(draftId, principalTelegramId, database);
  if (draft.status === TaskCaptureDraftStatus.EXPIRED) throw new TaskCaptureDraftError("That task draft expired. Start a new list.", "expired");
  if (!activeStatuses.includes(draft.status as typeof activeStatuses[number])) {
    throw new TaskCaptureDraftError("That task draft can no longer be edited.", "conflict");
  }
  return draft;
}

function parseDraftItems(sourceText: string, timezone: string, now: Date, moduleId?: string, studyItemType?: StudyItemType, scope?: PlanningScope) {
  return splitTaskDraftText(sourceText).map((part, index) => {
    const intent = parseTaskTimingIntent(part, timezone, now);
    const warnings = scope === PlanningScope.STUDY && !moduleId
      ? [...intent.warnings, "STUDY_MODULE_REQUIRED"]
      : intent.warnings;
    return {
      position: index + 1,
      title: intent.title,
      sourceText: intent.sourceText,
      plannedFor: intent.plannedFor,
      dueAt: intent.dueAt,
      moduleId,
      studyItemType,
      warnings,
      status: warnings.length ? TaskCaptureDraftItemStatus.NEEDS_REVIEW : TaskCaptureDraftItemStatus.READY,
    };
  });
}

function validateScope(scope: TaskCaptureScope): void {
  const valid = scope.scope === PlanningScope.PERSONAL
    ? !scope.groupWorkspaceId && !scope.studyWorkspaceId
    : scope.scope === PlanningScope.GROUP
      ? Boolean(scope.groupWorkspaceId) && !scope.studyWorkspaceId
      : scope.scope === PlanningScope.STUDY
        ? !scope.groupWorkspaceId && Boolean(scope.studyWorkspaceId)
        : false;
  if (!valid) throw new TaskCaptureDraftError("Choose one valid Threadwise workspace for this draft.", "invalid");
}

function normalizeAssignees(input: DraftAssignee[]): DraftAssignee[] {
  if (input.length > 20) throw new TaskCaptureDraftError("Assign at most 20 people.", "invalid");
  const result: DraftAssignee[] = [];
  const keys = new Set<string>();
  for (const candidate of input) {
    const assignee = {
      ...(candidate.telegramId?.trim() ? { telegramId: candidate.telegramId.trim() } : {}),
      ...(candidate.username?.trim() ? { username: candidate.username.trim().replace(/^@/, "") } : {}),
      ...(candidate.displayName?.trim() ? { displayName: candidate.displayName.trim().slice(0, 120) } : {}),
    };
    const key = assigneeKey(assignee);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    result.push(assignee);
  }
  return result;
}

function readAssignees(value: Prisma.JsonValue): DraftAssignee[] {
  return Array.isArray(value)
    ? normalizeAssignees(value.filter((item): item is DraftAssignee => Boolean(item) && typeof item === "object" && !Array.isArray(item)) as DraftAssignee[])
    : [];
}

function assigneeKey(assignee: DraftAssignee): string {
  if (assignee.telegramId) return `id:${assignee.telegramId}`;
  if (assignee.username) return `username:${assignee.username.toLowerCase()}`;
  if (assignee.displayName) return `name:${assignee.displayName.toLowerCase()}`;
  return "";
}

async function nextTaskNumber(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const rows = await tx.task.findMany({ where: { userId, publicId: { startsWith: "TASK-" } }, select: { publicId: true } });
  return rows.reduce((highest, row) => Math.max(highest, Number(row.publicId.match(/^TASK-(\d+)$/)?.[1] ?? 0)), 0) + 1;
}

async function commitTasks(tx: Prisma.TransactionClient, draft: TaskCaptureDraftRecord, items: TaskCaptureDraftRecord["items"]): Promise<void> {
  const settings = await tx.userSettings.findUnique({ where: { userId: draft.ownerUserId } });
  if (!settings) throw new TaskCaptureDraftError("Workspace settings are missing.", "conflict");
  let sequence = await nextTaskNumber(tx, draft.ownerUserId);
  for (const item of items) {
    if (item.linkedStudyItemId) throw new TaskCaptureDraftError("A general task cannot link to Study work.", "invalid");
    if (item.linkedTaskId) {
      const existing = await tx.task.findFirst({ where: { id: item.linkedTaskId, userId: draft.ownerUserId, archivedAt: null } });
      if (!existing) throw new TaskCaptureDraftError("A linked task no longer exists in this workspace.", "conflict");
      const updated = await tx.task.update({
        where: { id: existing.id },
        data: { plannedFor: item.plannedFor, firstPlannedFor: existing.firstPlannedFor ?? item.plannedFor },
      });
      await tx.auditLog.create({ data: { userId: draft.ownerUserId, action: "task.plan.updated", metadata: { taskId: existing.id, publicId: existing.publicId, previousPlannedFor: existing.plannedFor?.toISOString() ?? null, plannedFor: item.plannedFor?.toISOString() ?? null } } });
      await tx.taskCaptureDraftItem.update({ where: { id: item.id }, data: { resultTaskId: updated.id } });
      continue;
    }
    const assignees = readAssignees(item.assignees);
    const primary = assignees[0];
    const publicId = `TASK-${sequence++}`;
    const created = await tx.task.create({
      data: {
        userId: draft.ownerUserId,
        publicId,
        title: item.title,
        description: taskContinuationDescription(item.sourceText),
        sourceText: item.sourceText,
        dueAt: item.dueAt,
        plannedFor: item.plannedFor,
        firstPlannedFor: item.plannedFor,
        timezone: draft.timezone,
        reminderIntervalMinutes: settings.reminderIntervalMinutes,
        // A planned task is not permission to interrupt. Existing reminders
        // remain untouched; new capture-draft tasks start without one.
        nextReminderAt: null,
        audience: assignees.length ? TaskAudience.ASSIGNEES : TaskAudience.UNASSIGNED,
        assignedTelegramId: primary?.telegramId,
        assignedUsername: primary?.username,
        assignedDisplayName: primary?.displayName,
        teamOwnerLabel: item.teamOwnerLabel,
        calendarUrl: item.dueAt ? createGoogleCalendarUrl({ title: item.title, details: item.sourceText, dueAt: item.dueAt, timezone: draft.timezone }) : null,
        assignees: assignees.length ? {
          create: assignees.map((assignee) => ({
            normalizedKey: assigneeKey(assignee),
            telegramId: assignee.telegramId,
            username: assignee.username,
            displayName: assignee.displayName,
            status: TaskAssigneeStatus.ACCEPTED,
            respondedAt: new Date(),
          })),
        } : undefined,
      },
    });
    await recordCreateUndo(tx, draft.ownerUserId, { kind: "task", id: created.id, publicId, title: created.title });
    await tx.taskCaptureDraftItem.update({ where: { id: item.id }, data: { resultTaskId: created.id } });
  }
}

async function commitStudyItems(tx: Prisma.TransactionClient, draft: TaskCaptureDraftRecord, items: TaskCaptureDraftRecord["items"]): Promise<void> {
  if (!draft.studyWorkspaceId) throw new TaskCaptureDraftError("That Study workspace is missing.", "conflict");
  const workspace = await tx.studyWorkspace.findFirst({ where: { id: draft.studyWorkspaceId, ownerUserId: draft.ownerUserId, active: true } });
  if (!workspace) throw new TaskCaptureDraftError("That Study workspace is no longer available.", "conflict");
  const rows = await tx.studyItem.findMany({ where: { workspaceId: workspace.id }, select: { publicId: true } });
  let sequence = rows.reduce((highest, row) => Math.max(highest, Number(row.publicId.match(/^STUDY-(\d+)$/)?.[1] ?? 0)), 0) + 1;
  for (const item of items) {
    if (item.linkedTaskId) throw new TaskCaptureDraftError("Study work cannot link to a general task.", "invalid");
    if (item.linkedStudyItemId) {
      const existing = await tx.studyItem.findFirst({ where: { id: item.linkedStudyItemId, workspaceId: workspace.id } });
      if (!existing) throw new TaskCaptureDraftError("A linked Study item no longer exists in this workspace.", "conflict");
      const updated = await tx.studyItem.update({
        where: { id: existing.id },
        data: { plannedFor: item.plannedFor, firstPlannedFor: existing.firstPlannedFor ?? item.plannedFor },
      });
      await tx.auditLog.create({ data: { userId: draft.ownerUserId, action: "study.item.planned", metadata: { workspaceId: workspace.id, itemId: updated.id, plannedFor: item.plannedFor?.toISOString() ?? null } } });
      await tx.taskCaptureDraftItem.update({ where: { id: item.id }, data: { resultStudyItemId: updated.id } });
      continue;
    }
    if (!item.moduleId) throw new TaskCaptureDraftError("Choose a module for every new Study task.", "conflict");
    const module = await tx.studyModule.findFirst({ where: { id: item.moduleId, workspaceId: workspace.id, active: true } });
    if (!module) throw new TaskCaptureDraftError("A selected module no longer belongs to this Study workspace.", "conflict");
    const publicId = `STUDY-${sequence++}`;
    const created = await tx.studyItem.create({
      data: {
        workspaceId: workspace.id,
        moduleId: module.id,
        publicId,
        type: item.studyItemType ?? StudyItemType.REVISION,
        title: item.title,
        notes: item.sourceText === item.title ? null : item.sourceText,
        status: StudyItemStatus.OPEN,
        priority: StudyPriority.NORMAL,
        dueAt: item.dueAt,
        plannedFor: item.plannedFor,
        firstPlannedFor: item.plannedFor,
      },
    });
    await tx.auditLog.create({ data: { userId: draft.ownerUserId, action: "study.item.created", metadata: { workspaceId: workspace.id, itemId: created.id, publicId, module: module.code, type: created.type } } });
    await tx.taskCaptureDraftItem.update({ where: { id: item.id }, data: { resultStudyItemId: created.id } });
  }
}
