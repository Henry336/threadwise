import {
  GroupActivityType,
  Prisma,
  TaskAssigneeStatus,
  type PrismaClient,
} from "@prisma/client";
import type { Context } from "grammy";
import { prisma } from "../db/prisma";
import { normalizePublicId } from "../utils/text";
import { parseTaskAssignees, type TaskCreationOptions } from "./tasks";

export type CollaborationActor = {
  telegramId: string;
  username?: string;
  displayName: string;
};

export type CollaborationTask = Prisma.TaskGetPayload<{ include: { assignees: true } }>;

export class TaskAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskAssignmentError";
  }
}

export function collaborationActorFromContext(ctx: Context): CollaborationActor {
  if (!ctx.from) throw new TaskAssignmentError("Telegram could not identify who made that request.");
  return {
    telegramId: String(ctx.from.id),
    ...(ctx.from.username ? { username: ctx.from.username } : {}),
    displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || ctx.from.username || "Group member",
  };
}

export async function setTaskAssignmentStatus(
  userId: string,
  reference: string,
  actor: CollaborationActor,
  status: TaskAssigneeStatus,
  reason?: string,
  database: PrismaClient = prisma,
): Promise<CollaborationTask> {
  const task = await findCollaborationTask(database, userId, reference);
  const assignment = task.assignees.find((item) => assignmentBelongsToActor(item, actor));
  if (!assignment) throw new TaskAssignmentError(`You are not assigned to ${task.publicId}.`);

  const now = new Date();
  const cleanReason = reason?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const activity = activityForStatus(status, cleanReason);

  return database.$transaction(async (tx) => {
    await tx.taskAssignee.update({
      where: { id: assignment.id },
      data: {
        status,
        statusReason: status === TaskAssigneeStatus.BLOCKED || status === TaskAssigneeStatus.DECLINED ? cleanReason : null,
        respondedAt: now,
        ...(assignment.telegramId ? {} : { telegramId: actor.telegramId }),
        ...(!assignment.username && actor.username ? { username: actor.username } : {}),
        ...(!assignment.displayName ? { displayName: actor.displayName } : {}),
      },
    });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: now } });
    await recordActivity(tx, userId, actor, activity.type, task, `${actor.displayName} ${activity.summary} for ${task.publicId}.`);
    return tx.task.findUniqueOrThrow({ where: { id: task.id }, include: { assignees: { orderBy: { createdAt: "asc" } } } });
  });
}

export async function handoffTaskAssignment(
  userId: string,
  reference: string,
  actor: CollaborationActor,
  targetText: string,
  options: TaskCreationOptions = {},
  reason?: string,
  canManage = false,
  database: PrismaClient = prisma,
): Promise<CollaborationTask> {
  const task = await findCollaborationTask(database, userId, reference);
  const current = task.assignees.find((item) => assignmentBelongsToActor(item, actor));
  if (!current && !canManage) throw new TaskAssignmentError(`You are not assigned to ${task.publicId}.`);

  const target = parseTaskAssignees(targetText, options.mentions, true)[0];
  if (!target) throw new TaskAssignmentError("Choose one person to hand this task to.");
  const normalizedKey = target.telegramId
    ? `id:${target.telegramId}`
    : target.username
      ? `username:${target.username.toLowerCase()}`
      : `name:${(target.displayName ?? "unknown").toLowerCase()}`;
  const now = new Date();
  const cleanReason = reason?.replace(/\s+/g, " ").trim().slice(0, 500);
  const source = current ?? task.assignees[0];
  if (!source) throw new TaskAssignmentError(`${task.publicId} is unassigned. Assign it instead of handing it off.`);

  return database.$transaction(async (tx) => {
    await tx.taskAssignee.delete({ where: { id: source.id } });
    await tx.taskAssignee.upsert({
      where: { taskId_normalizedKey: { taskId: task.id, normalizedKey } },
      update: {
        telegramId: target.telegramId,
        username: target.username,
        displayName: target.displayName,
        status: TaskAssigneeStatus.PENDING,
        statusReason: null,
        respondedAt: null,
      },
      create: {
        taskId: task.id,
        normalizedKey,
        telegramId: target.telegramId,
        username: target.username,
        displayName: target.displayName,
      },
    });
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
    const targetName = target.username ? `@${target.username}` : target.displayName ?? "the new assignee";
    await recordActivity(
      tx,
      userId,
      actor,
      GroupActivityType.TASK_HANDED_OFF,
      task,
      `${actor.displayName} handed ${task.publicId} to ${targetName}${cleanReason ? ` — ${cleanReason}` : ""}.`,
    );
    return tx.task.findUniqueOrThrow({ where: { id: task.id }, include: { assignees: { orderBy: { createdAt: "asc" } } } });
  });
}

