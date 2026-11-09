import { ReminderMode, TaskStatus, VoiceCleanupMode, type UserSettings } from "@prisma/client";
import { vi } from "vitest";
import type { TaskListItem } from "../services/tasks";

// Shared test builders. Each returns a neutral default so a test only spells out the
// fields its fault depends on.

/** An open, undated, unpinned, unassigned personal task created on 5 July 2026. */
export function task(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: overrides.id ?? overrides.publicId ?? "task-id",
    publicId: "TASK-1",
    title: "Task",
    description: null,
    sourceText: overrides.sourceText ?? overrides.title ?? "Task",
    status: TaskStatus.OPEN,
    dueAt: null,
    timezone: "Asia/Singapore",
    calendarUrl: null,
    calendarEventId: null,
    calendarEventUrl: null,
    calendarSyncedAt: null,
    reminderIntervalMinutes: 180,
    nextReminderAt: null,
    snoozedUntil: null,
    lastRemindedAt: null,
    reminderCount: 0,
    assignedTelegramId: null,
    assignedUsername: null,
    assignedDisplayName: null,
    recurrenceRule: null,
    recurrenceIntervalDays: null,
    pinnedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-07-05T00:00:00.000Z"),
    updatedAt: new Date("2026-07-05T00:00:00.000Z"),
    ...overrides
  };
}

/** A UserSettings row carrying the schema defaults from prisma/schema.prisma. */
export function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "settings-1",
    userId: "user-1",
    reminderIntervalMinutes: 180,
    timezone: "Asia/Singapore",
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    maxRemindersPerDay: 200,
    dueNudgeMinutes: 3,
    reminderMode: ReminderMode.INDIVIDUAL,
    reminderChatId: null,
    expenseCurrency: "SGD",
    ocrLanguages: "eng",
    directNudgesEnabled: false,
    calendarAutoSync: false,
    excelAutoSync: false,
    overviewQuotes: [],
    morningBriefEnabled: false,
    morningBriefTime: "08:00",
    eveningDebriefEnabled: false,
    eveningDebriefTime: "21:00",
    voiceCleanupMode: VoiceCleanupMode.LIGHT,
    voiceTranscriptionModel: "gpt-4o-mini-transcribe",
    voiceLanguageHint: null,
    voiceAutoTranscribeAudio: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

/**
 * A Prisma client stand-in: the model fakes passed in, plus a `$transaction` spy that
 * runs an interactive callback against `tx` (the client itself by default) and settles
 * an array batch with Promise.all. It checks no isolation; use a real database for that.
 */
export function fakePrisma<T extends object>(models: T, tx?: object) {
  const client = models as T & { $transaction: ReturnType<typeof vi.fn<(input: unknown) => Promise<unknown>>> };
  client.$transaction = vi.fn(async (input: unknown) => (
    typeof input === "function"
      ? (input as (database: unknown) => unknown)(tx ?? client)
      : Promise.all(input as unknown[])
  ));
  return client;
}
