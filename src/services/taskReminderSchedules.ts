import { TaskReminderScheduleStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

export const MAX_CUSTOM_REMINDERS_PER_TASK = 20;
const REMINDER_LEASE_MINUTES = 5;
/** After this many failed sends (the Study Calendar cap) retries slow to the ceiling interval. */
export const MAX_REMINDER_DELIVERY_ATTEMPTS = 6;
/** Slow retry interval once the backoff is used up, so an outage never silences a reminder for good. */
export const REMINDER_RETRY_CEILING_MINUTES = 6 * 60;

/**
 * Minutes to wait after failed attempt number `attempt` (1-based): the Study Calendar backoff of
 * 2, 4, 8, 16, 32, then every six hours. Transient failures never stop a reminder; only a
 * permanent Telegram refusal does.
 */
export function reminderRetryDelayMinutes(attempt: number): number {
  return attempt >= MAX_REMINDER_DELIVERY_ATTEMPTS ? REMINDER_RETRY_CEILING_MINUTES : Math.min(60, 2 ** attempt);
}

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
      attemptCount: 0,
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
    // Report the attempt this claim just counted, so a failure knows how many have been made.
    if (result.count === 1) claimed.push({ ...candidate, attemptCount: candidate.attemptCount + 1 });
  }
  return claimed;
}

/**
 * Hands a claimed schedule back after a failed delivery. It is held (still PROCESSING) until the
 * backoff lease expires and is then claimed again, slowing to every six hours once the backoff is
 * used up. Only an error no retry can fix cancels it, so a chat that removed the bot is not
 * retried forever while a Telegram outage cannot lose the reminder.
 */
export async function releaseTaskReminderSchedule(
  schedule: { id: string; attemptCount: number },
  error: unknown,
  permanent = false,
): Promise<void> {
  const lastError = String(error).slice(0, 1_000);
  await prisma.taskReminderSchedule.update({
    where: { id: schedule.id },
    data: permanent
      ? { status: TaskReminderScheduleStatus.CANCELED, leaseExpiresAt: null, lastError }
      : {
        status: TaskReminderScheduleStatus.PROCESSING,
        leaseExpiresAt: new Date(Date.now() + reminderRetryDelayMinutes(schedule.attemptCount) * 60_000),
        lastError,
      },
  });
}

export function customReminderDeliveryKey(scheduleId: string): string {
  return `task-custom:${scheduleId}`;
}
