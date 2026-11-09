/**
 * Builds the main dashboard snapshot: recent tasks, notes, ideas, images and expenses,
 * settings, a seven-day activity chart and integration status, in one request.
 * route.ts adds workspace and collaboration data on top. Row-to-JSON mapping reuses the
 * view helpers in data.ts so the snapshot and the list endpoints return the same shapes.
 */
import type { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { normalizeClock } from "../utils/clock";
import type { DashboardGroupCollaboration } from "./collaboration";
import {
  expenseView,
  ideaView,
  imageView,
  noteView,
  taskView,
  type DashboardExpense,
  type DashboardIdea,
  type DashboardImage,
  type DashboardNote,
  type DashboardTask,
} from "./data";
import { calendarConnectionStatus } from "../services/googleCalendar";
import { normalizeOverviewQuotes, type DashboardOverviewQuote } from "./overviewQuotes";

const DASHBOARD_OWNER_ID = /^(?:[1-9]\d{0,19}|chat:-\d{1,20})$/;
const DASHBOARD_LIST_LIMIT = 50;
const WEEKLY_ACTIVITY_LIMIT = 1_000;

export type DashboardSnapshot = {
  workspace?: {
    id: string;
    kind: "PERSONAL" | "GROUP";
    name: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    memberCount?: number;
  };
  collaboration?: DashboardGroupCollaboration;
  user: {
    telegramId: string;
    firstName: string;
    fullName: string;
    username?: string;
    timezone: string;
    accent: "iris" | "coral" | "mint";
  };
  generatedAt: string;
  tasks: DashboardTask[];
  notes: DashboardNote[];
  ideas: DashboardIdea[];
  expenses: DashboardExpense[];
  images: DashboardImage[];
  settings: {
    timezone: string;
    reminderIntervalMinutes: number;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    maxRemindersPerDay: number;
    dueNudgeMinutes: number;
    reminderMode: "INDIVIDUAL" | "DIGEST";
    expenseCurrency: string;
    ocrLanguages: string;
    directNudgesEnabled: boolean;
    calendarAutoSync: boolean;
    excelAutoSync: boolean;
    overviewQuotes: DashboardOverviewQuote[];
    morningBriefEnabled: boolean;
    morningBriefTime: string;
    eveningDebriefEnabled: boolean;
    eveningDebriefTime: string;
  };
  activity: Array<{ day: string; captures: number; completed: number }>;
  integrations: Array<{
    provider: "calendar" | "excel";
    name: "Calendar" | "Excel";
    state: "connected" | "attention" | "available";
    detail: string;
    accountEmail?: string;
    autoSync: boolean;
    syncedCount: number;
    unsyncedCount: number;
    workbookName?: string;
    workbookUrl?: string;
  }>;
};

export class DashboardUserNotFoundError extends Error {
  constructor() {
    super("No personal Threadwise user exists for this Telegram account.");
    this.name = "DashboardUserNotFoundError";
  }
}

/** Picks a stable accent colour per user from a simple checksum of their id, so it never changes between loads. */
function accentFor(telegramId: string): "iris" | "coral" | "mint" {
  const accents = ["iris", "coral", "mint"] as const;
  const checksum = [...telegramId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return accents[checksum % accents.length] ?? "iris";
}

/** Falls back to UTC when the stored timezone is missing or not a valid IANA zone, so date math never breaks. */
function safeTimezone(value: string | undefined): string {
  if (!value) return "UTC";
  return DateTime.now().setZone(value).isValid ? value : "UTC";
}

/**
 * Loads everything for one owner (a human, or a group's synthetic "chat:<id>" owner) in
 * parallel queries, each capped at 50 rows. Activity counts captures and completions per day
 * in the user's timezone. Group owners get no integrations, since those are personal accounts.
 */
export async function getDashboardSnapshot(
  telegramId: string,
  database: PrismaClient = prisma,
  now = new Date()
): Promise<DashboardSnapshot> {
  // A synthetic group owner is accepted only after the route has resolved a
  // signed human principal through an active GroupMembership.
  if (!DASHBOARD_OWNER_ID.test(telegramId)) {
    throw new DashboardUserNotFoundError();
  }

  const user = await database.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      settings: true,
      calendarConnection: { select: { calendarEmail: true, createdAt: true } },
      microsoftConnection: {
        select: {
          microsoftEmail: true,
          workbookName: true,
          workbookWebUrl: true,
          createdAt: true
        }
      }
    }
  });

  if (!user) {
    throw new DashboardUserNotFoundError();
  }

  const timezone = safeTimezone(user.settings?.timezone);
  const today = DateTime.fromJSDate(now).setZone(timezone).startOf("day");
  const activityStart = today.minus({ days: 6 }).toUTC().toJSDate();

  const [tasks, notes, ideas, expenses, images, taskEvents, noteEvents, ideaEvents, expenseEvents, reflectionEvents] = await Promise.all([
    database.task.findMany({
      where: {
        userId: user.id,
        archivedAt: null,
        OR: [{ status: "OPEN" }, { status: "DONE", completedAt: { gte: activityStart } }]
      },
      select: {
        id: true,
        publicId: true,
        title: true,
        description: true,
        dueAt: true,
        plannedFor: true,
        firstPlannedFor: true,
        status: true,
        audience: true,
        recurrenceRule: true,
        pinnedAt: true,
        reminderIntervalMinutes: true,
        nextReminderAt: true,
        snoozedUntil: true,
        calendarEventId: true,
        calendarEventUrl: true,
        calendarSyncedAt: true,
        teamOwnerLabel: true,
        assignees: {
          select: {
            id: true,
            telegramId: true,
            username: true,
            displayName: true,
            status: true,
            statusReason: true,
            respondedAt: true,
            updatedAt: true
          },
          orderBy: { createdAt: "asc" }
        },
        reminderSchedules: {
          where: { status: { in: ["PENDING", "PROCESSING"] } },
          select: { scheduledAt: true, status: true },
          orderBy: { scheduledAt: "asc" }
        },
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIST_LIMIT
    }),
    database.note.findMany({
      where: { userId: user.id, archivedAt: null, mergedIntoNoteId: null },
      select: { id: true, publicId: true, title: true, body: true, summary: true, tags: true, createdAt: true, updatedAt: true, pinnedAt: true },
      orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIST_LIMIT
    }),
    database.idea.findMany({
      where: { userId: user.id, archivedAt: null },
      select: { id: true, publicId: true, title: true, concept: true, status: true, tags: true, scores: true, createdAt: true, updatedAt: true, pinnedAt: true },
      orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIST_LIMIT
    }),
    database.expense.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        publicId: true,
        merchant: true,
        description: true,
        total: true,
        currency: true,
        category: true,
        transactionAt: true,
        paymentMethod: true,
        notes: true,
        excelSyncedAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIST_LIMIT
    }),
    database.storedImage.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        publicId: true,
        mediaKind: true,
        mimeType: true,
        fileName: true,
        caption: true,
        ocrText: true,
        ocrConfidence: true,
        pinnedAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIST_LIMIT
    }),
    database.task.findMany({
      where: {
        userId: user.id,
        OR: [{ createdAt: { gte: activityStart } }, { completedAt: { gte: activityStart } }]
      },
      select: { createdAt: true, completedAt: true },
      orderBy: { createdAt: "desc" },
      take: WEEKLY_ACTIVITY_LIMIT
    }),
    database.note.findMany({
      where: { userId: user.id, createdAt: { gte: activityStart } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: WEEKLY_ACTIVITY_LIMIT
    }),
    database.idea.findMany({
      where: { userId: user.id, createdAt: { gte: activityStart } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: WEEKLY_ACTIVITY_LIMIT
    }),
    database.expense.findMany({
      where: { userId: user.id, createdAt: { gte: activityStart } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: WEEKLY_ACTIVITY_LIMIT
    }),
    database.reflection.findMany({
      where: { userId: user.id, createdAt: { gte: activityStart } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: WEEKLY_ACTIVITY_LIMIT
    })
  ]);

  const activityByDate = new Map<string, { day: string; captures: number; completed: number }>();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = today.minus({ days: offset });
    const key = date.toISODate();
    if (key) activityByDate.set(key, { day: date.toFormat("ccc"), captures: 0, completed: 0 });
  }

  const addToActivity = (date: Date | null, field: "captures" | "completed") => {
    if (!date) return;
    const key = DateTime.fromJSDate(date).setZone(timezone).toISODate();
    const row = key ? activityByDate.get(key) : undefined;
    if (row) row[field] += 1;
  };

  for (const task of taskEvents) {
    addToActivity(task.createdAt, "captures");
    addToActivity(task.completedAt, "completed");
  }
  for (const note of noteEvents) addToActivity(note.createdAt, "captures");
  for (const idea of ideaEvents) addToActivity(idea.createdAt, "captures");
  for (const expense of expenseEvents) addToActivity(expense.createdAt, "captures");
  for (const reflection of reflectionEvents) addToActivity(reflection.createdAt, "captures");

  const firstName = user.firstName?.trim() || user.username?.trim() || "Threadwise user";
  const fullName = [user.firstName, user.lastName].filter((part): part is string => Boolean(part?.trim())).join(" ") || firstName;

  const quietHoursStart = normalizeClock(user.settings?.quietHoursStart);
  const quietHoursEnd = normalizeClock(user.settings?.quietHoursEnd);
  const calendarHealth = !telegramId.startsWith("chat:")
    ? await calendarConnectionStatus(user.id)
    : undefined;

  return {
    user: {
      telegramId: user.telegramId,
      firstName,
      fullName,
      ...(user.username ? { username: user.username } : {}),
      timezone,
      accent: accentFor(user.telegramId)
    },
    generatedAt: now.toISOString(),
    tasks: tasks.map(taskView),
    notes: notes.map(noteView),
    ideas: ideas.map(ideaView),
    expenses: expenses.map(expenseView),
    images: images.map(imageView),
    settings: {
      timezone,
      reminderIntervalMinutes: user.settings?.reminderIntervalMinutes ?? 180,
      ...(quietHoursStart ? { quietHoursStart } : {}),
      ...(quietHoursEnd ? { quietHoursEnd } : {}),
      maxRemindersPerDay: user.settings?.maxRemindersPerDay ?? 200,
      dueNudgeMinutes: user.settings?.dueNudgeMinutes ?? 3,
      reminderMode: user.settings?.reminderMode ?? "INDIVIDUAL",
      expenseCurrency: user.settings?.expenseCurrency ?? "SGD",
      ocrLanguages: user.settings?.ocrLanguages ?? "eng",
      directNudgesEnabled: user.settings?.directNudgesEnabled ?? false,
      calendarAutoSync: user.settings?.calendarAutoSync ?? false,
      excelAutoSync: user.settings?.excelAutoSync ?? false,
      overviewQuotes: normalizeOverviewQuotes(user.settings?.overviewQuotes),
      morningBriefEnabled: user.settings?.morningBriefEnabled ?? false,
      morningBriefTime: user.settings?.morningBriefTime ?? "08:00",
      eveningDebriefEnabled: user.settings?.eveningDebriefEnabled ?? false,
      eveningDebriefTime: user.settings?.eveningDebriefTime ?? "21:00"
    },
    activity: [...activityByDate.values()],
    // Each integration is "connected", "attention" (needs reconnect or setup) or "available".
    integrations: telegramId.startsWith("chat:") ? [] : [
      calendarHealth?.reconnectRequired
        ? {
            provider: "calendar",
            name: "Calendar",
            state: "attention",
            detail: "Reconnect required",
            ...(calendarHealth.email ? { accountEmail: calendarHealth.email } : {}),
            autoSync: calendarHealth.autoSync,
            syncedCount: calendarHealth.syncedTasks,
            unsyncedCount: tasks.filter((task) => Boolean(task.dueAt) && !task.calendarEventId && task.status === "OPEN").length,
          }
        : user.calendarConnection
        ? {
            provider: "calendar",
            name: "Calendar",
            state: "connected",
            detail: `${tasks.filter((task) => Boolean(task.calendarEventId)).length} dated task${tasks.filter((task) => Boolean(task.calendarEventId)).length === 1 ? "" : "s"} synced`,
            ...(user.calendarConnection.calendarEmail ? { accountEmail: user.calendarConnection.calendarEmail } : {}),
            autoSync: user.settings?.calendarAutoSync ?? false,
            syncedCount: tasks.filter((task) => Boolean(task.calendarEventId)).length,
            unsyncedCount: tasks.filter((task) => Boolean(task.dueAt) && !task.calendarEventId && task.status === "OPEN").length
          }
        : {
            provider: "calendar",
            name: "Calendar",
            state: "available",
            detail: "Not connected",
            autoSync: false,
            syncedCount: 0,
            unsyncedCount: tasks.filter((task) => Boolean(task.dueAt) && task.status === "OPEN").length
          },
      user.microsoftConnection
        ? user.microsoftConnection.workbookName
          ? {
              provider: "excel",
              name: "Excel",
              state: "connected",
              detail: user.microsoftConnection.workbookName,
              ...(user.microsoftConnection.microsoftEmail ? { accountEmail: user.microsoftConnection.microsoftEmail } : {}),
              autoSync: user.settings?.excelAutoSync ?? false,
              syncedCount: expenses.filter((expense) => Boolean(expense.excelSyncedAt)).length,
              unsyncedCount: expenses.filter((expense) => !expense.excelSyncedAt).length,
              workbookName: user.microsoftConnection.workbookName,
              ...(user.microsoftConnection.workbookWebUrl ? { workbookUrl: user.microsoftConnection.workbookWebUrl } : {})
            }
          : {
              provider: "excel",
              name: "Excel",
              state: "attention",
              detail: "Workbook setup needed",
              ...(user.microsoftConnection.microsoftEmail ? { accountEmail: user.microsoftConnection.microsoftEmail } : {}),
              autoSync: user.settings?.excelAutoSync ?? false,
              syncedCount: expenses.filter((expense) => Boolean(expense.excelSyncedAt)).length,
              unsyncedCount: expenses.filter((expense) => !expense.excelSyncedAt).length
            }
        : {
            provider: "excel",
            name: "Excel",
            state: "available",
            detail: "Not connected",
            autoSync: false,
            syncedCount: 0,
            unsyncedCount: expenses.length
          }
    ]
  };
}
