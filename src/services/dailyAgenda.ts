import {
  DailyBriefDeliveryStatus,
  DailyBriefKind,
  GroupMemberStatus,
  PlanningScope,
  Prisma,
  type PrismaClient,
  StudyItemStatus,
  TaskStatus,
} from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { calendarDate, calendarDateKey, todayCalendarDate } from "./taskPlanning";
import { completeStudyItem } from "./study";
import { completeTask } from "./tasks";

export type AgendaEntry = {
  id: string;
  publicId: string;
  title: string;
  mode: "INDIVIDUAL" | "GROUP" | "STUDY";
  workspaceId?: string;
  workspaceName?: string;
  moduleId?: string;
  moduleCode?: string;
  plannedFor?: string;
  firstPlannedFor?: string;
  dueAt?: string;
  status: string;
};

export type DailyAgenda = {
  localDate: string;
  timezone: string;
  scope: PlanningScope;
  today: AgendaEntry[];
  carryover: AgendaEntry[];
  dueSoon: AgendaEntry[];
  overdue: AgendaEntry[];
  unscheduledCount: number;
  orderRevision: number;
  reorderable: boolean;
};

export type AgendaScope = {
  principalTelegramId: string;
  scope: PlanningScope;
  groupWorkspaceId?: string;
  studyWorkspaceId?: string;
};

export class DailyAgendaError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "forbidden" | "conflict") {
    super(message);
    this.name = "DailyAgendaError";
  }
}

export async function getDailyAgenda(
  scope: AgendaScope,
  options: { localDate?: string; dueSoonDays?: number } = {},
  database: PrismaClient = prisma,
): Promise<DailyAgenda> {
  const dueSoonDays = options.dueSoonDays ?? 3;
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 1 || dueSoonDays > 30) throw new DailyAgendaError("Choose a deadline window between 1 and 30 days.", "invalid");

  if (scope.scope === PlanningScope.GROUP) {
    if (!scope.groupWorkspaceId) throw new DailyAgendaError("Choose a group workspace.", "invalid");
    return groupAgenda(scope, options.localDate, dueSoonDays, database);
  }
  if (scope.scope === PlanningScope.STUDY) {
    if (!scope.studyWorkspaceId) throw new DailyAgendaError("Choose a Study workspace.", "invalid");
    return studyAgenda(scope, options.localDate, dueSoonDays, database);
  }
  const user = await database.user.findUnique({ where: { telegramId: scope.principalTelegramId }, include: { settings: true } });
  if (!user?.settings) throw new DailyAgendaError("Personal settings are unavailable.", "not_found");
  return personalAgenda(scope.principalTelegramId, user.id, user.settings.timezone, options.localDate, dueSoonDays, database);
}

export async function planDailyAgendaEntry(
  scope: AgendaScope,
  entryId: string,
  plannedFor: string | null,
  database: PrismaClient = prisma,
): Promise<AgendaEntry> {
  const agenda = await getDailyAgenda(scope, { dueSoonDays: 30 }, database);
  const entries = [...agenda.today, ...agenda.carryover, ...agenda.dueSoon, ...agenda.overdue];
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new DailyAgendaError("That item is not available in this Today view.", "not_found");
  const plannedDate = plannedFor === null ? null : parseLocalDate(plannedFor);
  if (entry.mode === "STUDY") {
    await database.$transaction(async (tx) => {
      const [item, workspace] = await Promise.all([
        tx.studyItem.findFirst({ where: { id: entry.id, workspaceId: entry.workspaceId } }),
        tx.studyWorkspace.findFirst({ where: { id: entry.workspaceId, active: true } }),
      ]);
      if (!item || !workspace) throw new DailyAgendaError("That Study item is unavailable.", "not_found");
      await tx.studyItem.update({
        where: { id: item.id },
        data: { plannedFor: plannedDate, firstPlannedFor: item.firstPlannedFor ?? plannedDate },
      });
      await tx.auditLog.create({ data: {
        userId: workspace.ownerUserId,
        action: "study.item.planned",
        metadata: {
          workspaceId: workspace.id,
          itemId: item.id,
          previousPlannedFor: item.plannedFor?.toISOString() ?? null,
          plannedFor: plannedDate?.toISOString() ?? null,
          source: "today",
        },
      } });
    });
  } else {
    await database.$transaction(async (tx) => {
      const task = await tx.task.findFirst({ where: { id: entry.id, archivedAt: null } });
      if (!task) throw new DailyAgendaError("That task is unavailable.", "not_found");
      await tx.task.update({
        where: { id: task.id },
        data: { plannedFor: plannedDate, firstPlannedFor: task.firstPlannedFor ?? plannedDate },
      });
      await tx.auditLog.create({ data: {
        userId: task.userId,
        action: "task.plan.updated",
        metadata: {
          taskId: task.id,
          publicId: task.publicId,
          previousPlannedFor: task.plannedFor?.toISOString() ?? null,
          plannedFor: plannedDate?.toISOString() ?? null,
          source: "today",
        },
      } });
    });
  }
  return { ...entry, ...(plannedFor ? { plannedFor } : { plannedFor: undefined }), firstPlannedFor: entry.firstPlannedFor ?? plannedFor ?? undefined };
}

