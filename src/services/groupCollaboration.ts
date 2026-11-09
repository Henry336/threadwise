/**
 * Shared helpers for group task collaboration: who did something, and the
 * group activity feed. Used by the group task handlers in src/bot and by
 * groupTaskPolicy.ts, taskCommands.ts and taskImports.ts.
 */
import { GroupActivityType, Prisma, type PrismaClient } from "@prisma/client";
import type { Context } from "grammy";
import { prisma } from "../db/prisma";

/** The Telegram member who performed a group action, as stored in activity rows. */
export type CollaborationActor = {
  telegramId: string;
  username?: string;
  displayName: string;
};

export type CollaborationTask = Prisma.TaskGetPayload<{ include: { assignees: true } }>;

/**
 * Error with a user-safe message, raised when a group task action is not allowed.
 * Handlers show the message text directly to the member.
 */
export class TaskAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskAssignmentError";
  }
}

/**
 * Builds the actor from the Telegram sender. Throws when Telegram gives no
 * sender, so actions are never unattributed.
 */
export function collaborationActorFromContext(ctx: Context): CollaborationActor {
  if (!ctx.from) throw new TaskAssignmentError("Telegram could not identify who made that request.");
  return {
    telegramId: String(ctx.from.id),
    ...(ctx.from.username ? { username: ctx.from.username } : {}),
    displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || ctx.from.username || "Group member",
  };
}

/**
 * Appends one row to the group workspace's activity feed (shown on the
 * dashboard). Does nothing when the owner has no verified group workspace.
 * The summary is capped at 1,000 characters.
 */
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

/**
 * Logs a "task created" activity entry, but only when the task came from a
 * group chat. Private chats have no shared activity feed.
 */
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