export async function recordGroupTaskActivity(
  userId: string,
  actor: CollaborationActor,
  type: GroupActivityType,
  task: { publicId: string; title: string },
  summary: string,
  database: PrismaClient = prisma,
): Promise<void> {
  const workspace = await database.groupWorkspace.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
  if (!workspace) return;
  await database.groupActivity.create({
    data: {
      workspaceId: workspace.id,
      actorTelegramId: actor.telegramId,
      actorName: actor.displayName,
      type,
      taskPublicId: task.publicId,
      taskTitle: task.title,
      summary: summary.slice(0, 1_000),
    },
  });
}

export async function recordGroupTaskCreatedFromContext(
  ctx: Context,
  userId: string,
  task: { publicId: string; title: string },
  database: PrismaClient = prisma,
): Promise<void> {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const actor = collaborationActorFromContext(ctx);
  await recordGroupTaskActivity(
    userId,
    actor,
    GroupActivityType.TASK_CREATED,
    task,
    `${actor.displayName} added ${task.publicId}: ${task.title}.`,
    database,
  );
}

function assignmentBelongsToActor(
  assignment: { telegramId: string | null; username: string | null },
  actor: CollaborationActor,
): boolean {
  return assignment.telegramId === actor.telegramId
    || Boolean(actor.username && assignment.username?.toLowerCase() === actor.username.toLowerCase());
}

async function findCollaborationTask(database: PrismaClient, userId: string, reference: string): Promise<CollaborationTask> {
  const normalized = normalizePublicId(reference);
  const task = await database.task.findFirst({
    where: { userId, archivedAt: null, OR: [{ id: reference }, { publicId: normalized }] },
    include: { assignees: { orderBy: { createdAt: "asc" } } },
  });
  if (!task) throw new TaskAssignmentError("I could not find that task.");
  return task;
}

async function recordActivity(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  actor: CollaborationActor,
  type: GroupActivityType,
  task: { publicId: string; title: string },
  summary: string,
): Promise<void> {
  const workspace = await tx.groupWorkspace.findUnique({ where: { ownerUserId }, select: { id: true } });
  if (!workspace) return;
  await tx.groupActivity.create({
    data: {
      workspaceId: workspace.id,
      actorTelegramId: actor.telegramId,
      actorName: actor.displayName,
      type,
      taskPublicId: task.publicId,
      taskTitle: task.title,
      summary: summary.slice(0, 1_000),
    },
  });
}

function activityForStatus(status: TaskAssigneeStatus, reason: string | null): { type: GroupActivityType; summary: string } {
  if (status === TaskAssigneeStatus.ACCEPTED) {
    return { type: GroupActivityType.ASSIGNMENT_ACCEPTED, summary: "accepted the assignment" };
  }
  if (status === TaskAssigneeStatus.DECLINED) {
    return { type: GroupActivityType.ASSIGNMENT_DECLINED, summary: `declined the assignment${reason ? ` — ${reason}` : ""}` };
  }
  if (status === TaskAssigneeStatus.BLOCKED) {
    return { type: GroupActivityType.TASK_BLOCKED, summary: `marked the task blocked${reason ? ` — ${reason}` : ""}` };
  }
  return { type: GroupActivityType.TASK_UPDATED, summary: "updated the assignment" };
}