export async function completeDailyAgendaEntry(
  scope: AgendaScope,
  entryId: string,
  database: PrismaClient = prisma,
): Promise<AgendaEntry> {
  const agenda = await getDailyAgenda(scope, { dueSoonDays: 30 }, database);
  const entries = [...agenda.today, ...agenda.carryover, ...agenda.dueSoon, ...agenda.overdue];
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new DailyAgendaError("That item is not available in this Today view.", "not_found");

  if (entry.mode === "STUDY") {
    const workspace = await database.studyWorkspace.findFirst({
      where: { id: entry.workspaceId, ownerTelegramId: scope.principalTelegramId, active: true },
    });
    if (!workspace) throw new DailyAgendaError("That Study item is unavailable.", "not_found");
    await completeStudyItem(workspace, entry.publicId);
  } else {
    const task = await database.task.findFirst({
      where: { id: entry.id, archivedAt: null },
      select: { userId: true, publicId: true },
    });
    if (!task) throw new DailyAgendaError("That task is unavailable.", "not_found");
    await completeTask(task.userId, task.publicId);
  }

  return { ...entry, status: entry.mode === "STUDY" ? StudyItemStatus.DONE : TaskStatus.DONE };
}

export async function reorderPersonalDailyAgenda(
  scope: AgendaScope,
  input: { localDate: string; orderedEntryIds: string[]; movedEntryId: string; expectedRevision: number },
  database: PrismaClient = prisma,
): Promise<DailyAgenda> {
  if (scope.scope !== PlanningScope.PERSONAL) {
    throw new DailyAgendaError("Manual ordering is available in Personal Today first.", "forbidden");
  }
  const owner = await database.user.findUnique({ where: { telegramId: scope.principalTelegramId }, select: { id: true } });
  if (!owner) throw new DailyAgendaError("Personal settings are unavailable.", "not_found");
  const agenda = await getDailyAgenda(scope, { localDate: input.localDate, dueSoonDays: 30 }, database);
  const currentIds = agenda.today.map((entry) => entry.id);
  const requested = [...new Set(input.orderedEntryIds)];
  if (requested.length !== input.orderedEntryIds.length || requested.length !== currentIds.length) {
    throw new DailyAgendaError("Today changed while you were reordering it. Refresh and try again.", "conflict");
  }
  const currentSet = new Set(currentIds);
  if (!requested.every((id) => currentSet.has(id)) || !currentSet.has(input.movedEntryId)) {
    throw new DailyAgendaError("Today changed while you were reordering it. Refresh and try again.", "conflict");
  }
  const unchangedCurrent = currentIds.filter((id) => id !== input.movedEntryId);
  const unchangedRequested = requested.filter((id) => id !== input.movedEntryId);
  if (unchangedCurrent.some((id, index) => unchangedRequested[index] !== id)) {
    throw new DailyAgendaError("Move one Today item at a time.", "invalid");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision !== agenda.orderRevision) {
    throw new DailyAgendaError("Today was reordered elsewhere. Refresh and try again.", "conflict");
  }

  const localDate = parseLocalDate(input.localDate);
  await database.$transaction(async (tx) => {
    await tx.dailyAgendaOrderState.deleteMany({
      where: {
        ownerUserId: owner.id,
        localDate: { lt: DateTime.fromISO(input.localDate).minus({ days: 90 }).toJSDate() },
      },
    });
    const state = await tx.dailyAgendaOrderState.upsert({
      where: { ownerUserId_localDate: { ownerUserId: owner.id, localDate } },
      update: {},
      create: { ownerUserId: owner.id, localDate },
      include: { items: true },
    });
    const revision = await tx.dailyAgendaOrderState.updateMany({
      where: { id: state.id, revision: input.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (revision.count !== 1) throw new DailyAgendaError("Today was reordered elsewhere. Refresh and try again.", "conflict");

    await tx.dailyAgendaOrderItem.deleteMany({ where: { stateId: state.id, entryId: { notIn: requested } } });
    const existingRanks = new Map(state.items.map((item) => [item.entryId, item.rank]));
    const movedIndex = requested.indexOf(input.movedEntryId);
    const previousId = requested[movedIndex - 1];
    const nextId = requested[movedIndex + 1];
    const previousRank = previousId ? existingRanks.get(previousId) : undefined;
    const nextRank = nextId ? existingRanks.get(nextId) : undefined;
    const completeExistingOrder = requested
      .filter((id) => id !== input.movedEntryId)
      .every((id) => existingRanks.has(id));
    const sparseRank = completeExistingOrder
      ? previousRank === undefined && nextRank === undefined
        ? 1_024
        : previousRank === undefined
          ? nextRank! - 1_024
          : nextRank === undefined
            ? previousRank + 1_024
            : (previousRank + nextRank) / 2
      : undefined;
    const canUpdateOne = sparseRank !== undefined
      && Number.isFinite(sparseRank)
      && (previousRank === undefined || sparseRank - previousRank > 1e-7)
      && (nextRank === undefined || nextRank - sparseRank > 1e-7);

    if (canUpdateOne) {
      await tx.dailyAgendaOrderItem.upsert({
        where: { stateId_entryId: { stateId: state.id, entryId: input.movedEntryId } },
        update: { rank: sparseRank },
        create: { stateId: state.id, entryId: input.movedEntryId, rank: sparseRank },
      });
    } else {
      for (const [index, entryId] of requested.entries()) {
        const rank = (index + 1) * 1_024;
        await tx.dailyAgendaOrderItem.upsert({
          where: { stateId_entryId: { stateId: state.id, entryId } },
          update: { rank },
          create: { stateId: state.id, entryId, rank },
        });
      }
    }
    await tx.auditLog.create({ data: {
      userId: owner.id,
      action: "today.personal.reordered",
      metadata: { localDate: input.localDate, movedEntryId: input.movedEntryId, revision: input.expectedRevision + 1 },
    } });
  });
  return getDailyAgenda(scope, { localDate: input.localDate }, database);
}

export async function claimDailyBriefDelivery(
  input: {
    userId: string;
    recipientTelegramId: string;
    localDate: Date;
    kind: DailyBriefKind;
    scope: PlanningScope;
    scopeKey: string;
    contentHash?: string;
  },
  database: PrismaClient = prisma,
): Promise<{ claimed: boolean; delivery: { id: string; status: DailyBriefDeliveryStatus } }> {
  try {
    const delivery = await database.dailyBriefDelivery.create({
      data: { ...input, status: DailyBriefDeliveryStatus.PENDING },
      select: { id: true, status: true },
    });
    return { claimed: true, delivery };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const delivery = await database.dailyBriefDelivery.findUniqueOrThrow({
      where: {
        recipientTelegramId_localDate_kind_scopeKey: {
          recipientTelegramId: input.recipientTelegramId,
          localDate: input.localDate,
          kind: input.kind,
          scopeKey: input.scopeKey,
        },
      },
      select: { id: true, status: true },
    });
    return { claimed: false, delivery };
  }
}

export async function finishDailyBriefDelivery(
  deliveryId: string,
  outcome: { status: Extract<DailyBriefDeliveryStatus, "SENT" | "SKIPPED" | "FAILED">; error?: string },
  database: PrismaClient = prisma,
) {
  return database.dailyBriefDelivery.update({
    where: { id: deliveryId },
    data: {
      status: outcome.status,
      deliveredAt: outcome.status === DailyBriefDeliveryStatus.SENT ? new Date() : null,
      lastError: outcome.error?.slice(0, 1_000) ?? null,
    },
  });
}

export async function countDailyAgendaCompletions(
  principalTelegramId: string,
  timezone: string,
  localDate: string,
  database: PrismaClient = prisma,
): Promise<number> {
  const user = await database.user.findUnique({ where: { telegramId: principalTelegramId }, select: { id: true } });
  if (!user) return 0;
  const day = DateTime.fromISO(localDate, { zone: timezone }).startOf("day");
  if (!day.isValid) throw new DailyAgendaError("Choose a valid local date.", "invalid");
  const completedAt = { gte: day.toUTC().toJSDate(), lt: day.plus({ days: 1 }).toUTC().toJSDate() };
  const memberships = await database.groupMembership.findMany({
    where: { telegramId: principalTelegramId, status: GroupMemberStatus.ACTIVE, workspace: { isActive: true } },
    select: { workspace: { select: { ownerUserId: true } } },
  });
  const groupOwners = memberships.map((membership) => membership.workspace.ownerUserId);
  const studyWorkspace = await database.studyWorkspace.findFirst({
    where: { ownerTelegramId: principalTelegramId, active: true },
    select: { id: true },
  });
  const [personal, assigned, study] = await Promise.all([
    database.task.count({ where: { userId: user.id, completedAt } }),
    groupOwners.length ? database.task.count({
      where: {
        userId: { in: groupOwners },
        completedAt,
        OR: [
          { assignedTelegramId: principalTelegramId },
          { assignees: { some: { telegramId: principalTelegramId } } },
        ],
      },
    }) : Promise.resolve(0),
    studyWorkspace ? database.studyItem.count({ where: { workspaceId: studyWorkspace.id, completedAt } }) : Promise.resolve(0),
  ]);
  return personal + assigned + study;
}

async function personalAgenda(
  principalTelegramId: string,
  userId: string,
  timezone: string,
  requestedDate: string | undefined,
  dueSoonDays: number,
  database: PrismaClient,
): Promise<DailyAgenda> {
  const memberships = await database.groupMembership.findMany({
    where: { telegramId: principalTelegramId, status: GroupMemberStatus.ACTIVE, workspace: { isActive: true } },
    include: { workspace: { select: { id: true, title: true, ownerUserId: true } } },
  });
  const groupOwners = memberships.map((membership) => membership.workspace.ownerUserId);
  const [personalTasks, assignedGroupTasks, studyWorkspace] = await Promise.all([
    database.task.findMany({ where: { userId, status: TaskStatus.OPEN, archivedAt: null } }),
    groupOwners.length
      ? database.task.findMany({
          where: {
            userId: { in: groupOwners },
            status: TaskStatus.OPEN,
            archivedAt: null,
            OR: [
              { assignedTelegramId: principalTelegramId },
              { assignees: { some: { telegramId: principalTelegramId } } },
            ],
          },
        })
      : Promise.resolve([]),
    database.studyWorkspace.findFirst({ where: { ownerTelegramId: principalTelegramId, active: true } }),
  ]);
  const groupByOwner = new Map(memberships.map((membership) => [membership.workspace.ownerUserId, membership.workspace]));
  const taskEntries = [
    ...personalTasks.map((task) => taskEntry(task, "INDIVIDUAL")),
    ...assignedGroupTasks.map((task) => {
      const workspace = groupByOwner.get(task.userId);
      return taskEntry(task, "GROUP", workspace?.id, workspace?.title);
    }),
  ];
  let studyEntries: AgendaEntry[] = [];
  if (studyWorkspace) {
    const items = await database.studyItem.findMany({
      where: { workspaceId: studyWorkspace.id, status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS, StudyItemStatus.PROCESSED] } },
      include: { module: { select: { id: true, code: true } } },
    });
    studyEntries = items.map((item) => studyEntry(item, studyWorkspace.id));
  }
  const agenda = groupAgendaEntries([...taskEntries, ...studyEntries], PlanningScope.PERSONAL, timezone, requestedDate, dueSoonDays);
  const state = await database.dailyAgendaOrderState.findUnique({
    where: { ownerUserId_localDate: { ownerUserId: userId, localDate: parseLocalDate(agenda.localDate) } },
    include: { items: true },
  });
  const ranks = new Map(state?.items.map((item) => [item.entryId, item.rank]) ?? []);
  const orderedToday = [...agenda.today].sort((left, right) => {
    const leftRank = ranks.get(left.id);
    const rightRank = ranks.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return agenda.today.indexOf(left) - agenda.today.indexOf(right);
  });
  return { ...agenda, today: orderedToday, orderRevision: state?.revision ?? 0, reorderable: true };
}

async function groupAgenda(
  scope: AgendaScope,
  requestedDate: string | undefined,
  dueSoonDays: number,
  database: PrismaClient,
): Promise<DailyAgenda> {
  const workspace = await database.groupWorkspace.findFirst({
    where: {
      id: scope.groupWorkspaceId,
      isActive: true,
      members: { some: { telegramId: scope.principalTelegramId, status: GroupMemberStatus.ACTIVE } },
    },
  });
  if (!workspace) throw new DailyAgendaError("That group workspace is unavailable.", "forbidden");
  const tasks = await database.task.findMany({ where: { userId: workspace.ownerUserId, status: TaskStatus.OPEN, archivedAt: null } });
  const ownerSettings = workspace.timezone ? undefined : await database.userSettings.findUnique({ where: { userId: workspace.ownerUserId } });
  return groupAgendaEntries(
    tasks.map((task) => taskEntry(task, "GROUP", workspace.id, workspace.title)),
    PlanningScope.GROUP,
    workspace.timezone || ownerSettings?.timezone || "UTC",
    requestedDate,
    dueSoonDays,
  );
}

async function studyAgenda(
  scope: AgendaScope,
  requestedDate: string | undefined,
  dueSoonDays: number,
  database: PrismaClient,
): Promise<DailyAgenda> {
  const workspace = await database.studyWorkspace.findFirst({
    where: { id: scope.studyWorkspaceId, ownerTelegramId: scope.principalTelegramId, active: true },
  });
  if (!workspace) throw new DailyAgendaError("That Study workspace is unavailable.", "forbidden");
  const items = await database.studyItem.findMany({
    where: { workspaceId: workspace.id, status: { in: [StudyItemStatus.OPEN, StudyItemStatus.IN_PROGRESS, StudyItemStatus.PROCESSED] } },
    include: { module: { select: { id: true, code: true } } },
  });
  return groupAgendaEntries(items.map((item) => studyEntry(item, workspace.id)), PlanningScope.STUDY, workspace.timezone, requestedDate, dueSoonDays);
}

export function groupAgendaEntries(
  entries: AgendaEntry[],
  scope: PlanningScope,
  timezone: string,
  requestedDate: string | undefined,
  dueSoonDays: number,
  now: Date = new Date(),
): DailyAgenda {
  const target = requestedDate ? parseLocalDate(requestedDate) : todayCalendarDate(timezone, now);
  const targetKey = calendarDateKey(target);
  const start = DateTime.fromISO(targetKey, { zone: timezone }).startOf("day");
  if (!start.isValid) throw new DailyAgendaError("Choose a valid local date.", "invalid");
  const dueEnd = start.plus({ days: dueSoonDays + 1 });
  const today = entries.filter((entry) => entry.plannedFor === targetKey);
  const carryover = entries.filter((entry) => Boolean(entry.plannedFor && entry.plannedFor < targetKey));
  const overdue = entries.filter((entry) => Boolean(entry.dueAt && DateTime.fromISO(entry.dueAt) < start));
  const dueSoon = entries.filter((entry) => {
    if (!entry.dueAt) return false;
    const due = DateTime.fromISO(entry.dueAt);
    return due >= start && due < dueEnd;
  });
  const compare = (left: AgendaEntry, right: AgendaEntry) => (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999") || left.title.localeCompare(right.title);
  return {
    localDate: targetKey,
    timezone,
    scope,
    today: [...today].sort(compare),
    carryover: [...carryover].sort((left, right) => (left.plannedFor ?? "").localeCompare(right.plannedFor ?? "") || compare(left, right)),
    dueSoon: [...dueSoon].sort(compare),
    overdue: [...overdue].sort(compare),
    unscheduledCount: entries.filter((entry) => !entry.plannedFor).length,
    orderRevision: 0,
    reorderable: false,
  };
}

function taskEntry(
  task: { id: string; publicId: string; title: string; plannedFor: Date | null; firstPlannedFor: Date | null; dueAt: Date | null; status: TaskStatus },
  mode: "INDIVIDUAL" | "GROUP",
  workspaceId?: string,
  workspaceName?: string,
): AgendaEntry {
  return {
    id: task.id,
    publicId: task.publicId,
    title: task.title,
    mode,
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceName ? { workspaceName } : {}),
    ...(task.plannedFor ? { plannedFor: calendarDateKey(task.plannedFor) } : {}),
    ...(task.firstPlannedFor ? { firstPlannedFor: calendarDateKey(task.firstPlannedFor) } : {}),
    ...(task.dueAt ? { dueAt: task.dueAt.toISOString() } : {}),
    status: task.status,
  };
}

function studyEntry(
  item: { id: string; publicId: string; title: string; plannedFor: Date | null; firstPlannedFor: Date | null; dueAt: Date | null; status: StudyItemStatus; module: { id: string; code: string } },
  workspaceId: string,
): AgendaEntry {
  return {
    id: item.id,
    publicId: item.publicId,
    title: item.title,
    mode: "STUDY",
    workspaceId,
    moduleId: item.module.id,
    moduleCode: item.module.code,
    ...(item.plannedFor ? { plannedFor: calendarDateKey(item.plannedFor) } : {}),
    ...(item.firstPlannedFor ? { firstPlannedFor: calendarDateKey(item.firstPlannedFor) } : {}),
    ...(item.dueAt ? { dueAt: item.dueAt.toISOString() } : {}),
    status: item.status,
  };
}

function parseLocalDate(value: string): Date {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new DailyAgendaError("Use a date such as 2026-08-31.", "invalid");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || calendarDateKey(parsed) !== value) throw new DailyAgendaError("Choose a valid local date.", "invalid");
  return calendarDate(parsed, "UTC");
}
