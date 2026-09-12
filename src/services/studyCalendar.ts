import crypto from "crypto";
import type { StudyScheduleBlock, StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import {
  calendarConfigured,
  calendarConnectionStatus,
  removeStudyEventFromGoogleCalendar,
  upsertStudyEventInGoogleCalendar,
} from "./googleCalendar";

const MAX_RETRY_ATTEMPTS = 6;
const INITIAL_SYNC_BATCH_SIZE = 12;
const GOOGLE_WEEKDAYS = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

type CalendarBlock = StudyScheduleBlock & { module: { code: string; name: string } | null };

export type StudyCalendarSnapshot = {
  configured: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  email?: string;
  enabled: boolean;
  status: string;
  syncedBlocks: number;
  pendingBlocks: number;
  failedBlocks: number;
  lastSuccessfulAt?: string;
  error?: string;
};

export function deterministicStudyEventId(blockId: string): string {
  return `st${blockId.replace(/-/gu, "").toLowerCase()}`;
}

export async function studyCalendarSnapshot(workspace: StudyWorkspace): Promise<StudyCalendarSnapshot> {
  const [connection, grouped] = await Promise.all([
    calendarConnectionStatus(workspace.ownerUserId),
    prisma.studyScheduleCalendarLink.groupBy({
      by: ["status"],
      where: { workspaceId: workspace.id },
      _count: { _all: true },
    }),
  ]);
  const count = (status: string) => grouped.find((entry) => entry.status === status)?._count._all ?? 0;
  return {
    configured: calendarConfigured(),
    connected: connection.connected,
    reconnectRequired: connection.reconnectRequired,
    email: connection.email,
    enabled: workspace.calendarSyncEnabled,
    // Old workers could leave SYNCED on a workspace with unfinished links. Never
    // report success from the workspace flag alone (also covers an in-flight edit).
    status: !workspace.calendarSyncEnabled ? workspace.calendarSyncStatus
      : count("FAILED") ? "FAILED" : count("PENDING") ? "PENDING" : workspace.calendarSyncStatus,
    syncedBlocks: count("SYNCED"),
    pendingBlocks: count("PENDING"),
    failedBlocks: count("FAILED"),
    lastSuccessfulAt: workspace.calendarLastSuccessfulAt?.toISOString(),
    error: workspace.calendarLastError ?? connection.issue,
  };
}

export async function queueStudyCalendarBlockSync(
  workspace: Pick<StudyWorkspace, "id" | "calendarSyncEnabled">,
  blockId: string,
  operation: "UPSERT" | "DELETE" = "UPSERT",
): Promise<void> {
  if (!workspace.calendarSyncEnabled) return;
  await prisma.$transaction([prisma.studyScheduleCalendarLink.upsert({
    where: { blockId },
    create: {
      workspaceId: workspace.id,
      blockId,
      eventId: deterministicStudyEventId(blockId),
      operation,
      status: "PENDING",
    },
    update: {
      operation,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
    },
  }), prisma.studyWorkspace.updateMany({
    where: { id: workspace.id, calendarSyncEnabled: true },
    data: { calendarSyncStatus: "PENDING", calendarLastError: null },
  })]);
}

export async function stopStudyCalendarSync(workspace: StudyWorkspace): Promise<void> {
  await prisma.studyWorkspace.update({
    where: { id: workspace.id },
    data: { calendarSyncEnabled: false, calendarSyncStatus: "STOPPED", calendarLastError: null },
  });
}

export async function syncStudyTimetable(workspace: StudyWorkspace): Promise<StudyCalendarSnapshot> {
  const connection = await calendarConnectionStatus(workspace.ownerUserId);
  if (!connection.connected) {
    throw new Error(connection.reconnectRequired
      ? "Reconnect Google Calendar before syncing the timetable."
      : "Connect Google Calendar before syncing the timetable.");
  }

  const now = new Date();
  const blocks = await prisma.studyScheduleBlock.findMany({ where: { workspaceId: workspace.id } });
  await prisma.$transaction([
    prisma.studyWorkspace.update({
      where: { id: workspace.id },
      data: { calendarSyncEnabled: true, calendarSyncStatus: "SYNCING", calendarLastAttemptAt: now, calendarLastError: null },
    }),
    ...blocks.map((block) => prisma.studyScheduleCalendarLink.upsert({
      where: { blockId: block.id },
      create: {
        workspaceId: workspace.id,
        blockId: block.id,
        eventId: deterministicStudyEventId(block.id),
        operation: block.active ? "UPSERT" : "DELETE",
        status: "PENDING",
      },
      update: {
        operation: block.active ? "UPSERT" : "DELETE",
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: now,
        lastError: null,
      },
    })),
  ]);

  await processStudyCalendarQueueForWorkspace(workspace.id, INITIAL_SYNC_BATCH_SIZE);
  const refreshed = await prisma.studyWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });
  return studyCalendarSnapshot(refreshed);
}

