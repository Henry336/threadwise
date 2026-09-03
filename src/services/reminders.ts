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
import { claimDueTaskReminderSchedules, customReminderDeliveryKey, releaseTaskReminderSchedule } from "./taskReminderSchedules";

type ReminderTask = Prisma.TaskGetPayload<{
  include: { user: { include: { settings: true } }; assignees: true };
}>;

const GROUP_UNDATED_BATCH_SIZE = 8;
const GROUP_UNDATED_SLOWDOWN_AFTER = 3;
const GROUP_UNDATED_SLOW_INTERVAL_MINUTES = 24 * 60;

export type ReminderRunSource = "initial" | "loop" | "manual";

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
let activeReminderRun: Promise<ReminderDiagnostics> | undefined;

export async function sendDueReminders(bot: Bot): Promise<number> {
  const result = await runReminderPass(bot, "manual");
  return result.remindersSent;
}

export function getReminderDiagnostics(): ReminderDiagnostics {
  return { ...reminderDiagnostics };
}

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
    studyRemindersSent: 0,
    studyRemindersFailed: 0,
    studyReminderUnsafeChat: false
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
        nextReminderAt: task.nextReminderAt,
        dueNudgeMinutes: settings.dueNudgeMinutes,
        now
      });

      if (
        !isDueNudgeReminder &&
        isWithinQuietHours(now, { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd })
      ) {
        run.deferredForQuietHours += 1;
        await prisma.task.update({
          where: { id: task.id },
          data: { nextReminderAt: nextQuietEnd(now, { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd }) }
        });
        continue;
      }

      const remindersToday = await countReminderMessagesToday(task.userId, now, settings.timezone);

      if (!isDueNudgeReminder && remindersToday >= settings.maxRemindersPerDay) {
        run.cappedByDailyLimit += 1;
        await prisma.task.update({
          where: { id: task.id },
          data: { nextReminderAt: new Date(now.getTime() + settings.reminderIntervalMinutes * 60_000) }
        });
        continue;
      }

      const chatId = settings.reminderChatId ?? task.user.telegramId;
      const message = formatReminderMessage(task, settings);
      const previousReminder = await prisma.reminderDelivery.findFirst({
        where: {
          taskId: task.id,
          chatId,
          messageId: { not: null }
        },
        orderBy: { sentAt: "desc" },
        select: { chatId: true, messageId: true }
      });

      try {
        const delivery = await sendMessageWithChatMigrationRecovery(bot, chatId, message, {
          ...HTML_REPLY,
          reply_markup: reminderActionsKeyboard(task)
        });
        const sentMessage = delivery.message;
        const deliveredChatId = delivery.chatId;

        const nextSchedule = nextTaskScheduleAfterDelivery({
          now,
          dueAt: task.dueAt,
          dueNudgeMinutes: settings.dueNudgeMinutes,
          intervalMinutes: settings.reminderIntervalMinutes,
          automaticReminderCount: task.automaticReminderCount,
          automaticReminderBudget: task.automaticReminderBudget,
        });

        await prisma.$transaction([
          prisma.reminderDelivery.create({
            data: {
              userId: task.userId,
              taskId: task.id,
              chatId: deliveredChatId,
              messageId: String(sentMessage.message_id)
            }
          }),
          prisma.task.update({
            where: { id: task.id },
            data: {
              lastRemindedAt: now,
              reminderCount: { increment: 1 },
              automaticReminderCount: { increment: 1 },
              reminderIntervalMinutes: settings.reminderIntervalMinutes,
              ...nextSchedule
            }
          })
        ]);

        run.remindersSent += 1;
        await deleteSupersededReminderMessage(
          bot,
          previousReminder ? { ...previousReminder, chatId: deliveredChatId } : null,
          sentMessage.message_id,
          task.publicId
        );
        try {
          const direct = await sendDirectAssigneeNudges(bot, task);
          run.directNudgesSent += direct.sent;
          run.directNudgesSkipped += direct.skipped;
          run.directNudgeFailures += direct.failed;
        } catch (error) {
          run.directNudgeFailures += Math.max(1, task.assignees.length);
          logger.warn("Could not finish private assignee nudges after the group reminder was delivered.", { taskId: task.id, error: String(error) });
        }
      } catch (error) {
        run.failedDeliveries += 1;
        logger.error("Failed to send reminder.", { taskId: task.id, error: String(error) });
        await prisma.task.update({
          where: { id: task.id },
          data: { nextReminderAt: new Date(now.getTime() + 15 * 60_000) }
        });
      }
    }

    try {
      const study = await runStudyReminderPass(bot, now);
      run.studyRemindersSent = study.sent;
      run.studyRemindersFailed = study.failed;
      run.studyReminderUnsafeChat = study.unsafeChat;
    } catch (error) {
      run.studyRemindersFailed += 1;
      logger.error("Study reminder pass failed without interrupting normal reminders.", { error: String(error) });
    }
    try {
      await runPendingStudyCalendarSyncs(now);
    } catch (error) {
      logger.warn("Study Calendar retry pass failed without interrupting reminders.", { error: String(error) });
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

async function sendDueCustomReminderSchedules(bot: Bot, now: Date, run: ReminderDiagnostics): Promise<Set<string>> {
  const claimed = await claimDueTaskReminderSchedules(now);
  const deliveredTaskIds = new Set<string>();
  run.customRemindersDue = claimed.length;

  for (const schedule of claimed) {
    const task = schedule.task;
    const settings = task.user.settings;
    if (!settings) {
      run.skippedMissingSettings += 1;
      await releaseTaskReminderSchedule(schedule.id, "Reminder settings are missing.");
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

    const chatId = settings.reminderChatId ?? task.user.telegramId.replace(/^chat:/, "");
    const previousReminder = await prisma.reminderDelivery.findFirst({
      where: { taskId: task.id, chatId, messageId: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { chatId: true, messageId: true },
    });

    try {
      const delivery = await sendMessageWithChatMigrationRecovery(bot, chatId, formatReminderMessage(task, settings), {
        ...HTML_REPLY,
        reply_markup: reminderActionsKeyboard(task),
      });
      const sentAt = new Date();
      await prisma.$transaction([
        prisma.reminderDelivery.create({
          data: {
            userId: task.userId,
            taskId: task.id,
            chatId: delivery.chatId,
            messageId: String(delivery.message.message_id),
            deliveryKey,
            sentAt,
          },
        }),
        prisma.taskReminderSchedule.update({
          where: { id: schedule.id },
          data: {
            status: TaskReminderScheduleStatus.SENT,
            deliveredAt: sentAt,
            leaseExpiresAt: null,
            lastError: null,
          },
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
      ]);
      deliveredTaskIds.add(task.id);
      run.remindersSent += 1;
      run.customRemindersSent = (run.customRemindersSent ?? 0) + 1;
      await deleteSupersededReminderMessage(
        bot,
        previousReminder ? { ...previousReminder, chatId: delivery.chatId } : null,
        delivery.message.message_id,
        task.publicId,
      );
      try {
        const direct = await sendDirectAssigneeNudges(bot, task);
        run.directNudgesSent += direct.sent;
        run.directNudgesSkipped += direct.skipped;
        run.directNudgeFailures += direct.failed;
      } catch (error) {
        run.directNudgeFailures += Math.max(1, task.assignees.length);
        logger.warn("Could not finish private assignee nudges after a custom reminder.", { taskId: task.id, error: String(error) });
      }
    } catch (error) {
      run.failedDeliveries += 1;
      await releaseTaskReminderSchedule(schedule.id, error);
      logger.error("Failed to send a custom task reminder.", { taskId: task.id, scheduleId: schedule.id, error: String(error) });
    }
  }

  return deliveredTaskIds;
}

async function sendReminderDigestBatch(
  bot: Bot,
  tasks: ReminderTask[],
  now: Date,
  run: ReminderDiagnostics,
): Promise<void> {
  const first = tasks[0];
  const settings = first?.user.settings;
  if (!first || !settings) return;
  const taskIds = tasks.map((task) => task.id);
  const bypassQuiet = tasks.some((task) => shouldUseDueNudgePolicy({
    dueAt: task.dueAt,
    nextReminderAt: task.nextReminderAt,
    dueNudgeMinutes: settings.dueNudgeMinutes,
    now,
  }));
  if (!bypassQuiet && isWithinQuietHours(now, { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd })) {
    run.deferredForQuietHours += 1;
    await prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: { nextReminderAt: nextQuietEnd(now, { timezone: settings.timezone, start: settings.quietHoursStart, end: settings.quietHoursEnd }) },
    });
    return;
  }
  if (!bypassQuiet && await countReminderMessagesToday(first.userId, now, settings.timezone) >= settings.maxRemindersPerDay) {
    run.cappedByDailyLimit += 1;
    await prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { nextReminderAt: nextIntervalReminderAt(now, 60) } });
    return;
  }
  const chatId = (settings.reminderChatId ?? first.user.telegramId).replace(/^chat:/, "");
  try {
    const delivery = await sendMessageWithChatMigrationRecovery(bot, chatId, formatReminderDigest(tasks, settings.timezone), {
      ...HTML_REPLY,
      reply_markup: reminderDigestKeyboard(tasks),
    });
    const deliveredChatId = delivery.chatId;
    const messageId = String(delivery.message.message_id);
    await prisma.$transaction(tasks.flatMap((task) => [
      prisma.reminderDelivery.create({ data: { userId: task.userId, taskId: task.id, chatId: deliveredChatId, messageId } }),
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
    ]));
    run.remindersSent += 1;
    for (const task of tasks) {
      try {
        const direct = await sendDirectAssigneeNudges(bot, task);
        run.directNudgesSent += direct.sent;
        run.directNudgesSkipped += direct.skipped;
        run.directNudgeFailures += direct.failed;
      } catch (error) {
        run.directNudgeFailures += Math.max(1, task.assignees.length);
        logger.warn("Could not finish private assignee nudges after a reminder digest.", { taskId: task.id, error: String(error) });
      }
    }
  } catch (error) {
    run.failedDeliveries += 1;
    logger.error("Failed to send reminder digest.", { userId: first.userId, taskIds, error: String(error) });
    await prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { nextReminderAt: nextIntervalReminderAt(now, 15) } });
  }
}

