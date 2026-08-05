import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

type TaskLookupDatabase = Pick<PrismaClient, "task">;

/**
 * Telegram may replace a basic-group ID with a supergroup ID after task cards
 * have already been sent. If both group user rows existed before migration
 * recovery ran, reminder delivery can be repaired while those historical task
 * rows remain attached to the earlier owner. A callback carries the stable task
 * row ID, so accept that owner only when its current reminder destination is
 * the exact chat in which the button was pressed.
 */
export async function resolveGroupTaskCallbackOwner(
  currentUserId: string,
  taskRowId: string,
  currentChatId: string | number,
  database: TaskLookupDatabase = prisma,
): Promise<string> {
  const task = await database.task.findUnique({
    where: { id: taskRowId },
    select: {
      userId: true,
      archivedAt: true,
      user: {
        select: {
          telegramId: true,
          settings: { select: { reminderChatId: true } },
        },
      },
    },
  });
  if (!task || task.archivedAt || task.userId === currentUserId) return currentUserId;

  const chatId = normalizeChatId(currentChatId);
  const ownerDestination = normalizeChatId(task.user.settings?.reminderChatId ?? "");
  const isGroupOwner = task.user.telegramId.startsWith("chat:");
  return isGroupOwner && chatId && ownerDestination === chatId ? task.userId : currentUserId;
}

function normalizeChatId(value: string | number): string {
  return String(value).trim().replace(/^chat:/, "");
}
