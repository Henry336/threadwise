import {
  GroupActivityType,
  GroupMemberStatus,
  Prisma,
  TaskAssigneeStatus,
  TaskStatus,
  type PrismaClient,
} from "@prisma/client";
import { Api } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import type { DashboardWorkspaceScope } from "./workspaces";
import { assertWorkspaceManager, DashboardGroupAccessError } from "./workspaces";

const ACTIVITY_LIMIT = 60;

export type DashboardTaskAssignee = {
  id: string;
  telegramId?: string;
  username?: string;
  displayName: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";
  statusReason?: string;
  respondedAt?: string;
  updatedAt: string;
};

export type DashboardGroupMember = {
  telegramId: string;
  username?: string;
  displayName: string;
  initials: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  lastSeenAt: string;
  openTasks: number;
  blockedTasks: number;
  awaitingTasks: number;
};

export type DashboardGroupActivity = {
  id: string;
  type: string;
  actorTelegramId: string;
  actorName: string;
  taskPublicId?: string;
  taskTitle?: string;
  summary: string;
  createdAt: string;
};

export type DashboardGroupCollaboration = {
  viewerTelegramId: string;
  members: DashboardGroupMember[];
  activity: DashboardGroupActivity[];
  summary: {
    overdue: number;
    unassigned: number;
    awaitingAcknowledgement: number;
    blocked: number;
    createdThisWeek: number;
    completedThisWeek: number;
    handoffsThisWeek: number;
  };
};

export type DashboardCollaborationAction = {
  action: "assign" | "unassign" | "accept" | "decline" | "block" | "unblock" | "handoff";
  assigneeId?: string;
  targetTelegramId?: string;
  reason?: string;
};

export type DashboardTaskMutation =
  | { kind: "created" }
  | { kind: "updated"; input: { status?: "OPEN" | "DONE" | "CANCELED"; title?: string; description?: string | null; dueAt?: string | null } };

export async function getDashboardGroupCollaboration(
  scope: DashboardWorkspaceScope,
  database: PrismaClient = prisma,
  now = new Date(),
): Promise<DashboardGroupCollaboration | undefined> {
  if (scope.workspace.kind !== "GROUP") return undefined;
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const workspace = await database.groupWorkspace.findUnique({
    where: { id: scope.workspace.id },
    select: {
      ownerUserId: true,
      members: {
        where: { status: GroupMemberStatus.ACTIVE },
        orderBy: [{ role: "asc" }, { lastSeenAt: "desc" }],
      },
      activity: { orderBy: { createdAt: "desc" }, take: ACTIVITY_LIMIT },
    },
  });
  if (!workspace) throw new DashboardGroupAccessError();

  const tasks = await database.task.findMany({
    where: {
      userId: workspace.ownerUserId,
      archivedAt: null,
      OR: [{ status: TaskStatus.OPEN }, { completedAt: { gte: weekStart } }, { createdAt: { gte: weekStart } }],
    },
    select: {
      dueAt: true,
      status: true,
      createdAt: true,
      completedAt: true,
      assignees: {
        select: { telegramId: true, username: true, status: true },
      },
    },
    take: 1_000,
  });

  const members = workspace.members.map((member) => {
    const assigned = tasks.filter((task) => task.status === TaskStatus.OPEN && task.assignees.some((assignee) => assigneeMatchesMember(assignee, member)));
    const displayName = memberName(member);
    return {
      telegramId: member.telegramId,
      ...(member.username ? { username: member.username } : {}),
      displayName,
      initials: initials(displayName),
      role: member.role,
      lastSeenAt: member.lastSeenAt.toISOString(),
      openTasks: assigned.filter((task) => task.assignees.some((assignee) => assigneeMatchesMember(assignee, member) && assignee.status !== TaskAssigneeStatus.DECLINED)).length,
      blockedTasks: assigned.filter((task) => task.assignees.some((assignee) => assigneeMatchesMember(assignee, member) && assignee.status === TaskAssigneeStatus.BLOCKED)).length,
      awaitingTasks: assigned.filter((task) => task.assignees.some((assignee) => assigneeMatchesMember(assignee, member) && assignee.status === TaskAssigneeStatus.PENDING)).length,
    } satisfies DashboardGroupMember;
  });

  const open = tasks.filter((task) => task.status === TaskStatus.OPEN);
  return {
    viewerTelegramId: scope.principalTelegramId,
    members,
    activity: workspace.activity.map((item) => ({
      id: item.id,
      type: item.type,
      actorTelegramId: item.actorTelegramId,
      actorName: item.actorName,
      ...(item.taskPublicId ? { taskPublicId: item.taskPublicId } : {}),
      ...(item.taskTitle ? { taskTitle: item.taskTitle } : {}),
      summary: item.summary,
      createdAt: item.createdAt.toISOString(),
    })),
    summary: {
      overdue: open.filter((task) => task.dueAt && task.dueAt.getTime() < now.getTime()).length,
      unassigned: open.filter((task) => task.assignees.length === 0 || task.assignees.every((item) => item.status === TaskAssigneeStatus.DECLINED)).length,
      awaitingAcknowledgement: open.filter((task) => task.assignees.some((item) => item.status === TaskAssigneeStatus.PENDING)).length,
      blocked: open.filter((task) => task.assignees.some((item) => item.status === TaskAssigneeStatus.BLOCKED)).length,
      createdThisWeek: tasks.filter((task) => task.createdAt >= weekStart).length,
      completedThisWeek: tasks.filter((task) => task.completedAt && task.completedAt >= weekStart).length,
      handoffsThisWeek: workspace.activity.filter((item) => item.type === GroupActivityType.TASK_HANDED_OFF && item.createdAt >= weekStart).length,
    },
  };
}