async function sendGroupUndatedReminderBatch(
  bot: Bot,
  tasks: ReminderTask[],
  now: Date,
  run: ReminderDiagnostics
): Promise<void> {
  const first = tasks[0];
  const settings = first?.user.settings;
  if (!first || !settings) {
    run.skippedMissingSettings += tasks.length;
    return;
  }

  const taskIds = tasks.map((task) => task.id);
  if (isWithinQuietHours(now, {
    timezone: settings.timezone,
    start: settings.quietHoursStart,
    end: settings.quietHoursEnd
  })) {
    run.deferredForQuietHours += tasks.length;
    await prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: {
        nextReminderAt: nextQuietEnd(now, {
          timezone: settings.timezone,
          start: settings.quietHoursStart,
          end: settings.quietHoursEnd
        })
      }
    });
    return;
  }

  const remindersToday = await countReminderMessagesToday(first.userId, now, settings.timezone);
  if (remindersToday >= settings.maxRemindersPerDay) {
    run.cappedByDailyLimit += tasks.length;
    await Promise.all(tasks.map((task) => prisma.task.update({
      where: { id: task.id },
      data: {
        nextReminderAt: nextIntervalReminderAt(
          now,
          nextUndatedGroupReminderInterval(settings.reminderIntervalMinutes, task.undatedNudgeCount)
        )
      }
    })));
    return;
  }

  const chatId = settings.reminderChatId ?? first.user.telegramId.replace(/^chat:/, "");
  const previousReminders = (await Promise.all(tasks.map((task) =>
    prisma.reminderDelivery.findFirst({
      where: { taskId: task.id, chatId, messageId: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { chatId: true, messageId: true }
    })
  ))).filter((reminder): reminder is { chatId: string; messageId: string } => Boolean(reminder?.messageId));

  try {
    const delivery = await sendMessageWithChatMigrationRecovery(bot, chatId, formatGroupUndatedReminderDigest(tasks), {
      ...HTML_REPLY,
      reply_markup: groupUndatedReminderKeyboard(tasks)
    });
    const sentMessage = delivery.message;
    const deliveredChatId = delivery.chatId;
    const messageId = String(sentMessage.message_id);

    await prisma.$transaction(tasks.flatMap((task) => {
      const nextCount = task.undatedNudgeCount + 1;
      const nextInterval = nextUndatedGroupReminderInterval(settings.reminderIntervalMinutes, nextCount);
      const automaticCount = task.automaticReminderCount + 1;
      const nextReminderAt = automaticCount >= Math.min(3, task.automaticReminderBudget)
        ? null
        : nextIntervalReminderAt(now, nextInterval);
      return [
        prisma.reminderDelivery.create({
          data: { userId: task.userId, taskId: task.id, chatId: deliveredChatId, messageId }
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
    }));

    run.remindersSent += 1;
    await deleteSupersededReminderMessages(
      bot,
      previousReminders.map((reminder) => ({ ...reminder, chatId: deliveredChatId })),
      sentMessage.message_id,
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
        logger.warn("Could not finish private assignee nudges after a group reminder digest.", {
          taskId: task.id,
          error: String(error)
        });
      }
    }
  } catch (error) {
    run.failedDeliveries += 1;
    logger.error("Failed to send an undated group reminder digest.", {
      userId: first.userId,
      taskIds,
      error: String(error)
    });
    await prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: { nextReminderAt: nextIntervalReminderAt(now, 15) }
    });
  }
}

