import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { DashboardUserNotFoundError } from "./snapshot";

// One watcher per owner, not per tab. Cross-device/Telegram changes arrive within
// 30 seconds; same-page mutations already refresh immediately. At most 120
// revision passes/hour replaces 1,440 expensive external-Postgres passes.
const CHANGE_POLL_INTERVAL_MS = 30_000;

export type DashboardChangeEvent =
  | { type: "ready"; revision: string }
  | { type: "refresh"; revision: string }
  | { type: "sync-error" };

type Listener = (event: DashboardChangeEvent) => void;
type Watcher = {
  listeners: Set<Listener>;
  timer: NodeJS.Timeout;
  revision?: string;
  checking: boolean;
};

const watchers = new Map<string, Watcher>();

export function subscribeDashboardChanges(telegramId: string, listener: Listener): () => void {
  let watcher = watchers.get(telegramId);
  if (!watcher) {
    watcher = {
      listeners: new Set(),
      timer: setInterval(() => void checkWatcher(telegramId), CHANGE_POLL_INTERVAL_MS),
      checking: false
    };
    watcher.timer.unref?.();
    watchers.set(telegramId, watcher);
    void checkWatcher(telegramId);
  }
  watcher.listeners.add(listener);
  if (watcher.revision) listener({ type: "ready", revision: watcher.revision });

  return () => {
    const current = watchers.get(telegramId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      clearInterval(current.timer);
      watchers.delete(telegramId);
    }
  };
}

async function checkWatcher(telegramId: string): Promise<void> {
  const watcher = watchers.get(telegramId);
  if (!watcher || watcher.checking) return;
  watcher.checking = true;
  try {
    const next = await dashboardRevision(telegramId);
    if (watchers.get(telegramId) !== watcher) return;
    if (!watcher.revision) {
      watcher.revision = next;
      emit(watcher, { type: "ready", revision: next });
    } else if (watcher.revision !== next) {
      watcher.revision = next;
      emit(watcher, { type: "refresh", revision: next });
    }
  } catch (error) {
    logger.warn("Dashboard live-sync revision check failed.", {
      errorType: error instanceof Error ? error.name : "UnknownError"
    });
    emit(watcher, { type: "sync-error" });
  } finally {
    watcher.checking = false;
  }
}

function emit(watcher: Watcher, event: DashboardChangeEvent): void {
  for (const listener of watcher.listeners) listener(event);
}

export async function dashboardRevision(telegramId: string, database: PrismaClient = prisma): Promise<string> {
  const user = await database.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      updatedAt: true,
      settings: { select: { updatedAt: true } },
      calendarConnection: { select: { updatedAt: true } },
      microsoftConnection: { select: { updatedAt: true } },
      studyWorkspace: { select: {
        id: true, semesterName: true, semesterStartDate: true, timezone: true, active: true,
        weeklyReviewDay: true, weeklyReviewTime: true, weeklyPreviewDay: true, weeklyPreviewTime: true,
        quietHoursStart: true, quietHoursEnd: true, maxRemindersPerDay: true, timedPracticeStartWeek: true,
        studyBlockRemindersEnabled: true, canvasSyncEnabled: true,
        activeModuleId: true, activeModuleUntil: true, activeOriginId: true, activeOriginUntil: true,
        travelMutedUntil: true, calendarSyncEnabled: true, calendarSyncStatus: true, calendarLastError: true,
      } }
    }
  });
  if (!user) throw new DashboardUserNotFoundError();

  const [tasks, notes, ideas, images, expenses, availability, taskImports] = await Promise.all([
    database.task.aggregate({ where: { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    database.note.aggregate({ where: { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    database.idea.aggregate({ where: { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    database.storedImage.aggregate({ where: { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    database.expense.aggregate({ where: { userId: user.id }, _count: true, _max: { updatedAt: true } }),
    database.availabilityPoll.aggregate({ where: { workspace: { ownerUserId: user.id } }, _count: true, _max: { updatedAt: true } }),
    database.pendingTaskImport.aggregate({ where: { ownerUserId: user.id }, _count: true, _max: { updatedAt: true } })
  ]);
  const study = user.studyWorkspace
    ? await Promise.all([
        database.studyResource.aggregate({ where: { workspaceId: user.studyWorkspace.id }, _count: true, _max: { updatedAt: true } }),
        database.studyCanvasSync.findUnique({ where: { workspaceId: user.studyWorkspace.id }, select: { updatedAt: true } }),
        database.auditLog.aggregate({
          where: { userId: user.id, action: { startsWith: "study." } },
          _count: true,
          _max: { createdAt: true },
        }),
      ])
    : undefined;

  return createHash("sha256").update(JSON.stringify([
    stamp(user.updatedAt),
    stamp(user.settings?.updatedAt),
    stamp(user.calendarConnection?.updatedAt),
    stamp(user.microsoftConnection?.updatedAt),
    aggregateStamp(tasks),
    aggregateStamp(notes),
    aggregateStamp(ideas),
    aggregateStamp(images),
    aggregateStamp(expenses),
    aggregateStamp(availability),
    aggregateStamp(taskImports),
    // Deliberately exclude updatedAt and diagnostic timestamps: the reminder
    // health heartbeat writes them every minute without changing user content.
    user.studyWorkspace,
    ...(study ? [aggregateStamp(study[0]), stamp(study[1]?.updatedAt), `${study[2]._count}:${stamp(study[2]._max.createdAt)}`] : [])
  ])).digest("hex");
}

function aggregateStamp(value: { _count: number; _max: { updatedAt: Date | null } }): string {
  return `${value._count}:${stamp(value._max.updatedAt)}`;
}

function stamp(value: Date | null | undefined): string {
  return value?.toISOString() ?? "-";
}
