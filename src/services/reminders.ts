/**
 * Task reminder engine. A database-driven loop (started in src/main.ts) finds
 * tasks whose nextReminderAt is due and sends them to Telegram; there are no
 * in-memory timers, so a restart loses nothing. It also holds the reminder
 * timing rules (due-date milestones, interval nudges, budgets) used by tasks.ts
 * and settings.ts, and runs the separate Study reminder loop.
 */
import { InlineKeyboard, type Bot } from "grammy";
import { Prisma, RecurrenceRule, ReminderMode, TaskAudience, TaskReminderScheduleStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { formatDateTimeForUser, formatRecurrenceRule, isWithinQuietHours, nextQuietEnd, startOfUserDay } from "../utils/dates";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { field, fieldHtml, joinBlocks, stableChoice } from "../utils/messageFormat";
import { reminderActionsKeyboard } from "../bot/keyboards";
import type { TaskAssigneeInfo } from "./tasks";
import { runStudyReminderPass } from "./studyReminders";
import { runPendingStudyCalendarSyncs } from "./studyCalendar";
import { sendMessageWithChatMigrationRecovery } from "./telegramChatMigrations";
import { claimDueTaskReminderSchedules, customReminderDeliveryKey, releaseTaskReminderSchedule, REMINDER_RETRY_CEILING_MINUTES, reminderRetryDelayMinutes } from "./taskReminderSchedules";
import { startLoop, type StopLoop } from "../utils/loop";

type ReminderTask = Prisma.TaskGetPayload<{
  include: { user: { include: { settings: true } }; assignees: true };
}>;

const GROUP_UNDATED_BATCH_SIZE = 8;
const GROUP_UNDATED_SLOWDOWN_AFTER = 3;
const GROUP_UNDATED_SLOW_INTERVAL_MINUTES = 24 * 60;

export type ReminderRunSource = "initial" | "loop" | "manual";

/**
 * Counters from the latest reminder pass, shown in status replies so delivery
 * problems are visible without reading logs.
 */
export type ReminderDiagnostics = {
  source?: ReminderRunSource;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastError?: string;
  dueTasksFound: number;
  remindersSent: number;
  customRemindersDue?: number;
  customRemindersSent?: number;
  skippedMissingSettings: number;
  deferredForQuietHours: number;
  cappedByDailyLimit: number;
  failedDeliveries: number;
  directNudgesSent: number;
  directNudgesSkipped: number;
  directNudgeFailures: number;
  studyRemindersSent: number;
  studyRemindersFailed: number;
  studyReminderUnsafeChat: boolean;
};

let reminderDiagnostics: ReminderDiagnostics = {
  dueTasksFound: 0,
  remindersSent: 0,
  customRemindersDue: 0,
  customRemindersSent: 0,
  skippedMissingSettings: 0,
  deferredForQuietHours: 0,
  cappedByDailyLimit: 0,
  failedDeliveries: 0,
  directNudgesSent: 0,
  directNudgesSkipped: 0,
  directNudgeFailures: 0,
  studyRemindersSent: 0,
  studyRemindersFailed: 0,
  studyReminderUnsafeChat: false
};
type StudyReminderDiagnostics = Pick<ReminderDiagnostics, "studyRemindersSent" | "studyRemindersFailed" | "studyReminderUnsafeChat">;
let studyDiagnostics: StudyReminderDiagnostics = { studyRemindersSent: 0, studyRemindersFailed: 0, studyReminderUnsafeChat: false };
let activeReminderRun: Promise<ReminderDiagnostics> | undefined;

/** The latest Personal reminder pass, with the latest Study pass's figures from its own loop. */
export function getReminderDiagnostics(): ReminderDiagnostics {
  return { ...reminderDiagnostics, ...studyDiagnostics };
}

/**
 * Runs one reminder pass. If a pass is already running (loop tick and a manual
 * trigger at once), the caller shares that pass instead of starting a second
 * one, so nothing is sent twice.
 */
export async function runReminderPass(bot: Bot, source: ReminderRunSource = "manual"): Promise<ReminderDiagnostics> {
  if (activeReminderRun) {
    return activeReminderRun;
  }

  const run = runReminderPassOnce(bot, source);
  activeReminderRun = run;

  try {
    return await run;
  } finally {
    if (activeReminderRun === run) {
      activeReminderRun = undefined;
    }
  }
}

/**
 * One pass, in this order: exact custom reminder times first, then undated group
 * tasks as one follow-up per group, then digests for DIGEST-mode owners with two
 * or more due tasks, then single reminders for everything else. A task covered by
 * an earlier step is skipped later in the same pass. Takes at most 50 due tasks.
 */
async function runReminderPassOnce(bot: Bot, source: ReminderRunSource): Promise<ReminderDiagnostics> {
  const now = new Date();
  const startedAt = now.toISOString();
  const run: ReminderDiagnostics = {
    source,
    lastStartedAt: startedAt,
    dueTasksFound: 0,
    remindersSent: 0,
    customRemindersDue: 0,
    customRemindersSent: 0,
    skippedMissingSettings: 0,
    deferredForQuietHours: 0,
    cappedByDailyLimit: 0,
    failedDeliveries: 0,
    directNudgesSent: 0,
    directNudgesSkipped: 0,
    directNudgeFailures: 0,
    ...studyDiagnostics
  };

  try {
    const customReminderTaskIds = await sendDueCustomReminderSchedules(bot, now, run);
    const tasks = await prisma.task.findMany({
      where: {
        status: TaskStatus.OPEN,
        archivedAt: null,
        remindersDismissedAt: null,
        nextReminderAt: { lte: now },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }]
      },
      include: {
        user: { include: { settings: true } },
        assignees: true
      },
      take: 50,
      orderBy: { nextReminderAt: "asc" }
    });

    run.dueTasksFound = tasks.length;

    const groupedUndatedTaskIds = new Set<string>();
    const groupedUndatedTasks = new Map<string, ReminderTask[]>();
    for (const task of tasks) {
      if (!task.dueAt && task.user.telegramId.startsWith("chat:") && task.user.settings) {
        groupedUndatedTaskIds.add(task.id);
        const group = groupedUndatedTasks.get(task.userId) ?? [];
        group.push(task);
        groupedUndatedTasks.set(task.userId, group);
      }
    }

    for (const group of groupedUndatedTasks.values()) {
      for (const batch of chunk(group, GROUP_UNDATED_BATCH_SIZE)) {
        await sendGroupUndatedReminderBatch(bot, batch, now, run);
      }
    }

    const digestTaskIds = new Set<string>();
    const digestTasksByUser = new Map<string, ReminderTask[]>();
    for (const task of tasks) {
      if (groupedUndatedTaskIds.has(task.id) || customReminderTaskIds.has(task.id) || !task.dueAt) continue;
      if (task.user.settings?.reminderMode !== ReminderMode.DIGEST) continue;
      const group = digestTasksByUser.get(task.userId) ?? [];
      group.push(task);
      digestTasksByUser.set(task.userId, group);
    }
    for (const group of digestTasksByUser.values()) {
      if (group.length < 2) continue;
      for (const batch of chunk(group, GROUP_UNDATED_BATCH_SIZE)) {
        batch.forEach((task) => digestTaskIds.add(task.id));
        await sendReminderDigestBatch(bot, batch, now, run);
      }
    }

    for (const task of tasks) {
      if (groupedUndatedTaskIds.has(task.id)) continue;
      if (digestTaskIds.has(task.id)) continue;
      if (customReminderTaskIds.has(task.id)) continue;
      const settings = task.user.settings;
      if (!settings) {
        run.skippedMissingSettings += 1;
        logger.warn("Skipping reminder because user settings are missing.", { taskId: task.id });
        continue;
      }

      const isDueNudgeReminder = shouldUseDueNudgePolicy({
        dueAt: task.dueAt,
        dueNudgeMinutes: settings.dueNudgeMinutes,
        now
      });

      await deliverReminder(bot, run, {
        kind: "reminder",
        tasks: [task],
        settings,
        now,
        text: formatReminderMessage(task, settings),
        keyboard: reminderActionsKeyboard(task),
        limits: isDueNudgeReminder ? undefined : {
          countEachTask: false,
          retryCappedAt: () => nextIntervalReminderAt(now, settings.reminderIntervalMinutes),
        },
        replacesPrevious: true,
        record: (sent) => automaticReminderWrites([task], settings, now, sent),
        onFailure: (error) => retryTasksLater([task], now, error),
      });
    }

    run.lastFinishedAt = new Date().toISOString();
    reminderDiagnostics = run;
    return run;
  } catch (error) {
    run.lastFinishedAt = new Date().toISOString();
    run.lastError = String(error);
    reminderDiagnostics = run;
    throw error;
  }
}

