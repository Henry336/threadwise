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
  const user = await database.user.findUnique({ where: { telegramId: scope.principalTelegramId }, include: { settings: true } });
  if (!user?.settings) throw new DailyAgendaError("Personal settings are unavailable.", "not_found");
  const dueSoonDays = options.dueSoonDays ?? 3;
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 1 || dueSoonDays > 30) throw new DailyAgendaError("Choose a deadline window between 1 and 30 days.", "invalid");

  if (scope.scope === PlanningScope.GROUP) {
    if (!scope.groupWorkspaceId) throw new DailyAgendaError("Choose a group workspace.", "invalid");
    return groupAgenda(scope, user.settings.timezone, options.localDate, dueSoonDays, database);
  }
  if (scope.scope === PlanningScope.STUDY) {
    if (!scope.studyWorkspaceId) throw new DailyAgendaError("Choose a Study workspace.", "invalid");
    return studyAgenda(scope, options.localDate, dueSoonDays, database);
  }
  return personalAgenda(scope.principalTelegramId, user.id, user.settings.timezone, options.localDate, dueSoonDays, database);
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
  return groupAgendaEntries([...taskEntries, ...studyEntries], PlanningScope.PERSONAL, timezone, requestedDate, dueSoonDays);
}

async function groupAgenda(
  scope: AgendaScope,
  fallbackTimezone: string,
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
  return groupAgendaEntries(
    tasks.map((task) => taskEntry(task, "GROUP", workspace.id, workspace.title)),
    PlanningScope.GROUP,
    workspace.timezone || fallbackTimezone,
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