export async function runPendingStudyCalendarSyncs(now = new Date(), limit = 3): Promise<number> {
  const reconciliationCutoff = DateTime.fromJSDate(now).minus({ minutes: 15 }).toJSDate();
  const staleWorkspaces = await prisma.studyWorkspace.findMany({
    where: {
      calendarSyncEnabled: true,
      calendarSyncStatus: "SYNCED",
      OR: [{ calendarLastSuccessfulAt: null }, { calendarLastSuccessfulAt: { lte: reconciliationCutoff } }],
    },
    take: limit,
  });
  for (const workspace of staleWorkspaces) {
    // Claim and enqueue in one transaction: another scheduler cannot requeue a
    // partially drained workspace, and a crash cannot strand a claim without work.
    // Existing PENDING/FAILED links retain their due time and bounded backoff.
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.studyWorkspace.updateMany({
        where: {
          id: workspace.id, calendarSyncEnabled: true, calendarSyncStatus: "SYNCED",
          OR: [{ calendarLastSuccessfulAt: null }, { calendarLastSuccessfulAt: { lte: reconciliationCutoff } }],
        },
        data: { calendarSyncStatus: "PENDING" },
      });
      if (!claimed.count) return;
      await tx.studyScheduleCalendarLink.updateMany({
        where: { workspaceId: workspace.id, status: "SYNCED" },
        data: { status: "PENDING", attemptCount: 0, nextAttemptAt: now, lastError: null },
      });
      const blocks = await tx.studyScheduleBlock.findMany({
        where: { workspaceId: workspace.id, active: true, calendarLink: null },
        select: { id: true },
      });
      if (blocks.length) await tx.studyScheduleCalendarLink.createMany({
        data: blocks.map((block) => ({
          workspaceId: workspace.id, blockId: block.id,
          eventId: deterministicStudyEventId(block.id), operation: "UPSERT", status: "PENDING",
          nextAttemptAt: now,
        })),
        skipDuplicates: true,
      });
    });
  }
  const links = await prisma.studyScheduleCalendarLink.findMany({
    where: {
      workspace: { calendarSyncEnabled: true },
      status: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      attemptCount: { lt: MAX_RETRY_ATTEMPTS },
    },
    select: { workspaceId: true },
    distinct: ["workspaceId"],
    take: limit,
  });
  // Include newly claimed empty workspaces so they can settle back to SYNCED.
  const workspaceIds = new Set([...links.map((link) => link.workspaceId), ...staleWorkspaces.map((workspace) => workspace.id)]);
  for (const workspaceId of workspaceIds) await processStudyCalendarQueueForWorkspace(workspaceId, 8, now);
  return workspaceIds.size;
}

// Coalesce manual sync and scheduler passes within this service instance. Durable
// pending records survive restarts; deterministic provider IDs remain the retry key.
const processingWorkspaces = new Map<string, Promise<void>>();
async function processStudyCalendarQueueForWorkspace(workspaceId: string, limit: number, now = new Date()): Promise<void> {
  const existing = processingWorkspaces.get(workspaceId);
  if (existing) return existing;
  const running = drainStudyCalendarQueue(workspaceId, limit, now);
  processingWorkspaces.set(workspaceId, running);
  try { await running; } finally { processingWorkspaces.delete(workspaceId); }
}

