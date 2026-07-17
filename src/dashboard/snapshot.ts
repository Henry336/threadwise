import type { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { normalizeClock } from "../utils/clock";
import type { IdeaScore } from "../ai/types";
import { storedIdeaBrief } from "./ideaBrief";

const PERSONAL_TELEGRAM_ID = /^[1-9]\d{0,19}$/;
const DASHBOARD_LIST_LIMIT = 50;
const WEEKLY_ACTIVITY_LIMIT = 1_000;

export type DashboardSnapshot = {
  user: {
    telegramId: string;
    firstName: string;
    fullName: string;
    username?: string;
    timezone: string;
    accent: "iris" | "coral" | "mint";
  };
  generatedAt: string;
  tasks: Array<{
    id: string;
    publicId: string;
    title: string;
    description?: string;
    dueAt?: string;
    status: "OPEN" | "DONE" | "CANCELED";
    recurring?: boolean;
    pinned?: boolean;
    reminderIntervalMinutes?: number;
    nextReminderAt?: string;
    reminderCount?: number;
    snoozedUntil?: string;
    assignee?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  notes: Array<{
    id: string;
    publicId: string;
    title: string;
    body: string;
    summary: string;
    tags: string[];
    createdAt: string;
    pinned?: boolean;
    brief?: IdeaScore;
    updatedAt: string;
  }>;
  ideas: Array<{
    id: string;
    publicId: string;
    title: string;
    concept: string;
    status: "RAW" | "CLARIFIED" | "SELECTED" | "PROTOTYPING" | "BUILT" | "PAUSED" | "REJECTED";
    tags: string[];
    createdAt: string;
    pinned?: boolean;
    updatedAt: string;
  }>;
  expenses: Array<{
    id: string;
    publicId: string;
    merchant: string;
    description: string;
    total: number;
    currency: string;
    category: string;
    transactionAt: string;
    paymentMethod?: string;
    notes?: string;
    excelSyncedAt?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  images: Array<{
    id: string;
    publicId: string;
    mediaKind: string;
    mimeType?: string;
    fileName?: string;
    caption?: string;
    ocrText?: string;
    ocrConfidence?: number;
    pinned?: boolean;
    contentUrl: string;
    createdAt: string;
    updatedAt: string;
  }>;
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
  };
  activity: Array<{ day: string; captures: number; completed: number }>;
  integrations: Array<{
    name: "Gmail" | "Calendar" | "Excel";
    state: "connected" | "attention" | "available";
    detail: string;
  }>;
};

export class DashboardUserNotFoundError extends Error {
  constructor() {
    super("No personal Threadwise user exists for this Telegram account.");
    this.name = "DashboardUserNotFoundError";
  }
}

function accentFor(telegramId: string): "iris" | "coral" | "mint" {
  const accents = ["iris", "coral", "mint"] as const;
  const checksum = [...telegramId].reduce((sum, digit) => sum + Number(digit), 0);
  return accents[checksum % accents.length] ?? "iris";
}

function safeTimezone(value: string | undefined): string {
  if (!value) return "UTC";
  return DateTime.now().setZone(value).isValid ? value : "UTC";
}

function gmailDetail(lastScanAt: Date | null, now: Date): string {
  if (!lastScanAt) return "Connected; no scan recorded yet";

  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - lastScanAt.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Scanned just now";
  if (elapsedMinutes < 60) return `Scanned ${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Scanned ${elapsedHours} hr ago`;
  return `Scanned ${Math.floor(elapsedHours / 24)} d ago`;
}

export async function getDashboardSnapshot(
  telegramId: string,
  database: PrismaClient = prisma,
  now = new Date()
): Promise<DashboardSnapshot> {
  // Synthetic group owners use `chat:<id>` and are deliberately excluded: a
  // human dashboard token can only address its own positive Telegram user id.
  if (!PERSONAL_TELEGRAM_ID.test(telegramId)) {
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
      gmailConnection: { select: { scanEnabled: true, lastScanAt: true } },
      calendarConnection: { select: { createdAt: true } },
      microsoftConnection: { select: { workbookName: true, createdAt: true } }
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
        status: true,
        recurrenceRule: true,
        pinnedAt: true,
        reminderIntervalMinutes: true,
        nextReminderAt: true,
        reminderCount: true,
        snoozedUntil: true,
        assignedUsername: true,
        assignedDisplayName: true,
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
    tasks: tasks.map((task) => ({
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
      ...(task.dueAt ? { dueAt: task.dueAt.toISOString() } : {}),
      status: task.status,
      ...(task.recurrenceRule ? { recurring: true } : {}),
      ...(task.pinnedAt ? { pinned: true } : {}),
      ...(task.reminderIntervalMinutes ? { reminderIntervalMinutes: task.reminderIntervalMinutes } : {}),
      ...(task.nextReminderAt ? { nextReminderAt: task.nextReminderAt.toISOString() } : {}),
      ...(task.reminderCount > 0 ? { reminderCount: task.reminderCount } : {}),
      ...(task.snoozedUntil ? { snoozedUntil: task.snoozedUntil.toISOString() } : {}),
      ...(task.assignedDisplayName
        ? { assignee: task.assignedDisplayName }
        : task.assignedUsername
          ? { assignee: `@${task.assignedUsername}` }
          : {}),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString()
    })),
    notes: notes.map((note) => ({
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      body: note.body,
      summary: note.summary,
      tags: note.tags,
      createdAt: note.createdAt.toISOString(),
      ...(note.pinnedAt ? { pinned: true } : {}),
      updatedAt: note.updatedAt.toISOString()
    })),
    ideas: ideas.map((idea) => ({
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      concept: idea.concept,
      status: idea.status,
      tags: idea.tags,
      createdAt: idea.createdAt.toISOString(),
      ...(idea.pinnedAt ? { pinned: true } : {}),
      ...(storedIdeaBrief(idea.scores) ? { brief: storedIdeaBrief(idea.scores) } : {}),
      updatedAt: idea.updatedAt.toISOString()
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      publicId: expense.publicId,
      merchant: expense.merchant?.trim() || "Unspecified merchant",
      description: expense.description?.trim() || "Expense",
      total: Number(expense.total),
      currency: expense.currency,
      category: expense.category?.trim() || "Other",
      transactionAt: expense.transactionAt.toISOString(),
      ...(expense.paymentMethod ? { paymentMethod: expense.paymentMethod } : {}),
      ...(expense.notes ? { notes: expense.notes } : {}),
      ...(expense.excelSyncedAt ? { excelSyncedAt: expense.excelSyncedAt.toISOString() } : {}),
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString()
    })),
    images: images.map((image) => ({
      id: image.id,
      publicId: image.publicId,
      mediaKind: image.mediaKind,
      ...(image.mimeType ? { mimeType: image.mimeType } : {}),
      ...(image.fileName ? { fileName: image.fileName } : {}),
      ...(image.caption ? { caption: image.caption } : {}),
      ...(image.ocrText ? { ocrText: image.ocrText } : {}),
      ...(typeof image.ocrConfidence === "number" ? { ocrConfidence: image.ocrConfidence } : {}),
      ...(image.pinnedAt ? { pinned: true } : {}),
      contentUrl: `/api/v1/dashboard/images/${encodeURIComponent(image.id)}/content`,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString()
    })),
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
      directNudgesEnabled: user.settings?.directNudgesEnabled ?? false
    },
    activity: [...activityByDate.values()],
    integrations: [
      user.gmailConnection
        ? {
            name: "Gmail",
            state: user.gmailConnection.scanEnabled ? "connected" : "attention",
            detail: user.gmailConnection.scanEnabled ? gmailDetail(user.gmailConnection.lastScanAt, now) : "Scanning is paused"
          }
        : { name: "Gmail", state: "available", detail: "Connect from Telegram" },
      user.calendarConnection
        ? { name: "Calendar", state: "connected", detail: "Calendar connected" }
        : { name: "Calendar", state: "available", detail: "Connect from Telegram" },
      user.microsoftConnection
        ? user.microsoftConnection.workbookName
          ? { name: "Excel", state: "connected", detail: "Workbook connected" }
          : { name: "Excel", state: "attention", detail: "Choose or create a workbook" }
        : { name: "Excel", state: "available", detail: "Connect from Telegram" }
    ]
  };
}
