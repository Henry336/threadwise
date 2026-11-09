import { GroupActivityType, Prisma, type PrismaClient } from "@prisma/client";
import type { Context } from "grammy";
import { prisma } from "../db/prisma";

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