export async function updateDashboardTaskCollaboration(
  scope: DashboardWorkspaceScope,
  taskReference: string,
  input: DashboardCollaborationAction,
  botToken?: string,
  database: PrismaClient = prisma,
): Promise<{ updated: true }> {
  if (scope.workspace.kind !== "GROUP") throw new DashboardGroupAccessError("Task collaboration is available in shared group workspaces.");
  const workspace = await database.groupWorkspace.findUnique({
    where: { id: scope.workspace.id },
    include: {
      ownerUser: { select: { id: true } },
      members: { where: { status: GroupMemberStatus.ACTIVE } },
    },
  });
  if (!workspace) throw new DashboardGroupAccessError();
  const actor = workspace.members.find((member) => member.telegramId === scope.principalTelegramId);
  if (!actor) throw new DashboardGroupAccessError();
  const task = await database.task.findFirst({
    where: {
      userId: workspace.ownerUser.id,
      archivedAt: null,
      OR: [{ id: taskReference }, { publicId: taskReference.toUpperCase() }],
    },
    include: { assignees: { orderBy: { createdAt: "asc" } } },
  });
  if (!task) throw new DashboardGroupAccessError("That shared task no longer exists.");

  const actorName = memberName(actor);
  const now = new Date();
  const reason = input.reason?.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
  let bridgeMessage = "";
  const assignment = input.action === "assign"
    ? undefined
    : input.assigneeId
      ? task.assignees.find((item) => item.id === input.assigneeId)
      : task.assignees.find((item) => assigneeIsActor(item, actor));

  if (input.action === "assign") {
    await assertWorkspaceManager(scope, botToken);
  } else {
    if (!assignment) throw new DashboardGroupAccessError("That assignment no longer exists.");
    if (!assigneeIsActor(assignment, actor)) await assertWorkspaceManager(scope, botToken);
  }

  await database.$transaction(async (tx) => {
    if (input.action === "assign") {
      const target = targetMember(workspace.members, input.targetTelegramId);
      await tx.taskAssignee.upsert({
        where: { taskId_normalizedKey: { taskId: task.id, normalizedKey: `id:${target.telegramId}` } },
        update: {
          telegramId: target.telegramId,
          username: target.username,
          displayName: memberName(target),
          status: TaskAssigneeStatus.PENDING,
          statusReason: null,
          respondedAt: null,
        },
        create: {
          taskId: task.id,
          normalizedKey: `id:${target.telegramId}`,
          telegramId: target.telegramId,
          username: target.username,
          displayName: memberName(target),
        },
      });
      bridgeMessage = `${actorName} assigned ${task.publicId} to ${memberName(target)}.`;
      await createActivity(tx, workspace.id, actor, GroupActivityType.TASK_ASSIGNED, task, bridgeMessage);
    } else {
      if (!assignment) throw new DashboardGroupAccessError("That assignment no longer exists.");

      if (input.action === "unassign") {
        await tx.taskAssignee.delete({ where: { id: assignment.id } });
        bridgeMessage = `${actorName} removed ${assignmentLabel(assignment)} from ${task.publicId}.`;
        await createActivity(tx, workspace.id, actor, GroupActivityType.TASK_UNASSIGNED, task, bridgeMessage);
      } else if (input.action === "handoff") {
        const target = targetMember(workspace.members, input.targetTelegramId);
        await tx.taskAssignee.delete({ where: { id: assignment.id } });
        await tx.taskAssignee.upsert({
          where: { taskId_normalizedKey: { taskId: task.id, normalizedKey: `id:${target.telegramId}` } },
          update: { telegramId: target.telegramId, username: target.username, displayName: memberName(target), status: TaskAssigneeStatus.PENDING, statusReason: null, respondedAt: null },
          create: { taskId: task.id, normalizedKey: `id:${target.telegramId}`, telegramId: target.telegramId, username: target.username, displayName: memberName(target) },
        });
        bridgeMessage = `${actorName} handed ${task.publicId} to ${memberName(target)}${reason ? ` — ${reason}` : ""}.`;
        await createActivity(tx, workspace.id, actor, GroupActivityType.TASK_HANDED_OFF, task, bridgeMessage);
      } else {
        const status = input.action === "accept"
          ? TaskAssigneeStatus.ACCEPTED
          : input.action === "decline"
            ? TaskAssigneeStatus.DECLINED
            : input.action === "block"
              ? TaskAssigneeStatus.BLOCKED
              : TaskAssigneeStatus.ACCEPTED;
        await tx.taskAssignee.update({
          where: { id: assignment.id },
          data: {
            status,
            statusReason: input.action === "block" || input.action === "decline" ? reason ?? null : null,
            respondedAt: now,
            ...(!assignment.telegramId ? { telegramId: actor.telegramId } : {}),
          },
        });
        const verb = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : input.action === "block" ? "blocked" : "unblocked";
        const activityType = input.action === "accept"
          ? GroupActivityType.ASSIGNMENT_ACCEPTED
          : input.action === "decline"
            ? GroupActivityType.ASSIGNMENT_DECLINED
            : input.action === "block"
              ? GroupActivityType.TASK_BLOCKED
              : GroupActivityType.TASK_UNBLOCKED;
        bridgeMessage = `${actorName} ${verb} ${task.publicId}${reason ? ` — ${reason}` : ""}.`;
        await createActivity(tx, workspace.id, actor, activityType, task, bridgeMessage);
      }
    }

    const remaining = await tx.taskAssignee.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    const primary = remaining.find((item) => item.status !== TaskAssigneeStatus.DECLINED) ?? remaining[0];
    await tx.task.update({
      where: { id: task.id },
      data: {
        assignedTelegramId: primary?.telegramId ?? null,
        assignedUsername: primary?.username ?? null,
        assignedDisplayName: primary?.displayName ?? null,
        updatedAt: now,
      },
    });
  });

  await mirrorToTelegram(scope, bridgeMessage, botToken);
  return { updated: true };
}

