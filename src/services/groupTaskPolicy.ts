/**
 * Permission rules for shared group tasks: who may complete, snooze, manage
 * (reassign or cancel) and claim a task. Used by the Telegram handlers in src/bot,
 * by taskCommands.ts and by the dashboard collaboration routes, so Telegram and
 * the web apply the same rules.
 */
import { GroupActivityType, TaskAssigneeStatus, TaskAudience, type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { normalizePublicId } from "../utils/text";
import type { CollaborationActor, CollaborationTask } from "./groupCollaboration";
import { assigneeKey } from "./tasks";

/** How the member relates to the task, used to pick the right buttons and copy. */
export type GroupTaskAudience = "unassigned" | "everyone" | "assignee" | "manager" | "other";
export type GroupTaskAction = "complete" | "snooze" | "manage";

export type GroupTaskAccess = {
  task: CollaborationTask;
  workspaceId: string;
  audience: GroupTaskAudience;
  isAssignee: boolean;
  isCreator: boolean;
  isManager: boolean;
  canComplete: boolean;
  canSnooze: boolean;
  canManage: boolean;
  canClaim: boolean;
};

/** Refusal with a user-safe message. Handlers show the text to the member as is. */
export class GroupTaskPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupTaskPermissionError";
  }
}

/**
 * Works out what this member may do with one task in the owner's group workspace.
 * The creator comes from the first TASK_CREATED activity row (falling back to the
 * workspace owner for older tasks). Assignees and "Everyone" tasks may complete
 * and snooze; only the creator or a group admin (isManager) may manage.
 */
export async function getGroupTaskAccess(
  ownerUserId: string,
  reference: string,
  actor: CollaborationActor,
  isManager: boolean,
  database: PrismaClient = prisma,
): Promise<GroupTaskAccess> {
  const workspace = await database.groupWorkspace.findUnique({
    where: { ownerUserId },
    select: { id: true, ownerUser: { select: { telegramId: true } } },
  });
  if (!workspace) throw new GroupTaskPermissionError("That shared workspace is no longer available.");

  const normalized = normalizePublicId(reference);
  const task = await database.task.findFirst({
    where: { userId: ownerUserId, archivedAt: null, OR: [{ id: reference }, { publicId: normalized }] },
    include: { assignees: { orderBy: { createdAt: "asc" } } },
  });
  if (!task) throw new GroupTaskPermissionError("That shared task no longer exists. Open the latest task list and try again.");

  const created = await database.groupActivity.findFirst({
    where: { workspaceId: workspace.id, taskPublicId: task.publicId, type: GroupActivityType.TASK_CREATED },
    orderBy: { createdAt: "asc" },
    select: { actorTelegramId: true },
  });
  const isCreator = (created?.actorTelegramId ?? workspace.ownerUser.telegramId) === actor.telegramId;
  const everyone = task.audience === TaskAudience.EVERYONE;
  const isAssignee = everyone || task.assignees.some((assignee) => assigneeMatchesActor(assignee, actor));
  const unassigned = task.audience === TaskAudience.UNASSIGNED || (!task.audience && task.assignees.length === 0);
  const canManage = isManager || isCreator;
  const audience: GroupTaskAudience = everyone
    ? "everyone"
    : unassigned
    ? "unassigned"
    : isAssignee
      ? "assignee"
      : canManage
        ? "manager"
        : "other";

  return {
    task,
    workspaceId: workspace.id,
    audience,
    isAssignee,
    isCreator,
    isManager,
    canComplete: canManage || isAssignee,
    canSnooze: canManage || isAssignee,
    canManage,
    canClaim: unassigned,
  };
}

/**
 * Same check as getGroupTaskAccess, but throws GroupTaskPermissionError when the
 * requested action is not allowed.
 */
export async function assertGroupTaskAction(
  ownerUserId: string,
  reference: string,
  actor: CollaborationActor,
  isManager: boolean,
  action: GroupTaskAction,
  database: PrismaClient = prisma,
): Promise<GroupTaskAccess> {
  const access = await getGroupTaskAccess(ownerUserId, reference, actor, isManager, database);
  const allowed = action === "complete" ? access.canComplete : action === "snooze" ? access.canSnooze : access.canManage;
  if (!allowed) {
    throw new GroupTaskPermissionError(
      action === "manage"
        ? "Only the task creator or a current Telegram group administrator can change its assignment."
        : `Only an assignee, the task creator, or a current Telegram group administrator can ${action} this task.`,
    );
  }
  return access;
}

/**
 * Lets a member take an unassigned task. Runs in a transaction and the update is
 * conditional on the task still being unassigned, so two members pressing Claim
 * at the same time cannot both win. Also writes the assignee row and an activity entry.
 */
export async function claimGroupTask(
  ownerUserId: string,
  reference: string,
  actor: CollaborationActor,
  database: PrismaClient = prisma,
): Promise<CollaborationTask> {
  const access = await getGroupTaskAccess(ownerUserId, reference, actor, false, database);
  if (!access.canClaim) throw new GroupTaskPermissionError(`${access.task.publicId} has already been assigned.`);
  const now = new Date();

  return database.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({
      where: { id: access.task.id },
      include: { assignees: { orderBy: { createdAt: "asc" } } },
    });
    const currentUnassigned = current.audience === TaskAudience.UNASSIGNED || (!current.audience && current.assignees.length === 0);
    if (!currentUnassigned || current.assignees.length > 0) throw new GroupTaskPermissionError(`${current.publicId} is no longer claimable.`);
    const claimed = await tx.task.updateMany({
      where: { id: current.id, assignedTelegramId: null, audience: TaskAudience.UNASSIGNED },
      data: {
        audience: TaskAudience.ASSIGNEES,
        assignedTelegramId: actor.telegramId,
        assignedUsername: actor.username,
        assignedDisplayName: actor.displayName,
        undatedNudgeCount: 0,
      },
    });
    if (claimed.count !== 1) throw new GroupTaskPermissionError(`${current.publicId} was just claimed by someone else.`);
    await tx.taskAssignee.create({
      data: {
        taskId: current.id,
        normalizedKey: assigneeKey(actor),
        telegramId: actor.telegramId,
        username: actor.username,
        displayName: actor.displayName,
        status: TaskAssigneeStatus.ACCEPTED,
        respondedAt: now,
      },
    });
    await tx.groupActivity.create({
      data: {
        workspaceId: access.workspaceId,
        actorTelegramId: actor.telegramId,
        actorName: actor.displayName,
        type: GroupActivityType.TASK_ASSIGNED,
        taskPublicId: current.publicId,
        taskTitle: current.title,
        summary: `${actor.displayName} claimed ${current.publicId}.`,
      },
    });
    return tx.task.findUniqueOrThrow({ where: { id: current.id }, include: { assignees: { orderBy: { createdAt: "asc" } } } });
  });
}

/**
 * An assignee matches by Telegram id, or by username (case-insensitive) for
 * assignees stored only by @username without a Telegram id.
 */
function assigneeMatchesActor(
  assignee: { telegramId: string | null; username: string | null },
  actor: CollaborationActor,
): boolean {
  return assignee.telegramId === actor.telegramId
    || Boolean(actor.username && assignee.username?.toLowerCase() === actor.username.toLowerCase());
}
