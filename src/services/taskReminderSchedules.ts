/**
 * Durable custom reminder times for a task (TaskReminderSchedule rows).
 * The dashboard (src/dashboard/data.ts) writes the schedule and tasks.ts cancels or restores it; the reminder loop in reminders.ts
 * claims due rows with a short lease and delivers them, so a restart or a second
 * process cannot lose or double-send a reminder.
 */
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
 * 2, 4, 8, 16, 32, then every six hours. No failure stops a reminder for good.
 */
export function reminderRetryDelayMinutes(attempt: number): number {
  return attempt >= MAX_REMINDER_DELIVERY_ATTEMPTS ? REMINDER_RETRY_CEILING_MINUTES : Math.min(60, 2 ** attempt);
}

type ReminderDatabase = PrismaClient | Prisma.TransactionClient;

/**
 * Validates user-chosen reminder times: each must be a valid future time.
 * Duplicates are dropped, the result is sorted, and the per-task cap applies.
 */
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

/**
 * Replaces a task's not-yet-sent reminders with a new set. Old pending rows are
 * cancelled; matching times are re-opened through the (taskId, scheduledAt)
 * unique key instead of inserting duplicates. Delivered history is untouched.
 */
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

/**
 * Cancels pending reminders because the task was completed, cancelled or archived.
 * taskStateCanceled marks them so restoreFutureTaskReminderSchedules can bring
 * them back if the task is reopened.
 */
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

/**
 * Re-opens reminders that were cancelled only because of a task state change,
 * but only those still in the future. Used when a completed task is restored.
 */
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

/**
 * Claims due reminders for delivery. First it frees rows whose lease expired
 * (a crashed or slow pass), then takes each due row with a conditional update so
 * only one process wins it. Claimed rows are PROCESSING with a five-minute lease.
 */
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
 * used up. A refusal (the user blocked the bot, the bot lost posting rights) goes straight to the
 * six-hour retry: it is cheap, and the reminder resumes on its own once the user unblocks the bot.
 */
export async function releaseTaskReminderSchedule(
  schedule: { id: string; attemptCount: number },
  error: unknown,
  permanent = false,
): Promise<void> {
  const lastError = String(error).slice(0, 1_000);
  await prisma.taskReminderSchedule.update({
    where: { id: schedule.id },
    data: {
      status: TaskReminderScheduleStatus.PROCESSING,
      leaseExpiresAt: new Date(Date.now() + (permanent ? REMINDER_RETRY_CEILING_MINUTES : reminderRetryDelayMinutes(schedule.attemptCount)) * 60_000),
      lastError,
    },
  });
}

/** Dedupe key for the delivery ledger, one per schedule row. */
export function customReminderDeliveryKey(scheduleId: string): string {
  return `task-custom:${scheduleId}`;
}