export async function recordDashboardTaskMutation(
  scope: DashboardWorkspaceScope,
  task: { publicId: string; title: string },
  mutation: DashboardTaskMutation,
  botToken?: string,
  database: PrismaClient = prisma,
): Promise<void> {
  if (scope.workspace.kind !== "GROUP") return;
  const workspace = await database.groupWorkspace.findUnique({
    where: { id: scope.workspace.id },
    include: { members: { where: { status: GroupMemberStatus.ACTIVE } } },
  });
  if (!workspace) throw new DashboardGroupAccessError();
  const actor = workspace.members.find((member) => member.telegramId === scope.principalTelegramId);
  if (!actor) throw new DashboardGroupAccessError();

  const actorName = memberName(actor);
  let type: GroupActivityType = GroupActivityType.TASK_UPDATED;
  let message = `${actorName} updated ${task.publicId}.`;
  if (mutation.kind === "created") {
    type = GroupActivityType.TASK_CREATED;
    message = `${actorName} added ${task.publicId}: ${task.title}.`;
  } else if (mutation.input.status === TaskStatus.DONE) {
    type = GroupActivityType.TASK_COMPLETED;
    message = `${actorName} completed ${task.publicId}.`;
  } else if (mutation.input.status === TaskStatus.OPEN) {
    type = GroupActivityType.TASK_REOPENED;
    message = `${actorName} reopened ${task.publicId}.`;
  } else if (mutation.input.status === TaskStatus.CANCELED) {
    type = GroupActivityType.TASK_ARCHIVED;
    message = `${actorName} closed ${task.publicId}.`;
  } else if (mutation.input.title !== undefined) {
    message = `${actorName} renamed ${task.publicId} to “${task.title}”.`;
  } else if (mutation.input.dueAt !== undefined) {
    message = `${actorName} changed the schedule for ${task.publicId}.`;
  } else if (mutation.input.description !== undefined) {
    message = `${actorName} updated the details on ${task.publicId}.`;
  } else {
    return;
  }

  await createActivity(database, workspace.id, actor, type, task, message);
  await mirrorToTelegram(scope, message, botToken);
}