async function countReminderMessagesToday(userId: string, now: Date, timezone: string): Promise<number> {
  const deliveries = await prisma.reminderDelivery.findMany({
    where: { userId, sentAt: { gte: startOfUserDay(now, timezone) } },
    select: { id: true, chatId: true, messageId: true }
  });
  return new Set(deliveries.map((delivery) =>
    delivery.messageId ? `${delivery.chatId}:${delivery.messageId}` : delivery.id
  )).size;
}

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

function reminderDigestKeyboard(tasks: Array<{ id: string; publicId: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  tasks.forEach((task, index) => {
    keyboard.text(`Open ${task.publicId}`, `task:view-full:${task.id}`);
    if (index % 2 === 1 || index === tasks.length - 1) keyboard.row();
  });
  return keyboard;
}

function groupUndatedReminderKeyboard(tasks: Array<{ id: string; publicId: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  tasks.forEach((task, index) => {
    keyboard.text(`Open ${task.publicId}`, `task:view-full:${task.id}`);
    if (index % 2 === 1 || index === tasks.length - 1) keyboard.row();
  });
  return keyboard;
}

function reminderAssignees(task: {
  assignedUsername?: string | null;
  assignedDisplayName?: string | null;
  assignees?: TaskAssigneeInfo[];
}): TaskAssigneeInfo[] {
  if (task.assignees?.length) return task.assignees;
  if (!task.assignedUsername && !task.assignedDisplayName) return [];
  return [{ username: task.assignedUsername, displayName: task.assignedDisplayName }];
}

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

function reminderAssistantLine(publicId: string): string {
  return stableChoice(publicId, [
    "I'll remind you when the time comes.",
    "I'll keep this on your radar until it is done.",
    "I'll make sure this stays visible until you complete it.",
    "I'll bring this back so it does not get buried."
  ]);
}

export function shouldBypassReminderLimits(task: { dueAt?: Date | null; lastRemindedAt?: Date | null; reminderCount: number }): boolean {
  return Boolean(task.dueAt && !task.lastRemindedAt && task.reminderCount === 0);
}

export function shouldUseDueNudgePolicy(task: {
  dueAt?: Date | null;
  nextReminderAt?: Date | null;
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

export function nextUndatedGroupReminderInterval(intervalMinutes: number, consecutiveNudges: number): number {
  return consecutiveNudges >= GROUP_UNDATED_SLOWDOWN_AFTER
    ? Math.max(intervalMinutes, GROUP_UNDATED_SLOW_INTERVAL_MINUTES)
    : intervalMinutes;
}

export function dueNudgeStartAt(dueAt: Date, dueNudgeMinutes: number): Date {
  return new Date(dueAt.getTime() - Math.max(0, dueNudgeMinutes) * 60_000);
}

export function nextDueReminderAt(dueAt: Date, dueNudgeMinutes: number, now: Date): Date {
  if (dueNudgeMinutes <= 0) {
    return dueAt;
  }

  const startAt = dueNudgeStartAt(dueAt, dueNudgeMinutes);
  return startAt.getTime() <= now.getTime() ? now : startAt;
}

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

export function dueReminderMilestones(dueAt: Date, dueNudgeMinutes = 0): Date[] {
  const offsets = new Set([7 * 24 * 60, 3 * 24 * 60, 24 * 60, 6 * 60, 2 * 60, 30, 0]);
  if (dueNudgeMinutes > 0) offsets.add(dueNudgeMinutes);
  return [...offsets]
    .sort((left, right) => right - left)
    .map((minutes) => new Date(dueAt.getTime() - minutes * 60_000));
}

function nextDueMilestone(dueAt: Date, now: Date, dueNudgeMinutes: number): Date | null {
  if (now >= dueAt) return null;
  const threshold = now.getTime() + 60_000;
  return dueReminderMilestones(dueAt, dueNudgeMinutes).find((milestone) => milestone.getTime() > threshold) ?? dueAt;
}

export function escalatingReminderIntervalMinutes(
  dueAt: Date,
  now: Date,
  defaultIntervalMinutes: number,
  finalNudgeMinutes = 0,
): number {
  const remainingMinutes = (dueAt.getTime() - now.getTime()) / 60_000;
  if (finalNudgeMinutes > 0 && remainingMinutes <= finalNudgeMinutes) {
    return Math.max(1, Math.min(defaultIntervalMinutes, finalNudgeMinutes));
  }
  let ladderMinutes: number;
  if (remainingMinutes <= 0) ladderMinutes = 180;
  else if (remainingMinutes <= 15) ladderMinutes = Math.max(5, finalNudgeMinutes || 10);
  else if (remainingMinutes <= 60) ladderMinutes = 15;
  else if (remainingMinutes <= 4 * 60) ladderMinutes = 30;
  else if (remainingMinutes <= 12 * 60) ladderMinutes = 60;
  else if (remainingMinutes <= 24 * 60) ladderMinutes = 180;
  else if (remainingMinutes <= 3 * 24 * 60) ladderMinutes = 360;
  else if (remainingMinutes <= 7 * 24 * 60) ladderMinutes = 720;
  else ladderMinutes = 24 * 60;
  return Math.max(5, Math.min(defaultIntervalMinutes, ladderMinutes));
}

export function initialTaskReminderAt(input: {
  now: Date;
  dueAt?: Date | null;
  dueNudgeMinutes: number;
  intervalMinutes: number;
}): Date | null {
  if (!input.dueAt) return nextIntervalReminderAt(input.now, input.intervalMinutes);
  return nextDueMilestone(input.dueAt, input.now, input.dueNudgeMinutes);
}

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

export function startReminderLoop(bot: Bot, pollMs: number): NodeJS.Timeout {
  const interval = setInterval(() => {
    runReminderPass(bot, "loop").catch((error) => logger.error("Reminder loop failed.", { error: String(error) }));
  }, pollMs);

  void runReminderPass(bot, "initial").catch((error) => logger.error("Initial reminder pass failed.", { error: String(error) }));
  return interval;
}
