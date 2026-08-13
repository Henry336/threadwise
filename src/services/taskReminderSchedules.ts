import { TaskReminderScheduleStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

export const MAX_CUSTOM_REMINDERS_PER_TASK = 20;
const REMINDER_LEASE_MINUTES = 5;

type ReminderDatabase = PrismaClient | Prisma.TransactionClient;

export function normalizeCustomReminderTimes(values: readonly (string | Date)[], now = new Date()): Date[] {
  const unique = new Map<number, Date>();
  for (const value of values) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new Error("Choose a valid reminder date and time.");
    if (parsed.getTime() <= now.getTime()) throw new Error("Reminder times must be in the future.");
    unique.set(parsed.getTime(), parsed);
  }
  const result = [...unique.values()].sort((left, right) => left.getTime() - right.getTime());
  if (result.length > MAX_CUSTOM_REMINDERS_PER_TASK) {
    throw new Error(`A task can have up to ${MAX_CUSTOM_REMINDERS_PER_TASK} custom reminders.`);
  }
  return result;
}

export async function replacePendingTaskReminderSchedules(
  database: ReminderDatabase,
  userId: string,
  taskId: string,
  scheduledTimes: readonly Date[],
): Promise<void> {
  await database.taskReminderSchedule.updateMany({
    where: {
      userId,
      taskId,
      status: { in: [TaskReminderScheduleStatus.PENDING, TaskReminderScheduleStatus.PROCESSING] },
    },
    data: {
      status: TaskReminderScheduleStatus.CANCELED,
      leaseExpiresAt: null,
      taskStateCanceled: false,
    },
  });
  if (!scheduledTimes.length) return;
  await Promise.all(scheduledTimes.map((scheduledAt) => database.taskReminderSchedule.upsert({
    where: { taskId_scheduledAt: { taskId, scheduledAt } },
    update: {
      userId,
      status: TaskReminderScheduleStatus.PENDING,
      leaseExpiresAt: null,
      deliveredAt: null,
      lastError: null,
      taskStateCanceled: false,
    },
    create: { userId, taskId, scheduledAt },
  })));
}

export async function cancelPendingTaskReminderSchedules(
  database: ReminderDatabase,
  taskId: string,
): Promise<void> {
  // Some isolated unit-test transaction doubles intentionally model only the
  // table under test. Production Prisma clients always expose this model.
  if (!(database as ReminderDatabase & { taskReminderSchedule?: unknown }).taskReminderSchedule) return;
  await database.taskReminderSchedule.updateMany({
    where: {
      taskId,
      status: { in: [TaskReminderScheduleStatus.PENDING, TaskReminderScheduleStatus.PROCESSING] },
    },
    data: {
      status: TaskReminderScheduleStatus.CANCELED,
      leaseExpiresAt: null,
      taskStateCanceled: true,
    },
  });
}

export async function restoreFutureTaskReminderSchedules(
  database: ReminderDatabase,
  taskId: string,
  now = new Date(),
): Promise<void> {
  if (!(database as ReminderDatabase & { taskReminderSchedule?: unknown }).taskReminderSchedule) return;
  await database.taskReminderSchedule.updateMany({
    where: {
      taskId,
      status: TaskReminderScheduleStatus.CANCELED,
      taskStateCanceled: true,
      scheduledAt: { gt: now },
    },
    data: {
      status: TaskReminderScheduleStatus.PENDING,
      leaseExpiresAt: null,
      lastError: null,
      taskStateCanceled: false,
    },
  });
}

export async function claimDueTaskReminderSchedules(now = new Date(), limit = 50, database: PrismaClient = prisma) {
  await database.taskReminderSchedule.updateMany({
    where: {
      status: TaskReminderScheduleStatus.PROCESSING,
      leaseExpiresAt: { lte: now },
    },
    data: {
      status: TaskReminderScheduleStatus.PENDING,
      leaseExpiresAt: null,
    },
  });

  const candidates = await database.taskReminderSchedule.findMany({
    where: {
      status: TaskReminderScheduleStatus.PENDING,
      scheduledAt: { lte: now },
      task: { status: "OPEN", archivedAt: null },
    },
    include: {
      task: {
        include: {
          user: { include: { settings: true } },
          assignees: true,
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: Math.max(1, Math.min(limit, 200)),
  });

  const claimed = [];
  for (const candidate of candidates) {
    const result = await database.taskReminderSchedule.updateMany({
      where: { id: candidate.id, status: TaskReminderScheduleStatus.PENDING },
      data: {
        status: TaskReminderScheduleStatus.PROCESSING,
        leaseExpiresAt: new Date(now.getTime() + REMINDER_LEASE_MINUTES * 60_000),
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    if (result.count === 1) claimed.push(candidate);
  }
  return claimed;
}

export async function markTaskReminderScheduleSent(id: string, deliveredAt = new Date()): Promise<void> {
  await prisma.taskReminderSchedule.update({
    where: { id },
    data: {
      status: TaskReminderScheduleStatus.SENT,
      deliveredAt,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
}

export async function releaseTaskReminderSchedule(id: string, error: unknown): Promise<void> {
  await prisma.taskReminderSchedule.update({
    where: { id },
    data: {
      status: TaskReminderScheduleStatus.PROCESSING,
      leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
      lastError: String(error).slice(0, 1_000),
    },
  });
}

export function customReminderDeliveryKey(scheduleId: string): string {
  return `task-custom:${scheduleId}`;
}