function memberName(member: { firstName: string | null; lastName: string | null; username: string | null }): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ").trim() || (member.username ? `@${member.username}` : "Group member");
}

function initials(name: string): string {
  return name.replace(/^@/, "").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "TW";
}

function assigneeMatchesMember(
  assignee: { telegramId: string | null; username: string | null },
  member: { telegramId: string; username: string | null },
): boolean {
  return assignee.telegramId === member.telegramId
    || Boolean(member.username && assignee.username?.toLowerCase() === member.username.toLowerCase());
}

function assigneeIsActor(
  assignee: { telegramId: string | null; username: string | null },
  actor: { telegramId: string; username: string | null },
): boolean {
  return assigneeMatchesMember(assignee, actor);
}

function assignmentLabel(assignment: { displayName: string | null; username: string | null }): string {
  return assignment.displayName || (assignment.username ? `@${assignment.username}` : "an assignee");
}

function targetMember<T extends { telegramId: string }>(members: T[], telegramId: string | undefined): T {
  const target = telegramId ? members.find((member) => member.telegramId === telegramId) : undefined;
  if (!target) throw new DashboardGroupAccessError("Choose an active group member.");
  return target;
}

async function createActivity(
  tx: Prisma.TransactionClient | PrismaClient,
  workspaceId: string,
  actor: { telegramId: string; username: string | null; firstName: string | null; lastName: string | null },
  type: GroupActivityType,
  task: { publicId: string; title: string },
  summary: string,
): Promise<void> {
  await tx.groupActivity.create({
    data: {
      workspaceId,
      actorTelegramId: actor.telegramId,
      actorName: memberName(actor),
      type,
      taskPublicId: task.publicId,
      taskTitle: task.title,
      summary: summary.slice(0, 1_000),
    },
  });
}

async function mirrorToTelegram(scope: DashboardWorkspaceScope, message: string, botToken?: string): Promise<void> {
  if (!message || !botToken || !scope.telegramChatId) return;
  try {
    await new Api(botToken).sendMessage(scope.telegramChatId, message, { disable_notification: true });
  } catch (error) {
    logger.warn("Dashboard group update could not be mirrored to Telegram.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      workspaceId: scope.workspace.id,
    });
  }
}