async function drainStudyCalendarQueue(workspaceId: string, limit: number, now: Date): Promise<void> {
  const workspace = await prisma.studyWorkspace.findUnique({ where: { id: workspaceId } });
  if (!workspace?.calendarSyncEnabled) return;
  const links = await prisma.studyScheduleCalendarLink.findMany({
    where: {
      workspaceId,
      status: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      attemptCount: { lt: MAX_RETRY_ATTEMPTS },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });

  for (const link of links) {
    try {
      const block = await prisma.studyScheduleBlock.findUnique({
        where: { id: link.blockId },
        include: { module: { select: { code: true, name: true } } },
      });
      if (!block || !block.active || link.operation === "DELETE") {
        await removeStudyEventFromGoogleCalendar(workspace.ownerUserId, link.eventId);
        await prisma.studyScheduleCalendarLink.updateMany({
          where: { id: link.id, updatedAt: link.updatedAt },
          data: { status: "REMOVED", lastSyncedAt: now, lastAttemptAt: now, lastError: null, nextAttemptAt: null },
        });
        continue;
      }

      const input = buildStudyCalendarEventInput(workspace, block, link.eventId);
      const syncHash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const synced = await upsertStudyEventInGoogleCalendar(workspace.ownerUserId, input);
      // A local edit can enqueue a newer version during the provider request.
      // Only settle the version we read; leave newer work pending for the next pass.
      await prisma.studyScheduleCalendarLink.updateMany({
        where: { id: link.id, updatedAt: link.updatedAt },
        data: {
          status: "SYNCED",
          operation: "UPSERT",
          syncHash,
          eventUrl: synced.eventUrl,
          attemptCount: 0,
          nextAttemptAt: null,
          lastAttemptAt: now,
          lastSyncedAt: now,
          lastError: null,
        },
      });
    } catch (error) {
      const attemptCount = link.attemptCount + 1;
      await prisma.studyScheduleCalendarLink.updateMany({
        where: { id: link.id, updatedAt: link.updatedAt },
        data: {
          status: "FAILED",
          attemptCount,
          lastAttemptAt: now,
          nextAttemptAt: attemptCount >= MAX_RETRY_ATTEMPTS
            ? null
            : DateTime.fromJSDate(now).plus({ minutes: Math.min(60, 2 ** attemptCount) }).toJSDate(),
          lastError: safeSyncError(error),
        },
      });
    }
  }

  const pending = await prisma.studyScheduleCalendarLink.groupBy({
    by: ["status", "attemptCount"],
    where: { workspaceId, status: { in: ["PENDING", "FAILED"] } },
    _count: { _all: true },
  });
  const remaining = pending.reduce((total, group) => total + group._count._all, 0);
  const failed = pending.some((group) => group.status === "FAILED");
  const exhausted = pending.some((group) => group.status === "FAILED" && group.attemptCount >= MAX_RETRY_ATTEMPTS);
  await prisma.studyWorkspace.updateMany({
    where: { id: workspaceId, calendarSyncEnabled: true },
    data: {
      calendarSyncStatus: remaining ? (failed ? "FAILED" : "PENDING") : "SYNCED",
      calendarLastAttemptAt: now,
      calendarLastSuccessfulAt: remaining ? undefined : now,
      calendarLastError: exhausted ? "Some blocks need attention. Check the Calendar connection, then select Sync now to retry."
        : failed ? "Some timetable blocks could not be synced. Threadwise will retry automatically." : null,
    },
  });
}

export function buildStudyCalendarEventInput(workspace: StudyWorkspace, block: CalendarBlock, eventId: string) {
  const startDate = recurrenceStart(workspace, block);
  const start = DateTime.fromISO(`${startDate.toISODate()}T${block.startTime}`, { zone: workspace.timezone });
  const end = DateTime.fromISO(`${startDate.toISODate()}T${block.endTime}`, { zone: workspace.timezone });
  const endDate = recurrenceEnd(workspace, block);
  const repeats = !endDate || endDate.toISODate() !== startDate.toISODate();
  const recurrence: string[] = [];
  if (repeats) {
    const until = endDate?.endOf("day").toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    recurrence.push(`RRULE:FREQ=WEEKLY;BYDAY=${GOOGLE_WEEKDAYS[start.weekday]}${until ? `;UNTIL=${until}` : ""}`);
    for (const excluded of block.excludedDates) {
      const date = DateTime.fromJSDate(excluded, { zone: "utc" }).toISODate();
      if (date) recurrence.push(`EXDATE;TZID=${workspace.timezone}:${date.replace(/-/gu, "")}T${block.startTime.replace(":", "")}00`);
    }
    if (workspace.semesterStartDate) {
      for (const week of block.excludedWeeks) {
        const date = calendarDateInZone(workspace.semesterStartDate, workspace.timezone)
          .startOf("day").plus({ weeks: week - 1, days: block.dayOfWeek - 1 }).toISODate();
        if (date) recurrence.push(`EXDATE;TZID=${workspace.timezone}:${date.replace(/-/gu, "")}T${block.startTime.replace(":", "")}00`);
      }
    }
  }
  const moduleLine = block.module ? `${block.module.code} · ${block.module.name}` : "Study timetable";
  return {
    eventId,
    blockId: block.id,
    title: block.label,
    details: `${moduleLine}\nManaged by Threadwise. Edits in Google Calendar are replaced during reconciliation.\nThreadwise reference: study-block:${block.id}`,
    location: block.venueName,
    startAt: start.toJSDate(),
    endAt: end.toJSDate(),
    timezone: workspace.timezone,
    recurrence: [...new Set(recurrence)],
  };
}

function recurrenceStart(workspace: StudyWorkspace, block: StudyScheduleBlock): DateTime {
  if (block.recurrenceStartDate) return alignToWeekday(DateTime.fromJSDate(block.recurrenceStartDate, { zone: "utc" }), block.dayOfWeek);
  if (workspace.semesterStartDate) {
    return calendarDateInZone(workspace.semesterStartDate, workspace.timezone)
      .startOf("day").plus({ weeks: Math.max(0, (block.startWeek ?? 1) - 1), days: block.dayOfWeek - 1 });
  }
  return alignToWeekday(DateTime.now().setZone(workspace.timezone).startOf("day"), block.dayOfWeek);
}

function recurrenceEnd(workspace: StudyWorkspace, block: StudyScheduleBlock): DateTime | undefined {
  if (block.recurrenceEndDate) return DateTime.fromJSDate(block.recurrenceEndDate, { zone: "utc" });
  if (!workspace.semesterStartDate || !block.endWeek) return undefined;
  return calendarDateInZone(workspace.semesterStartDate, workspace.timezone)
    .startOf("day").plus({ weeks: block.endWeek - 1, days: block.dayOfWeek - 1 });
}

function calendarDateInZone(value: Date, timezone: string): DateTime {
  const key = DateTime.fromJSDate(value, { zone: "utc" }).toISODate();
  return key ? DateTime.fromISO(key, { zone: timezone }) : DateTime.fromJSDate(value, { zone: timezone }).startOf("day");
}

function alignToWeekday(date: DateTime, dayOfWeek: number): DateTime {
  const delta = (dayOfWeek - date.weekday + 7) % 7;
  return date.plus({ days: delta }).startOf("day");
}

function safeSyncError(error: unknown): string {
  if (error instanceof Error && /reconnect|authorization|denied/iu.test(error.message)) return "CALENDAR_AUTH_REQUIRED";
  if (error instanceof Error && /not configured/iu.test(error.message)) return "CALENDAR_NOT_CONFIGURED";
  return "CALENDAR_PROVIDER_UNAVAILABLE";
}