/**
 * Delivers claimed custom reminder times (exact times the owner picked). Each schedule is
 * delivered at most once through its delivery key. Returns the ids of tasks reminded here so
 * the automatic pass does not remind them again in the same run.
 */
async function sendDueCustomReminderSchedules(bot: Bot, now: Date, run: ReminderDiagnostics): Promise<Set<string>> {
  const claimed = await claimDueTaskReminderSchedules(now);
  const deliveredTaskIds = new Set<string>();
  run.customRemindersDue = claimed.length;

  for (const schedule of claimed) {
    const task = schedule.task;
    const settings = task.user.settings;
    if (!settings) {
      run.skippedMissingSettings += 1;
      await releaseTaskReminderSchedule(schedule, "Reminder settings are missing.");
      continue;
    }

    const deliveryKey = customReminderDeliveryKey(schedule.id);
    const existing = await prisma.reminderDelivery.findUnique({ where: { deliveryKey } });
    if (existing) {
      await prisma.taskReminderSchedule.update({
        where: { id: schedule.id },
        data: {
          status: TaskReminderScheduleStatus.SENT,
          deliveredAt: existing.sentAt,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      deliveredTaskIds.add(task.id);
      continue;
    }

    const delivered = await deliverReminder(bot, run, {
      kind: "custom reminder",
      tasks: [task],
      settings,
      now,
      text: formatReminderMessage(task, settings),
      keyboard: reminderActionsKeyboard(task),
      // The owner chose this exact time, so quiet hours and the daily cap do not apply.
      limits: undefined,
      replacesPrevious: true,
      record: (sent) => {
        const sentAt = new Date();
        return [
          prisma.reminderDelivery.create({
            data: { userId: task.userId, taskId: task.id, chatId: sent.chatId, messageId: sent.messageId, deliveryKey, sentAt },
          }),
          prisma.taskReminderSchedule.update({
            where: { id: schedule.id },
            data: { status: TaskReminderScheduleStatus.SENT, deliveredAt: sentAt, leaseExpiresAt: null, lastError: null },
          }),
          prisma.task.update({
            where: { id: task.id },
            data: {
              lastRemindedAt: sentAt,
              reminderCount: { increment: 1 },
              ...nextTaskScheduleAfterDelivery({
                now: sentAt,
                dueAt: task.dueAt,
                dueNudgeMinutes: settings.dueNudgeMinutes,
                intervalMinutes: settings.reminderIntervalMinutes,
              }),
            },
          }),
        ];
      },
      onFailure: (error) => releaseTaskReminderSchedule(schedule, error, isPermanentTelegramDeliveryError(error)),
    });
    if (delivered) {
      deliveredTaskIds.add(task.id);
      run.customRemindersSent = (run.customRemindersSent ?? 0) + 1;
    }
  }

  return deliveredTaskIds;
}

/** Sends one digest for a DIGEST-mode owner's due tasks; a task in its due-nudge window lifts the limits. */
async function sendReminderDigestBatch(
  bot: Bot,
  tasks: ReminderTask[],
  now: Date,
  run: ReminderDiagnostics,
): Promise<void> {
  const settings = tasks[0]?.user.settings;
  if (!settings) return;
  const bypassLimits = tasks.some((task) => shouldUseDueNudgePolicy({
    dueAt: task.dueAt,
    dueNudgeMinutes: settings.dueNudgeMinutes,
    now,
  }));
  await deliverReminder(bot, run, {
    kind: "reminder digest",
    tasks,
    settings,
    now,
    text: formatReminderDigest(tasks, settings.timezone),
    keyboard: reminderDigestKeyboard(tasks),
    limits: bypassLimits ? undefined : { countEachTask: false, retryCappedAt: () => nextIntervalReminderAt(now, 60) },
    replacesPrevious: false,
    record: (sent) => automaticReminderWrites(tasks, settings, now, sent),
    onFailure: (error) => retryTasksLater(tasks, now, error),
  });
}

/** Sends one follow-up for a group's undated tasks, slowing to daily once they have been ignored three times. */
async function sendGroupUndatedReminderBatch(
  bot: Bot,
  tasks: ReminderTask[],
  now: Date,
  run: ReminderDiagnostics
): Promise<void> {
  const settings = tasks[0]?.user.settings;
  if (!settings) {
    run.skippedMissingSettings += tasks.length;
    return;
  }

  await deliverReminder(bot, run, {
    kind: "undated group reminder digest",
    tasks,
    settings,
    now,
    text: formatGroupUndatedReminderDigest(tasks),
    keyboard: reminderDigestKeyboard(tasks),
    limits: {
      countEachTask: true,
      retryCappedAt: (task) => nextIntervalReminderAt(
        now,
        nextUndatedGroupReminderInterval(settings.reminderIntervalMinutes, task.undatedNudgeCount)
      ),
    },
    replacesPrevious: true,
    record: (sent) => tasks.flatMap((task) => {
      const nextCount = task.undatedNudgeCount + 1;
      const nextInterval = nextUndatedGroupReminderInterval(settings.reminderIntervalMinutes, nextCount);
      const automaticCount = task.automaticReminderCount + 1;
      const nextReminderAt = automaticCount >= Math.min(3, task.automaticReminderBudget)
        ? null
        : nextIntervalReminderAt(now, nextInterval);
      return [
        prisma.reminderDelivery.create({
          data: { userId: task.userId, taskId: task.id, chatId: sent.chatId, messageId: sent.messageId }
        }),
        prisma.task.update({
          where: { id: task.id },
          data: {
            lastRemindedAt: now,
            reminderCount: { increment: 1 },
            automaticReminderCount: { increment: 1 },
            undatedNudgeCount: nextCount,
            reminderIntervalMinutes: settings.reminderIntervalMinutes,
            nextReminderAt,
          }
        })
      ];
    }),
    onFailure: (error) => retryTasksLater(tasks, now, error),
  });
}

type ReminderSettings = NonNullable<ReminderTask["user"]["settings"]>;

/** One reminder message and the rules for sending it, supplied by each reminder kind. */
type ReminderDelivery = {
  /** Names the reminder kind in logs. */
  kind: string;
  /** The tasks this one message covers; all belong to the same owner. */
  tasks: ReminderTask[];
  settings: ReminderSettings;
  now: Date;
  text: string;
  keyboard: InlineKeyboard;
  /**
   * Quiet hours and the daily cap. Undefined when they do not apply: an explicit
   * custom time, or a deadline inside its due-nudge window.
   */
  limits?: {
    /** Count each task (not the message) in the quiet-hours and cap diagnostics. */
    countEachTask: boolean;
    /** When a task held back by the daily cap should be tried again. */
    retryCappedAt: (task: ReminderTask) => Date;
  };
  /** Delete the previous reminder message for these tasks once the new one lands. */
  replacesPrevious: boolean;
  /** Ledger and task writes committed together once Telegram accepted the message. */
  record: (sent: { chatId: string; messageId: string }) => Prisma.PrismaPromise<unknown>[];
  /** Reschedules the work after a failed send. */
  onFailure: (error: unknown) => Promise<void>;
};

/**
 * The one way a task reminder reaches Telegram. Every reminder kind calls it so quiet
 * hours, the daily cap, the chat lookup, the invalid-button fallback, the ledger write,
 * superseded-message cleanup and assignee nudges behave the same everywhere.
 * Returns true when the message was delivered and recorded.
 */
async function deliverReminder(bot: Bot, run: ReminderDiagnostics, delivery: ReminderDelivery): Promise<boolean> {
  const { tasks, settings, now, limits } = delivery;
  const owner = tasks[0]?.user;
  if (!owner) return false;
  const taskIds = tasks.map((task) => task.id);
  const limitCount = limits?.countEachTask ? tasks.length : 1;
  const quiet = { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd };

  if (limits && isWithinQuietHours(now, quiet)) {
    run.deferredForQuietHours += limitCount;
    await prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { nextReminderAt: nextQuietEnd(now, quiet) } });
    return false;
  }
  if (limits && await countReminderMessagesToday(owner.id, now, settings.timezone) >= settings.maxRemindersPerDay) {
    run.cappedByDailyLimit += limitCount;
    await Promise.all(tasks.map((task) => prisma.task.update({
      where: { id: task.id },
      data: { nextReminderAt: limits.retryCappedAt(task) },
    })));
    return false;
  }

  const chatId = (settings.reminderChatId ?? owner.telegramId).replace(/^chat:/, "");
  const previousReminders = delivery.replacesPrevious
    ? (await Promise.all(tasks.map((task) => prisma.reminderDelivery.findFirst({
      where: { taskId: task.id, chatId, messageId: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { chatId: true, messageId: true },
    })))).filter((reminder): reminder is { chatId: string; messageId: string } => Boolean(reminder?.messageId))
    : [];

  try {
    let sent;
    try {
      sent = await sendMessageWithChatMigrationRecovery(bot, chatId, delivery.text, { ...HTML_REPLY, reply_markup: delivery.keyboard });
    } catch (error) {
      if (!isInvalidReminderButtonError(error)) throw error;
      // A malformed or context-incompatible action must not turn a due
      // reminder into an unbounded retry loop. Preserve the reminder text
      // and advance its schedule even if Telegram rejects the keyboard.
      logger.warn("Reminder actions were rejected; delivering without buttons.", { kind: delivery.kind, taskIds });
      sent = await sendMessageWithChatMigrationRecovery(bot, chatId, delivery.text, HTML_REPLY);
    }
    await prisma.$transaction(delivery.record({ chatId: sent.chatId, messageId: String(sent.message.message_id) }));
    for (const id of taskIds) failedTaskAttempts.delete(id);
    run.remindersSent += 1;

    await deleteSupersededReminderMessages(
      bot,
      previousReminders.map((reminder) => ({ ...reminder, chatId: sent.chatId })),
      sent.message.message_id,
      tasks.map((task) => task.publicId)
    );
    for (const task of tasks) {
      try {
        const direct = await sendDirectAssigneeNudges(bot, task);
        run.directNudgesSent += direct.sent;
        run.directNudgesSkipped += direct.skipped;
        run.directNudgeFailures += direct.failed;
      } catch (error) {
        run.directNudgeFailures += Math.max(1, task.assignees.length);
        logger.warn(`Could not finish private assignee nudges after a ${delivery.kind}.`, { taskId: task.id, error: String(error) });
      }
    }
    return true;
  } catch (error) {
    run.failedDeliveries += 1;
    logger.error(`Failed to send a ${delivery.kind}.`, { userId: owner.id, taskIds, error: String(error) });
    await delivery.onFailure(error);
    return false;
  }
}

/** Ledger and task writes for an automatic (interval, due-nudge or digest) reminder. */
function automaticReminderWrites(
  tasks: ReminderTask[],
  settings: ReminderSettings,
  now: Date,
  sent: { chatId: string; messageId: string },
): Prisma.PrismaPromise<unknown>[] {
  return tasks.flatMap((task) => [
    prisma.reminderDelivery.create({ data: { userId: task.userId, taskId: task.id, chatId: sent.chatId, messageId: sent.messageId } }),
    prisma.task.update({
      where: { id: task.id },
      data: {
        lastRemindedAt: now,
        reminderCount: { increment: 1 },
        automaticReminderCount: { increment: 1 },
        reminderIntervalMinutes: settings.reminderIntervalMinutes,
        ...nextTaskScheduleAfterDelivery({
          now,
          dueAt: task.dueAt,
          dueNudgeMinutes: settings.dueNudgeMinutes,
          intervalMinutes: settings.reminderIntervalMinutes,
          automaticReminderCount: task.automaticReminderCount,
          automaticReminderBudget: task.automaticReminderBudget,
        }),
      },
    }),
  ]);
}

// shortcut: consecutive failed sends per task live in memory, so a restart restarts the backoff
// at two minutes. Persist a counter on Task if restarts ever become frequent.
const failedTaskAttempts = new Map<string, number>();

/**
 * Reschedules tasks after a failed send: the Study Calendar backoff, then every six hours, so a
 * Telegram or network outage delays reminders but never silences them. A refusal (blocked bot,
 * lost posting rights) skips straight to the six-hour retry, so reminders resume by themselves
 * once the user unblocks the bot or an admin restores its rights.
 */
async function retryTasksLater(tasks: ReminderTask[], now: Date, error: unknown): Promise<void> {
  const permanent = isPermanentTelegramDeliveryError(error);
  await Promise.all(tasks.map((task) => {
    const attempt = (failedTaskAttempts.get(task.id) ?? 0) + 1;
    failedTaskAttempts.set(task.id, attempt);
    if (permanent) logger.warn("Telegram refused a reminder; retrying in six hours.", { taskId: task.id, attempt });
    return prisma.task.update({
      where: { id: task.id },
      data: { nextReminderAt: nextIntervalReminderAt(now, permanent ? REMINDER_RETRY_CEILING_MINUTES : reminderRetryDelayMinutes(attempt)) },
    });
  }));
}

/**
 * Counts reminder messages sent to this owner since local midnight. One digest
 * covering several tasks counts once, so the daily cap limits messages, not tasks.
 */
async function countReminderMessagesToday(userId: string, now: Date, timezone: string): Promise<number> {
  const deliveries = await prisma.reminderDelivery.findMany({
    where: { userId, sentAt: { gte: startOfUserDay(now, timezone) } },
    select: { id: true, chatId: true, messageId: true }
  });
  return new Set(deliveries.map((delivery) =>
    delivery.messageId ? `${delivery.chatId}:${delivery.messageId}` : delivery.id
  )).size;
}

/**
 * Deletes the older reminder messages for these tasks (each message once), so the
 * chat keeps only the newest reminder with live buttons.
 */
async function deleteSupersededReminderMessages(
  bot: Bot,
  reminders: { chatId: string; messageId: string | null }[],
  currentMessageId: number,
  taskPublicIds: string[]
): Promise<void> {
  const unique = new Map<string, { chatId: string; messageId: string | null }>();
  for (const reminder of reminders) {
    if (reminder.messageId) unique.set(`${reminder.chatId}:${reminder.messageId}`, reminder);
  }
  for (const reminder of unique.values()) {
    await deleteSupersededReminderMessage(bot, reminder, currentMessageId, taskPublicIds.join(", "));
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * Deletes one older reminder message. Telegram may refuse (for example the message
 * is too old); that is logged and ignored.
 */
async function deleteSupersededReminderMessage(
  bot: Bot,
  previous: { chatId: string; messageId: string | null } | null,
  currentMessageId: number,
  taskPublicId: string
): Promise<void> {
  const previousMessageId = Number(previous?.messageId);
  if (!previous || !Number.isSafeInteger(previousMessageId) || previousMessageId <= 0 || previousMessageId === currentMessageId) {
    return;
  }

  try {
    await bot.api.deleteMessage(previous.chatId, previousMessageId);
  } catch (error) {
    // Reminder delivery must stay successful even when Telegram no longer allows
    // an older bot message to be removed.
    logger.info("Could not remove the superseded reminder message.", {
      taskId: taskPublicId,
      chatId: previous.chatId,
      messageId: previousMessageId,
      error: String(error)
    });
  }
}

/**
 * For group tasks only: also sends a private message to each assignee who turned
 * on direct nudges (/settings dm on). Each person gets at most one per reminder.
 * Failures are counted, not thrown.
 */
async function sendDirectAssigneeNudges(bot: Bot, task: {
  publicId: string;
  title: string;
  dueAt?: Date | null;
  timezone?: string | null;
  assignees: TaskAssigneeInfo[];
  user: { telegramId: string; firstName?: string | null };
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!task.user.telegramId.startsWith("chat:")) return result;
  const deliveredTo = new Set<string>();
  for (const assignee of task.assignees) {
    const privateUser = await findDirectNudgeUser(assignee);
    if (!privateUser?.settings?.directNudgesEnabled || deliveredTo.has(privateUser.telegramId)) {
      result.skipped += 1;
      continue;
    }
    try {
      await bot.api.sendMessage(privateUser.telegramId, formatDirectAssigneeNudge(task), HTML_REPLY);
      deliveredTo.add(privateUser.telegramId);
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      logger.warn("Could not send an assignee DM nudge.", { taskId: task.publicId, telegramId: privateUser.telegramId, error: String(error) });
    }
  }
  return result;
}

/**
 * Finds the private Threadwise user for an assignee, by Telegram id or else by
 * username. Only real private users (numeric Telegram ids) qualify, never a
 * "chat:" group owner.
 */
async function findDirectNudgeUser(assignee: TaskAssigneeInfo) {
  if (assignee.telegramId) {
    return prisma.user.findUnique({ where: { telegramId: assignee.telegramId }, include: { settings: true } });
  }
  if (!assignee.username) return undefined;
  const matches = await prisma.user.findMany({
    where: { username: { equals: assignee.username, mode: "insensitive" } },
    include: { settings: true },
    take: 5
  });
  return matches.find((user) => /^\d+$/.test(user.telegramId));
}

/** Telegram HTML for the private nudge sent to a group task's assignee. */
export function formatDirectAssigneeNudge(task: {
  publicId: string;
  title: string;
  dueAt?: Date | null;
  timezone?: string | null;
  user: { firstName?: string | null };
}): string {
  return joinBlocks([
    bold("Private task nudge"),
    h(task.title),
    [
      task.user.firstName ? field("Group", task.user.firstName) : undefined,
      task.dueAt ? field("Due Date", formatDateTimeForUser(task.dueAt, task.timezone ?? "UTC")) : undefined,
      fieldHtml("Task ID", code(task.publicId))
    ].filter(Boolean).join("\n"),
    "Open the group to complete, snooze, or change this shared task. Send /settings dm off here anytime to stop private nudges."
  ]);
}

/**
 * Telegram HTML for a single task reminder. Pinned tasks get a stronger
 * "Important task" header; DIGEST-mode owners get a plain closing line.
 */
export function formatReminderMessage(
  task: {
    publicId: string;
    title: string;
    dueAt?: Date | null;
    timezone?: string | null;
    pinnedAt?: Date | null;
    assignedUsername?: string | null;
    assignedDisplayName?: string | null;
    assignees?: TaskAssigneeInfo[];
    recurrenceRule?: RecurrenceRule | null;
    audience?: TaskAudience;
  },
  settings: {
    timezone: string;
    reminderMode: ReminderMode;
  }
): string {
  const metadata = [
    task.dueAt ? field("Due Date", formatDateTimeForUser(task.dueAt, task.timezone ?? settings.timezone)) : undefined,
    reminderAssignees(task).length > 0 ? fieldHtml("Assigned To", formatReminderAssigneesHtml(task)) : undefined,
    task.audience === TaskAudience.EVERYONE ? field("For", "Everyone") : undefined,
    task.recurrenceRule ? field("Repeats", formatRecurrenceRule(task.recurrenceRule)) : undefined,
    fieldHtml("Task ID", code(task.publicId))
  ].filter(Boolean).join("\n");

  if (task.pinnedAt) {
    return joinBlocks([
      bold("Important task"),
      h(task.title),
      metadata,
      bold("Do this now, or snooze it intentionally.")
    ]);
  }

  if (settings.reminderMode === ReminderMode.DIGEST) {
    return joinBlocks([
      h(task.title),
      metadata,
      "Threadwise reminder."
    ]);
  }

  return joinBlocks([
    h(task.title),
    metadata,
    reminderAssistantLine(task.publicId)
  ]);
}

/** Telegram HTML for one group follow-up that lists several undated tasks. */
export function formatGroupUndatedReminderDigest(tasks: Array<{
  publicId: string;
  title: string;
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  assignees?: TaskAssigneeInfo[];
}>): string {
  const lines = tasks.map((task, index) => {
    const assignees = reminderAssignees(task);
    const assignment = assignees.length > 0 ? ` — ${formatReminderAssigneesHtml(task)}` : "";
    return `${index + 1}. ${bold(h(task.title))}${assignment}\n${fieldHtml("Task ID", code(task.publicId))}`;
  });
  return joinBlocks([
    bold("Group follow-up"),
    lines.join("\n\n"),
    "No deadlines were set. Open a task to finish it, add a date, or snooze it."
  ]);
}

/** Telegram HTML for one digest message that lists several due tasks. */
export function formatReminderDigest(tasks: Array<{
  publicId: string;
  title: string;
  dueAt?: Date | null;
  timezone?: string | null;
}>, fallbackTimezone: string): string {
  return joinBlocks([
    bold(`${tasks.length} tasks need attention`),
    tasks.map((task, index) => [
      `${index + 1}. ${bold(h(task.title))}`,
      task.dueAt ? `Due ${h(formatDateTimeForUser(task.dueAt, task.timezone ?? fallbackTimezone))}` : undefined,
      code(task.publicId),
    ].filter(Boolean).join(" · ")).join("\n"),
    "Open one task to complete, snooze, or dismiss its reminder cycle.",
  ]);
}

/** "Open TASK-n" buttons, two per row, for any reminder message that covers several tasks. */
function reminderDigestKeyboard(tasks: Array<{ id: string; publicId: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  tasks.forEach((task, index) => {
    keyboard.text(`Open ${task.publicId}`, `task:view-full:${task.id}`);
    if (index % 2 === 1 || index === tasks.length - 1) keyboard.row();
  });
  return keyboard;
}

/** Assignee list for reminder text, falling back to the single-assignee columns. */
function reminderAssignees(task: {
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  assignees?: TaskAssigneeInfo[];
}): TaskAssigneeInfo[] {
  if (task.assignees?.length) return task.assignees;
  if (!task.assignedUsername && !task.assignedDisplayName) return [];
  return [{ username: task.assignedUsername, displayName: task.assignedDisplayName }];
}

/**
 * HTML assignee names. People without a username get a tg://user link when their
 * Telegram id is known.
 */
function formatReminderAssigneesHtml(task: {
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  assignees?: TaskAssigneeInfo[];
}): string {
  return reminderAssignees(task).map((assignee) => {
    if (assignee.username) return h(`@${assignee.username}`);
    const label = assignee.displayName || "Telegram user";
    if (assignee.telegramId && /^\d+$/.test(assignee.telegramId)) {
      return `<a href="tg://user?id=${assignee.telegramId}">${h(label)}</a>`;
    }
    return h(label);
  }).join(", ");
}

/** Picks one closing line, keyed on the public id so a task always shows the same line. */
function reminderAssistantLine(publicId: string): string {
  return stableChoice(publicId, [
    "I'll remind you when the time comes.",
    "I'll keep this on your radar until it is done.",
    "I'll make sure this stays visible until you complete it.",
    "I'll bring this back so it does not get buried."
  ]);
}

/** True once a deadline is inside its due-nudge window, where quiet hours and the daily cap no longer apply. */
export function shouldUseDueNudgePolicy(task: {
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  now: Date;
}): boolean {
  if (!task.dueAt || task.dueNudgeMinutes <= 0) {
    return false;
  }

  const nudgeStart = dueNudgeStartAt(task.dueAt, task.dueNudgeMinutes);
  return task.now >= nudgeStart;
}

export function nextIntervalReminderAt(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() + intervalMinutes * 60_000);
}

/**
 * Interval for the next undated group follow-up. After three ignored follow-ups
 * it slows to at least once a day, so a group is not nagged about tasks nobody
 * is acting on.
 */
export function nextUndatedGroupReminderInterval(intervalMinutes: number, consecutiveNudges: number): number {
  return consecutiveNudges >= GROUP_UNDATED_SLOWDOWN_AFTER
    ? Math.max(intervalMinutes, GROUP_UNDATED_SLOW_INTERVAL_MINUTES)
    : intervalMinutes;
}

/** Start of the due-nudge window: dueNudgeMinutes before the deadline. */
export function dueNudgeStartAt(dueAt: Date, dueNudgeMinutes: number): Date {
  return new Date(dueAt.getTime() - Math.max(0, dueNudgeMinutes) * 60_000);
}

/**
 * When the next automatic reminder should fire after one was sent. Reminders are
 * finite: each task has a budget (default 7), undated tasks stop after three, and
 * dated tasks step through fixed milestones before the deadline. Returns null
 * when the cycle is finished.
 */
export function nextReminderAtAfterDelivery(input: {
  now: Date;
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  intervalMinutes: number;
  automaticReminderCount?: number;
  automaticReminderBudget?: number;
}): Date | null {
  const count = input.automaticReminderCount ?? 0;
  const budget = input.automaticReminderBudget ?? 7;
  if (count + 1 >= budget) return null;
  if (input.dueAt) {
    return nextDueMilestone(input.dueAt, input.now, input.dueNudgeMinutes);
  }
  if (count + 1 >= Math.min(3, budget)) return null;
  return nextIntervalReminderAt(input.now, input.intervalMinutes);
}

/**
 * The fixed reminder points before a deadline (7 days, 3 days, 1 day, 6 hours,
 * 2 hours, 30 minutes, at the deadline), plus the owner's due-nudge offset,
 * earliest first.
 */
export function dueReminderMilestones(dueAt: Date, dueNudgeMinutes = 0): Date[] {
  const offsets = new Set([7 * 24 * 60, 3 * 24 * 60, 24 * 60, 6 * 60, 2 * 60, 30, 0]);
  if (dueNudgeMinutes > 0) offsets.add(dueNudgeMinutes);
  return [...offsets]
    .sort((left, right) => right - left)
    .map((minutes) => new Date(dueAt.getTime() - minutes * 60_000));
}

/**
 * The next milestone more than a minute away, or the deadline itself. Returns
 * null once the deadline has passed.
 */
function nextDueMilestone(dueAt: Date, now: Date, dueNudgeMinutes: number): Date | null {
  if (now >= dueAt) return null;
  const threshold = now.getTime() + 60_000;
  return dueReminderMilestones(dueAt, dueNudgeMinutes).find((milestone) => milestone.getTime() > threshold) ?? dueAt;
}

/**
 * First reminder time for a new or reopened task: the next due milestone when it
 * has a deadline, otherwise one interval from now.
 */
export function initialTaskReminderAt(input: {
  now: Date;
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  intervalMinutes: number;
}): Date | null {
  if (!input.dueAt) return nextIntervalReminderAt(input.now, input.intervalMinutes);
  return nextDueMilestone(input.dueAt, input.now, input.dueNudgeMinutes);
}

/** nextReminderAtAfterDelivery wrapped as a Prisma update fragment. */
export function nextTaskScheduleAfterDelivery(input: {
  now: Date;
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  intervalMinutes: number;
  automaticReminderCount?: number;
  automaticReminderBudget?: number;
}): { nextReminderAt: Date | null } {
  return {
    nextReminderAt: nextReminderAtAfterDelivery(input)
  };
}

/**
 * Recomputes a task's next reminder after the owner changes reminder settings.
 * Dated tasks move to the next milestone. Undated tasks keep an earlier pending
 * reminder but never wait longer than the new interval.
 */
export function nextReminderAfterSettingChange(task: {
  dueAt?: Date | null;
  nextReminderAt?: Date | null;
  lastRemindedAt?: Date | null;
  reminderCount: number;
}, now: Date, intervalMinutes: number, dueNudgeMinutes = 0): Date | null {
  if (task.dueAt) return nextDueMilestone(task.dueAt, now, dueNudgeMinutes);
  const nextInterval = nextIntervalReminderAt(now, intervalMinutes);
  if (!task.nextReminderAt || task.nextReminderAt.getTime() > nextInterval.getTime()) {
    return nextInterval;
  }

  return task.nextReminderAt;
}

/**
 * One Study reminder pass followed by the Study Calendar retry queue. It runs in its own loop,
 * apart from the Personal pass, so a Study failure or a slow Google call cannot delay ordinary
 * reminders. Each half is isolated so one failing does not skip the other.
 */
export async function runStudyReminderLoopPass(bot: Bot, now = new Date()): Promise<void> {
  try {
    const study = await runStudyReminderPass(bot, now);
    studyDiagnostics = { studyRemindersSent: study.sent, studyRemindersFailed: study.failed, studyReminderUnsafeChat: study.unsafeChat };
  } catch (error) {
    studyDiagnostics = { studyRemindersSent: 0, studyRemindersFailed: 1, studyReminderUnsafeChat: false };
    logger.error("Study reminder pass failed.", { error: String(error) });
  }
  try {
    await runPendingStudyCalendarSyncs(now);
  } catch (error) {
    logger.warn("Study Calendar retry pass failed.", { error: String(error) });
  }
}

/** Runs the Study reminder pass every `pollMs`, starting at once like the Personal loop does. */
export function startStudyReminderLoop(bot: Bot, pollMs: number): StopLoop {
  return startLoop("Study reminder", pollMs, () => runStudyReminderLoopPass(bot), { runImmediately: true });
}

/** Sends due reminders every `pollMs`, after one labelled initial pass at startup. */
export function startReminderLoop(bot: Bot, pollMs: number): StopLoop {
  void runReminderPass(bot, "initial").catch((error) => logger.error("Initial reminder pass failed.", { error: String(error) }));
  return startLoop("Reminder", pollMs, () => runReminderPass(bot, "loop"));
}

/**
 * True for Telegram refusals no retry can fix: the bot was removed or blocked (403 Forbidden),
 * or the chat no longer exists. These stop a reminder at once instead of using up its retries.
 */
export function isPermanentTelegramDeliveryError(error: unknown): boolean {
  if ((error as { error_code?: unknown } | null)?.error_code === 403) return true;
  return /Forbidden|chat not found|PEER_ID_INVALID|chat was deactivated/i.test(String(error));
}

/**
 * True when Telegram rejected the reminder's buttons (BUTTON_TYPE_INVALID). The
 * reminder is then sent without buttons instead of retrying forever.
 */
export function isInvalidReminderButtonError(error: unknown): boolean {
  return String(error).includes("BUTTON_TYPE_INVALID");
}
