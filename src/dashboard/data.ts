import {
  IdeaStatus,
  Prisma,
  ReminderMode,
  TaskStatus,
  type PrismaClient,
  type UserSettings
} from "@prisma/client";
import { DateTime } from "luxon";
import type { AiProvider, IdeaScore } from "../ai/types";
import { prisma } from "../db/prisma";
import { nextRecurringDueAt, recurrenceDayOfMonth } from "../utils/dates";
import { normalizeClock } from "../utils/clock";
import { createGoogleCalendarUrl } from "../services/calendar";
import { nextPublicId } from "../services/publicIds";
import { nextDueReminderAt } from "../services/reminders";
import {
  recordArchiveUndo,
  recordCreateUndo,
  recordFieldEditUndo,
  recordImageCaptionUndo,
  recordPinUndo,
  recordRenameUndo,
  recordRescheduleUndo,
  recordTaskStateUndo
} from "../services/undo";
import { DashboardUserNotFoundError } from "./snapshot";
import { storedIdeaBrief } from "./ideaBrief";
import type {
  ExpenseCreateInput,
  ExpenseUpdateInput,
  IdeaConvertInput,
  IdeaCreateInput,
  IdeaUpdateInput,
  ImageUpdateInput,
  NoteCreateInput,
  NoteUpdateInput,
  SettingsUpdateInput,
  TaskCreateInput,
  TaskUpdateInput
} from "./schemas";

const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024;
const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;
const SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const DASHBOARD_OWNER_ID = /^(?:[1-9]\d{0,19}|chat:-\d{1,20})$/;
const PUBLIC_ID_CREATE_ATTEMPTS = 3;

type PublicIdKind = "IDEA" | "TASK" | "NOTE" | "EXP";

async function createWithPublicIdRetry<T>(
  database: PrismaClient,
  userId: string,
  kind: PublicIdKind,
  create: (tx: Prisma.TransactionClient, publicId: string) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.$transaction(async (tx) => create(tx, await nextPublicId(userId, kind, tx)));
    } catch (error) {
      if (attempt >= PUBLIC_ID_CREATE_ATTEMPTS || !isPublicIdUniqueConflict(error)) throw error;
    }
  }
}

function isPublicIdUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.some((field) => field === "publicId");
  return typeof target === "string" && target.toLowerCase().includes("publicid");
}

async function syncUnsyncedExpensesForDashboard(userId: string, timezone: string): Promise<number> {
  const { syncUnsyncedExpenses } = await import("../services/excel");
  return syncUnsyncedExpenses(userId, timezone);
}

export class DashboardItemNotFoundError extends Error {
  constructor() {
    super("The requested dashboard item was not found.");
    this.name = "DashboardItemNotFoundError";
  }
}

export class DashboardConflictError extends Error {
  constructor() {
    super("This item changed somewhere else. Refresh it before saving your edit.");
    this.name = "DashboardConflictError";
  }
}

export class DashboardUpstreamError extends Error {
  constructor() {
    super("The image could not be loaded from Telegram.");
    this.name = "DashboardUpstreamError";
  }
}

export class DashboardUnsupportedMediaError extends Error {
  constructor() {
    super("Only safe raster image formats can be displayed in the dashboard.");
    this.name = "DashboardUnsupportedMediaError";
  }
}

function assertExpectedRevision(expectedUpdatedAt: string | undefined, currentUpdatedAt: Date): void {
  if (expectedUpdatedAt && currentUpdatedAt.toISOString() !== expectedUpdatedAt) {
    throw new DashboardConflictError();
  }
}

function throwIfRevisionConflict(error: unknown, expectedUpdatedAt: string | undefined): void {
  if (!expectedUpdatedAt || !error || typeof error !== "object") return;
  if ((error as { code?: unknown }).code === "P2025") throw new DashboardConflictError();
}

type DashboardUserContext = {
  id: string;
  telegramId: string;
  settings: UserSettings;
};

export type DashboardTask = {
  id: string;
  publicId: string;
  title: string;
  description?: string;
  dueAt?: string;
  status: TaskStatus;
  recurring: boolean;
  pinned: boolean;
  reminderIntervalMinutes?: number;
  nextReminderAt?: string;
  snoozedUntil?: string;
  assignees: Array<{
    id: string;
    telegramId?: string;
    username?: string;
    displayName: string;
    status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";
    statusReason?: string;
    respondedAt?: string;
    updatedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type DashboardNote = {
  id: string;
  publicId: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DashboardIdea = {
  id: string;
  publicId: string;
  title: string;
  concept: string;
  status: IdeaStatus;
  tags: string[];
  pinned: boolean;
  brief?: IdeaScore;
  createdAt: string;
  updatedAt: string;
};

export type DashboardExpense = {
  id: string;
  publicId: string;
  merchant?: string;
  description?: string;
  total: number;
  currency: string;
  category?: string;
  transactionAt: string;
  paymentMethod?: string;
  notes?: string;
  excelSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardImage = {
  id: string;
  publicId: string;
  mediaKind: string;
  mimeType?: string;
  fileName?: string;
  caption?: string;
  ocrText?: string;
  ocrConfidence?: number;
  pinned: boolean;
  contentUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardSettings = {
  timezone: string;
  reminderIntervalMinutes: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  maxRemindersPerDay: number;
  dueNudgeMinutes: number;
  reminderMode: ReminderMode;
  expenseCurrency: string;
  ocrLanguages: string;
  directNudgesEnabled: boolean;
};

export type DashboardPage<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

function pageResult<T>(items: T[], page: number, limit: number, total: number): DashboardPage<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { items, page, limit, total, totalPages, hasMore: page * limit < total };
}

async function userContext(telegramId: string, database: PrismaClient = prisma): Promise<DashboardUserContext> {
  if (!DASHBOARD_OWNER_ID.test(telegramId)) throw new DashboardUserNotFoundError();
  const user = await database.user.findUnique({
    where: { telegramId },
    select: { id: true, telegramId: true, settings: true }
  });
  if (!user?.settings) throw new DashboardUserNotFoundError();
  return { id: user.id, telegramId: user.telegramId, settings: user.settings };
}

function itemReference(id: string): Array<{ id: string } | { publicId: string }> {
  return [{ id }, { publicId: id.toUpperCase() }];
}

function compactSummary(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

function taskView(task: {
  id: string; publicId: string; title: string; description: string | null; dueAt: Date | null; status: TaskStatus;
  recurrenceRule: unknown | null; pinnedAt: Date | null; reminderIntervalMinutes: number | null; nextReminderAt: Date | null;
  snoozedUntil: Date | null;
  assignees?: Array<{
    id: string; telegramId: string | null; username: string | null; displayName: string | null;
    status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED"; statusReason: string | null;
    respondedAt: Date | null; updatedAt: Date;
  }>;
  createdAt: Date; updatedAt: Date;
}): DashboardTask {
  return {
    id: task.id,
    publicId: task.publicId,
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    ...(task.dueAt ? { dueAt: task.dueAt.toISOString() } : {}),
    status: task.status,
    recurring: Boolean(task.recurrenceRule),
    pinned: Boolean(task.pinnedAt),
    ...(task.reminderIntervalMinutes ? { reminderIntervalMinutes: task.reminderIntervalMinutes } : {}),
    ...(task.nextReminderAt ? { nextReminderAt: task.nextReminderAt.toISOString() } : {}),
    ...(task.snoozedUntil ? { snoozedUntil: task.snoozedUntil.toISOString() } : {}),
    assignees: (task.assignees ?? []).map((assignee) => ({
      id: assignee.id,
      ...(assignee.telegramId ? { telegramId: assignee.telegramId } : {}),
      ...(assignee.username ? { username: assignee.username } : {}),
      displayName: assignee.displayName || (assignee.username ? `@${assignee.username}` : "Assigned member"),
      status: assignee.status,
      ...(assignee.statusReason ? { statusReason: assignee.statusReason } : {}),
      ...(assignee.respondedAt ? { respondedAt: assignee.respondedAt.toISOString() } : {}),
      updatedAt: assignee.updatedAt.toISOString(),
    })),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

function noteView(note: {
  id: string; publicId: string; title: string; body: string; summary: string; tags: string[]; pinnedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): DashboardNote {
  return {
    id: note.id, publicId: note.publicId, title: note.title, body: note.body, summary: note.summary,
    tags: note.tags, pinned: Boolean(note.pinnedAt), createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString()
  };
}

function ideaView(idea: {
  id: string; publicId: string; title: string; concept: string; status: IdeaStatus; tags: string[]; pinnedAt: Date | null;
  scores?: Prisma.JsonValue | null;
  createdAt: Date; updatedAt: Date;
}): DashboardIdea {
  const brief = storedIdeaBrief(idea.scores);
  return {
    id: idea.id, publicId: idea.publicId, title: idea.title, concept: idea.concept, status: idea.status,
    tags: idea.tags, pinned: Boolean(idea.pinnedAt), ...(brief ? { brief } : {}),
    createdAt: idea.createdAt.toISOString(), updatedAt: idea.updatedAt.toISOString()
  };
}

function expenseView(expense: {
  id: string; publicId: string; merchant: string | null; description: string | null; total: Prisma.Decimal; currency: string;
  category: string | null; transactionAt: Date; paymentMethod: string | null; notes: string | null; excelSyncedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): DashboardExpense {
  return {
    id: expense.id,
    publicId: expense.publicId,
    ...(expense.merchant ? { merchant: expense.merchant } : {}),
    ...(expense.description ? { description: expense.description } : {}),
    total: Number(expense.total),
    currency: expense.currency,
    ...(expense.category ? { category: expense.category } : {}),
    transactionAt: expense.transactionAt.toISOString(),
    ...(expense.paymentMethod ? { paymentMethod: expense.paymentMethod } : {}),
    ...(expense.notes ? { notes: expense.notes } : {}),
    ...(expense.excelSyncedAt ? { excelSyncedAt: expense.excelSyncedAt.toISOString() } : {}),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString()
  };
}

export function imageView(image: {
  id: string; publicId: string; mediaKind: string; mimeType: string | null; fileName: string | null;
  caption: string | null; ocrText: string | null; ocrConfidence: number | null; pinnedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): DashboardImage {
  return {
    id: image.id,
    publicId: image.publicId,
    mediaKind: image.mediaKind,
    ...(image.mimeType ? { mimeType: image.mimeType } : {}),
    ...(image.fileName ? { fileName: image.fileName } : {}),
    ...(image.caption ? { caption: image.caption } : {}),
    ...(image.ocrText ? { ocrText: image.ocrText } : {}),
    ...(typeof image.ocrConfidence === "number" ? { ocrConfidence: image.ocrConfidence } : {}),
    pinned: Boolean(image.pinnedAt),
    contentUrl: `/api/v1/dashboard/images/${encodeURIComponent(image.id)}/content`,
    createdAt: image.createdAt.toISOString(),
    updatedAt: image.updatedAt.toISOString()
  };
}

export function settingsView(settings: UserSettings): DashboardSettings {
  const quietHoursStart = normalizeClock(settings.quietHoursStart);
  const quietHoursEnd = normalizeClock(settings.quietHoursEnd);
  return {
    timezone: settings.timezone,
    reminderIntervalMinutes: settings.reminderIntervalMinutes,
    ...(quietHoursStart ? { quietHoursStart } : {}),
    ...(quietHoursEnd ? { quietHoursEnd } : {}),
    maxRemindersPerDay: settings.maxRemindersPerDay,
    dueNudgeMinutes: settings.dueNudgeMinutes,
    reminderMode: settings.reminderMode,
    expenseCurrency: settings.expenseCurrency,
    ocrLanguages: settings.ocrLanguages,
    directNudgesEnabled: settings.directNudgesEnabled
  };
}

function nextReminder(dueAt: Date | null, interval: number, dueNudgeMinutes: number, now = new Date()): Date {
  return dueAt ? nextDueReminderAt(dueAt, dueNudgeMinutes, now) : new Date(now.getTime() + interval * 60_000);
}

export async function listDashboardTasks(
  telegramId: string,
  options: { page: number; limit: number; q?: string; status?: TaskStatus },
  database: PrismaClient = prisma
): Promise<DashboardPage<DashboardTask>> {
  const user = await userContext(telegramId, database);
  const where: Prisma.TaskWhereInput = {
    userId: user.id,
    archivedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.q ? { OR: [{ title: { contains: options.q, mode: "insensitive" } }, { description: { contains: options.q, mode: "insensitive" } }] } : {})
  };
  const [total, items] = await Promise.all([
    database.task.count({ where }),
    database.task.findMany({ where, include: { assignees: { orderBy: { createdAt: "asc" } } }, orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }], skip: (options.page - 1) * options.limit, take: options.limit })
  ]);
  return pageResult(items.map(taskView), options.page, options.limit, total);
}

export async function createDashboardTask(telegramId: string, input: TaskCreateInput, database: PrismaClient = prisma): Promise<DashboardTask> {
  const user = await userContext(telegramId, database);
  const dueAt = input.dueAt === null || input.dueAt === undefined ? null : new Date(input.dueAt);
  const interval = input.reminderIntervalMinutes ?? user.settings.reminderIntervalMinutes;
  const task = await createWithPublicIdRetry(database, user.id, "TASK", async (tx, publicId) => {
    const created = await tx.task.create({
      data: {
        userId: user.id,
        publicId,
        title: input.title,
        description: input.description ?? null,
        sourceText: input.description ? `${input.title}\n${input.description}` : input.title,
        dueAt,
        timezone: user.settings.timezone,
        reminderIntervalMinutes: interval,
        nextReminderAt: nextReminder(dueAt, interval, user.settings.dueNudgeMinutes),
        calendarUrl: dueAt ? createGoogleCalendarUrl({ title: input.title, details: input.description ?? input.title, dueAt, timezone: user.settings.timezone }) : null
      },
      include: { assignees: true },
    });
    await recordCreateUndo(tx, user.id, { kind: "task", id: created.id, publicId: created.publicId, title: created.title });
    return created;
  });
  return taskView(task);
}

async function scopedTask(database: PrismaClient, userId: string, id: string) {
  const task = await database.task.findFirst({
    where: { userId, archivedAt: null, OR: itemReference(id) },
    include: { assignees: { orderBy: { createdAt: "asc" } } },
  });
  if (!task) throw new DashboardItemNotFoundError();
  return task;
}

export async function updateDashboardTask(telegramId: string, id: string, input: TaskUpdateInput, database: PrismaClient = prisma): Promise<DashboardTask> {
  const user = await userContext(telegramId, database);
  const task = await scopedTask(database, user.id, id);
  assertExpectedRevision(input.expectedUpdatedAt, task.updatedAt);
  const data: Prisma.TaskUncheckedUpdateInput = {};
  const nextTitle = input.title ?? task.title;
  const nextDescription = "description" in input ? input.description ?? null : task.description;
  const nextDueAt = "dueAt" in input ? input.dueAt ? new Date(input.dueAt) : null : task.dueAt;
  const interval = "reminderIntervalMinutes" in input
    ? input.reminderIntervalMinutes ?? user.settings.reminderIntervalMinutes
    : task.reminderIntervalMinutes ?? user.settings.reminderIntervalMinutes;
  const statusChanged = input.status !== undefined && input.status !== task.status;
  const titleChanged = input.title !== undefined && input.title !== task.title;
  const descriptionChanged = "description" in input && nextDescription !== task.description;
  const dueChanged = "dueAt" in input && nextDueAt?.getTime() !== task.dueAt?.getTime();
  const pinnedChanged = input.pinned !== undefined && input.pinned !== Boolean(task.pinnedAt);
  const nextSnoozedUntil = "snoozedUntil" in input ? input.snoozedUntil ? new Date(input.snoozedUntil) : null : task.snoozedUntil;
  const snoozeChanged = "snoozedUntil" in input && nextSnoozedUntil?.getTime() !== task.snoozedUntil?.getTime();
  const nextTimezone = dueChanged ? user.settings.timezone : task.timezone ?? "UTC";

  if (titleChanged) data.title = input.title;
  if (descriptionChanged) {
    data.description = input.description ?? null;
    data.embedding = Prisma.JsonNull;
  }
  if (dueChanged) {
    data.dueAt = nextDueAt;
    data.timezone = user.settings.timezone;
    data.recurrenceDayOfMonth = recurrenceDayOfMonth(
      nextDueAt ?? undefined,
      task.recurrenceRule ?? undefined,
      nextTimezone
    ) ?? null;
  }
  if ("reminderIntervalMinutes" in input) data.reminderIntervalMinutes = input.reminderIntervalMinutes;
  if (pinnedChanged) data.pinnedAt = input.pinned ? new Date() : null;
  if (snoozeChanged) {
    if (nextSnoozedUntil && nextSnoozedUntil.getTime() <= Date.now()) {
      throw new DashboardValidationError("A snooze time must be in the future.");
    }
    data.snoozedUntil = nextSnoozedUntil;
    if (task.status === TaskStatus.OPEN) {
      data.nextReminderAt = nextSnoozedUntil ?? nextReminder(nextDueAt, interval, user.settings.dueNudgeMinutes);
    }
  }

  if (titleChanged || descriptionChanged || dueChanged) {
    data.calendarUrl = nextDueAt
      ? createGoogleCalendarUrl({ title: nextTitle, details: nextDescription ?? task.sourceText, dueAt: nextDueAt, timezone: nextTimezone })
      : null;
  }

  if (statusChanged && input.status === TaskStatus.DONE) {
    const completedAt = new Date();
    if (task.recurrenceRule && nextDueAt) {
      const monthlyDay = dueChanged
        ? recurrenceDayOfMonth(nextDueAt, task.recurrenceRule, nextTimezone)
        : task.recurrenceDayOfMonth;
      const rolledDueAt = nextRecurringDueAt(
        nextDueAt,
        task.recurrenceRule,
        nextTimezone,
        completedAt,
        monthlyDay
      );
      data.status = TaskStatus.OPEN;
      data.completedAt = completedAt;
      data.dueAt = rolledDueAt;
      data.timezone = nextTimezone;
      data.nextReminderAt = rolledDueAt;
      data.snoozedUntil = null;
      data.recurrenceDayOfMonth = monthlyDay ?? null;
      data.calendarUrl = createGoogleCalendarUrl({
        title: nextTitle,
        details: nextDescription ?? task.sourceText,
        dueAt: rolledDueAt,
        timezone: nextTimezone
      });
    } else {
      data.status = TaskStatus.DONE;
      data.completedAt = completedAt;
      data.nextReminderAt = null;
      data.snoozedUntil = null;
    }
  } else if (statusChanged && input.status === TaskStatus.CANCELED) {
    data.status = TaskStatus.CANCELED;
    data.nextReminderAt = null;
    data.snoozedUntil = null;
  } else if (statusChanged && input.status === TaskStatus.OPEN) {
    data.status = TaskStatus.OPEN;
    data.completedAt = null;
    data.snoozedUntil = null;
    data.nextReminderAt = nextReminder(nextDueAt, interval, user.settings.dueNudgeMinutes);
  } else if (task.status === TaskStatus.OPEN && (dueChanged || "reminderIntervalMinutes" in input)) {
    data.nextReminderAt = nextReminder(nextDueAt, interval, user.settings.dueNudgeMinutes);
  }

  if (Object.keys(data).length === 0) return taskView(task);

  const needsUndo = statusChanged || titleChanged || descriptionChanged || dueChanged || pinnedChanged || snoozeChanged;
  const revisionWhere: Prisma.TaskWhereUniqueInput = {
    id: task.id,
    ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {})
  };
  let updated;
  try {
    updated = needsUndo
      ? await database.$transaction(async (tx) => {
        if (titleChanged) {
          await recordRenameUndo(tx, user.id, { kind: "task", id: task.id, publicId: task.publicId, title: nextTitle }, task.title);
        }
        if (descriptionChanged) {
          await recordFieldEditUndo(
            tx,
            user.id,
            { kind: "task", id: task.id, publicId: task.publicId, title: nextTitle },
            "description",
            task.description
          );
        }
        if ((dueChanged || snoozeChanged) && !statusChanged) await recordRescheduleUndo(tx, user.id, task);
        if (pinnedChanged) {
          await recordPinUndo(tx, user.id, { kind: "task", id: task.id, publicId: task.publicId, title: nextTitle, pinnedAt: task.pinnedAt });
        }
        if (statusChanged) {
          await recordTaskStateUndo(
            tx,
            user.id,
            task,
            input.status === TaskStatus.DONE
              ? "complete-task"
              : input.status === TaskStatus.CANCELED
                ? "cancel-task"
                : "restore-task"
          );
        }
          return tx.task.update({ where: revisionWhere, data });
        })
      : await database.task.update({ where: revisionWhere, data });
  } catch (error) {
    throwIfRevisionConflict(error, input.expectedUpdatedAt);
    throw error;
  }
  return taskView({ ...updated, assignees: task.assignees ?? [] });
}

export async function archiveDashboardTask(telegramId: string, id: string, database: PrismaClient = prisma): Promise<void> {
  const user = await userContext(telegramId, database);
  const task = await scopedTask(database, user.id, id);
  await database.$transaction(async (tx) => {
    await recordArchiveUndo(tx, user.id, {
      kind: "task",
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      archivedAt: task.archivedAt,
      archivedReason: task.archivedReason
    });
    await tx.task.update({ where: { id: task.id }, data: { archivedAt: new Date(), archivedReason: "removed" } });
  });
}

export async function createDashboardNote(telegramId: string, input: NoteCreateInput, database: PrismaClient = prisma): Promise<DashboardNote> {
  const user = await userContext(telegramId, database);
  const note = await createWithPublicIdRetry(database, user.id, "NOTE", async (tx, publicId) => {
    const created = await tx.note.create({
      data: {
        userId: user.id,
        publicId,
        title: input.title,
        body: input.body,
        summary: compactSummary(input.body),
        sourceText: input.body,
        tags: input.tags ?? []
      }
    });
    await recordCreateUndo(tx, user.id, { kind: "note", id: created.id, publicId: created.publicId, title: created.title });
    return created;
  });
  return noteView(note);
}

export async function listDashboardNotes(
  telegramId: string,
  options: { page: number; limit: number; q?: string },
  database: PrismaClient = prisma
): Promise<DashboardPage<DashboardNote>> {
  const user = await userContext(telegramId, database);
  const where: Prisma.NoteWhereInput = {
    userId: user.id,
    archivedAt: null,
    mergedIntoNoteId: null,
    ...(options.q ? { OR: [{ title: { contains: options.q, mode: "insensitive" } }, { body: { contains: options.q, mode: "insensitive" } }, { summary: { contains: options.q, mode: "insensitive" } }] } : {})
  };
  const [total, items] = await Promise.all([
    database.note.count({ where }),
    database.note.findMany({ where, orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }], skip: (options.page - 1) * options.limit, take: options.limit })
  ]);
  return pageResult(items.map(noteView), options.page, options.limit, total);
}

async function scopedNote(database: PrismaClient, userId: string, id: string) {
  const note = await database.note.findFirst({ where: { userId, archivedAt: null, mergedIntoNoteId: null, OR: itemReference(id) } });
  if (!note) throw new DashboardItemNotFoundError();
  return note;
}

export async function updateDashboardNote(telegramId: string, id: string, input: NoteUpdateInput, database: PrismaClient = prisma): Promise<DashboardNote> {
  const user = await userContext(telegramId, database);
  const note = await scopedNote(database, user.id, id);
  assertExpectedRevision(input.expectedUpdatedAt, note.updatedAt);
  const data: Prisma.NoteUncheckedUpdateInput = {};
  const nextBody = input.body ?? note.body;
  const titleChanged = input.title !== undefined && input.title !== note.title;
  const bodyChanged = input.body !== undefined && nextBody !== note.body;
  const pinnedChanged = input.pinned !== undefined && input.pinned !== Boolean(note.pinnedAt);
  if (titleChanged) data.title = input.title;
  if (bodyChanged) {
    data.body = nextBody;
    data.summary = compactSummary(nextBody);
    data.sourceText = nextBody;
    data.embedding = Prisma.JsonNull;
  }
  if (input.tags !== undefined) data.tags = input.tags;
  if (pinnedChanged) data.pinnedAt = input.pinned ? new Date() : null;
  if (Object.keys(data).length === 0) return noteView(note);
  const revisionWhere: Prisma.NoteWhereUniqueInput = {
    id: note.id,
    ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {})
  };
  let updated;
  try {
    updated = titleChanged || bodyChanged || pinnedChanged
      ? await database.$transaction(async (tx) => {
        if (titleChanged) {
          await recordRenameUndo(tx, user.id, { kind: "note", id: note.id, publicId: note.publicId, title: input.title ?? note.title }, note.title);
        }
        if (bodyChanged) {
          await recordFieldEditUndo(
            tx,
            user.id,
            { kind: "note", id: note.id, publicId: note.publicId, title: input.title ?? note.title },
            "body",
            note.body
          );
        }
        if (pinnedChanged) {
          await recordPinUndo(tx, user.id, {
            kind: "note", id: note.id, publicId: note.publicId, title: input.title ?? note.title, pinnedAt: note.pinnedAt
          });
        }
          return tx.note.update({ where: revisionWhere, data });
        })
      : await database.note.update({ where: revisionWhere, data });
  } catch (error) {
    throwIfRevisionConflict(error, input.expectedUpdatedAt);
    throw error;
  }
  return noteView(updated);
}

export async function archiveDashboardNote(telegramId: string, id: string, database: PrismaClient = prisma): Promise<void> {
  const user = await userContext(telegramId, database);
  const note = await scopedNote(database, user.id, id);
  await database.$transaction(async (tx) => {
    await recordArchiveUndo(tx, user.id, {
      kind: "note",
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      archivedAt: note.archivedAt,
      archivedReason: note.archivedReason
    });
    await tx.note.update({ where: { id: note.id }, data: { archivedAt: new Date(), archivedReason: "removed" } });
  });
}

export async function createDashboardIdea(telegramId: string, input: IdeaCreateInput, database: PrismaClient = prisma): Promise<DashboardIdea> {
  const user = await userContext(telegramId, database);
  const idea = await createWithPublicIdRetry(database, user.id, "IDEA", async (tx, publicId) => {
    const created = await tx.idea.create({
      data: {
        userId: user.id,
        publicId,
        title: input.title,
        concept: input.concept,
        sourceText: input.concept,
        tags: input.tags ?? [],
        status: input.status ?? IdeaStatus.RAW,
        dos: [],
        donts: []
      }
    });
    await recordCreateUndo(tx, user.id, { kind: "idea", id: created.id, publicId: created.publicId, title: created.title });
    return created;
  });
  return ideaView(idea);
}

export async function listDashboardIdeas(
  telegramId: string,
  options: { page: number; limit: number; q?: string; status?: IdeaStatus },
  database: PrismaClient = prisma
): Promise<DashboardPage<DashboardIdea>> {
  const user = await userContext(telegramId, database);
  const where: Prisma.IdeaWhereInput = {
    userId: user.id,
    archivedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.q ? { OR: [{ title: { contains: options.q, mode: "insensitive" } }, { concept: { contains: options.q, mode: "insensitive" } }] } : {})
  };
  const [total, items] = await Promise.all([
    database.idea.count({ where }),
    database.idea.findMany({ where, orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }], skip: (options.page - 1) * options.limit, take: options.limit })
  ]);
  return pageResult(items.map(ideaView), options.page, options.limit, total);
}

async function scopedIdea(database: PrismaClient, userId: string, id: string) {
  const idea = await database.idea.findFirst({ where: { userId, archivedAt: null, OR: itemReference(id) } });
  if (!idea) throw new DashboardItemNotFoundError();
  return idea;
}

export async function updateDashboardIdea(telegramId: string, id: string, input: IdeaUpdateInput, database: PrismaClient = prisma): Promise<DashboardIdea> {
  const user = await userContext(telegramId, database);
  const idea = await scopedIdea(database, user.id, id);
  assertExpectedRevision(input.expectedUpdatedAt, idea.updatedAt);
  const data: Prisma.IdeaUncheckedUpdateInput = {};
  const titleChanged = input.title !== undefined && input.title !== idea.title;
  const conceptChanged = input.concept !== undefined && input.concept !== idea.concept;
  const pinnedChanged = input.pinned !== undefined && input.pinned !== Boolean(idea.pinnedAt);
  if (titleChanged) data.title = input.title;
  if (conceptChanged) {
    data.concept = input.concept;
    data.sourceText = input.concept;
    data.embedding = Prisma.JsonNull;
  }
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.status !== undefined) data.status = input.status;
  if (pinnedChanged) data.pinnedAt = input.pinned ? new Date() : null;
  if (Object.keys(data).length === 0) return ideaView(idea);
  const revisionWhere: Prisma.IdeaWhereUniqueInput = {
    id: idea.id,
    ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {})
  };
  let updated;
  try {
    updated = titleChanged || conceptChanged || pinnedChanged
      ? await database.$transaction(async (tx) => {
        if (titleChanged) {
          await recordRenameUndo(tx, user.id, { kind: "idea", id: idea.id, publicId: idea.publicId, title: input.title ?? idea.title }, idea.title);
        }
        if (conceptChanged) {
          await recordFieldEditUndo(
            tx,
            user.id,
            { kind: "idea", id: idea.id, publicId: idea.publicId, title: input.title ?? idea.title },
            "concept",
            idea.concept
          );
        }
        if (pinnedChanged) {
          await recordPinUndo(tx, user.id, {
            kind: "idea", id: idea.id, publicId: idea.publicId, title: input.title ?? idea.title, pinnedAt: idea.pinnedAt
          });
        }
          return tx.idea.update({ where: revisionWhere, data });
        })
      : await database.idea.update({ where: revisionWhere, data });
  } catch (error) {
    throwIfRevisionConflict(error, input.expectedUpdatedAt);
    throw error;
  }
  return ideaView(updated);
}

export async function analyzeDashboardIdea(
  telegramId: string,
  id: string,
  ai: AiProvider,
  database: PrismaClient = prisma
): Promise<{ idea: DashboardIdea; brief: IdeaScore }> {
  const user = await userContext(telegramId, database);
  const idea = await scopedIdea(database, user.id, id);
  const brief = await ai.scoreIdea({
    title: idea.title,
    concept: idea.concept,
    problem: idea.problem ?? undefined,
    targetUser: idea.targetUser ?? undefined,
    type: idea.type ?? undefined,
    tags: idea.tags,
    sourceText: idea.sourceText
  });
  const updated = await database.idea.update({
    where: { id: idea.id },
    data: { scores: brief, marketNotes: brief.marketNotes, dos: brief.dos, donts: brief.donts }
  });
  return { idea: ideaView(updated), brief };
}

export async function archiveDashboardIdea(telegramId: string, id: string, database: PrismaClient = prisma): Promise<void> {
  const user = await userContext(telegramId, database);
  const idea = await scopedIdea(database, user.id, id);
  await database.$transaction(async (tx) => {
    await recordArchiveUndo(tx, user.id, {
      kind: "idea",
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      archivedAt: idea.archivedAt,
      archivedReason: idea.archivedReason
    });
    await tx.idea.update({ where: { id: idea.id }, data: { archivedAt: new Date(), archivedReason: "removed" } });
  });
}

export async function convertDashboardIdeaToTask(
  telegramId: string,
  id: string,
  input: IdeaConvertInput,
  database: PrismaClient = prisma
): Promise<DashboardTask> {
  const user = await userContext(telegramId, database);
  const idea = await scopedIdea(database, user.id, id);
  return createDashboardTask(telegramId, {
    title: idea.title,
    description: idea.concept,
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.reminderIntervalMinutes !== undefined ? { reminderIntervalMinutes: input.reminderIntervalMinutes } : {})
  }, database);
}

export async function createDashboardExpense(
  telegramId: string,
  input: ExpenseCreateInput,
  database: PrismaClient = prisma
): Promise<DashboardExpense> {
  const user = await userContext(telegramId, database);
  const expense = await createWithPublicIdRetry(database, user.id, "EXP", (tx, publicId) => tx.expense.create({
    data: {
      userId: user.id,
      publicId,
      merchant: input.merchant ?? null,
      description: input.description ?? null,
      total: new Prisma.Decimal(input.total.toFixed(2)),
      currency: input.currency,
      category: input.category ?? null,
      transactionAt: new Date(input.transactionAt),
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes ?? null,
      sourceType: "dashboard",
      rawText: input.description ?? input.merchant ?? "Dashboard expense"
    }
  }));
  return expenseView(expense);
}

export async function listDashboardExpenses(
  telegramId: string,
  options: { page: number; limit: number; q?: string },
  database: PrismaClient = prisma
): Promise<DashboardPage<DashboardExpense>> {
  const user = await userContext(telegramId, database);
  const where: Prisma.ExpenseWhereInput = {
    userId: user.id,
    ...(options.q ? { OR: [{ merchant: { contains: options.q, mode: "insensitive" } }, { description: { contains: options.q, mode: "insensitive" } }, { category: { contains: options.q, mode: "insensitive" } }, { notes: { contains: options.q, mode: "insensitive" } }] } : {})
  };
  const [total, items] = await Promise.all([
    database.expense.count({ where }),
    database.expense.findMany({ where, orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }], skip: (options.page - 1) * options.limit, take: options.limit })
  ]);
  return pageResult(items.map(expenseView), options.page, options.limit, total);
}

async function scopedExpense(database: PrismaClient, userId: string, id: string) {
  const expense = await database.expense.findFirst({ where: { userId, OR: itemReference(id) } });
  if (!expense) throw new DashboardItemNotFoundError();
  return expense;
}

export async function updateDashboardExpense(
  telegramId: string,
  id: string,
  input: ExpenseUpdateInput,
  database: PrismaClient = prisma
): Promise<DashboardExpense> {
  const user = await userContext(telegramId, database);
  const expense = await scopedExpense(database, user.id, id);
  const data: Prisma.ExpenseUncheckedUpdateInput = {};
  if ("merchant" in input) data.merchant = input.merchant ?? null;
  if ("description" in input) data.description = input.description ?? null;
  if (input.total !== undefined) data.total = new Prisma.Decimal(input.total.toFixed(2));
  if (input.currency !== undefined) data.currency = input.currency;
  if ("category" in input) data.category = input.category ?? null;
  if (input.transactionAt !== undefined) data.transactionAt = new Date(input.transactionAt);
  if ("paymentMethod" in input) data.paymentMethod = input.paymentMethod ?? null;
  if ("notes" in input) data.notes = input.notes ?? null;
  return expenseView(await database.expense.update({ where: { id: expense.id }, data }));
}

export async function deleteDashboardExpense(telegramId: string, id: string, database: PrismaClient = prisma): Promise<void> {
  const user = await userContext(telegramId, database);
  const expense = await scopedExpense(database, user.id, id);
  await database.expense.delete({ where: { id: expense.id } });
}

async function scopedImage(database: PrismaClient, userId: string, id: string) {
  const image = await database.storedImage.findFirst({ where: { userId, OR: itemReference(id) } });
  if (!image) throw new DashboardItemNotFoundError();
  return image;
}

const imageSelect = {
  id: true, publicId: true, mediaKind: true, mimeType: true, fileName: true, caption: true, ocrText: true,
  ocrConfidence: true, pinnedAt: true, createdAt: true, updatedAt: true
} satisfies Prisma.StoredImageSelect;

export async function listDashboardImages(
  telegramId: string,
  options: { page: number; limit: number; q?: string },
  database: PrismaClient = prisma
): Promise<DashboardPage<DashboardImage>> {
  const user = await userContext(telegramId, database);
  const where: Prisma.StoredImageWhereInput = {
    userId: user.id,
    ...(options.q ? { OR: [{ caption: { contains: options.q, mode: "insensitive" } }, { fileName: { contains: options.q, mode: "insensitive" } }, { ocrText: { contains: options.q, mode: "insensitive" } }] } : {})
  };
  const [total, images] = await Promise.all([
    database.storedImage.count({ where }),
    database.storedImage.findMany({ where, select: imageSelect, orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }], skip: (options.page - 1) * options.limit, take: options.limit })
  ]);
  return pageResult(images.map(imageView), options.page, options.limit, total);
}

export async function updateDashboardImage(
  telegramId: string,
  id: string,
  input: ImageUpdateInput,
  database: PrismaClient = prisma
): Promise<DashboardImage> {
  const user = await userContext(telegramId, database);
  const image = await scopedImage(database, user.id, id);
  assertExpectedRevision(input.expectedUpdatedAt, image.updatedAt);
  const caption = Object.prototype.hasOwnProperty.call(input, "caption") ? input.caption?.trim() || null : image.caption;
  const captionChanged = caption !== image.caption;
  const pinnedChanged = input.pinned !== undefined && input.pinned !== Boolean(image.pinnedAt);
  if (!captionChanged && !pinnedChanged) return imageView(image);
  const where: Prisma.StoredImageWhereUniqueInput = {
    id: image.id,
    ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {})
  };
  let updated;
  try {
    updated = captionChanged
      ? await database.$transaction(async (tx) => {
        await recordImageCaptionUndo(tx, user.id, image, image.caption);
        return tx.storedImage.update({
          where,
          data: { caption, ...(pinnedChanged ? { pinnedAt: input.pinned ? new Date() : null } : {}) },
          select: imageSelect
        });
      })
      : await database.storedImage.update({
        where,
        data: { pinnedAt: input.pinned ? new Date() : null },
        select: imageSelect
      });
  } catch (error) {
    throwIfRevisionConflict(error, input.expectedUpdatedAt);
    throw error;
  }
  return imageView(updated);
}

export async function deleteDashboardImage(telegramId: string, id: string, database: PrismaClient = prisma): Promise<void> {
  const user = await userContext(telegramId, database);
  const image = await scopedImage(database, user.id, id);
  await database.storedImage.delete({ where: { id: image.id } });
}

export type DashboardImageContent = { bytes: Uint8Array; contentType: string };

export async function loadDashboardImageContent(
  telegramId: string,
  id: string,
  botToken: string | undefined,
  database: PrismaClient = prisma,
  fetcher: typeof fetch = fetch
): Promise<DashboardImageContent> {
  if (!botToken) throw new DashboardUpstreamError();
  const user = await userContext(telegramId, database);
  const image = await scopedImage(database, user.id, id);
  let metadataResponse: Response;
  try {
    metadataResponse = await fetcher(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(image.telegramFileId)}`,
      { signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS) }
    );
  } catch {
    throw new DashboardUpstreamError();
  }
  if (!metadataResponse.ok) throw new DashboardUpstreamError();
  const payload = await metadataResponse.json() as { ok?: boolean; result?: { file_path?: string } };
  const filePath = payload.ok ? payload.result?.file_path : undefined;
  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) throw new DashboardUpstreamError();
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  let fileResponse: Response;
  try {
    fileResponse = await fetcher(`https://api.telegram.org/file/bot${botToken}/${encodedPath}`, {
      signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS)
    });
  } catch {
    throw new DashboardUpstreamError();
  }
  if (!fileResponse.ok) throw new DashboardUpstreamError();
  const contentLength = Number(fileResponse.headers.get("content-length") ?? "0");
  if (contentLength > MAX_TELEGRAM_FILE_BYTES) throw new DashboardUpstreamError();
  const bytes = new Uint8Array(await fileResponse.arrayBuffer());
  if (bytes.byteLength > MAX_TELEGRAM_FILE_BYTES) throw new DashboardUpstreamError();
  const storedType = image.mimeType?.toLowerCase().split(";")[0]?.trim();
  const upstreamType = fileResponse.headers.get("content-type")?.toLowerCase().split(";")[0]?.trim();
  const contentType = storedType && SAFE_IMAGE_TYPES.has(storedType)
    ? storedType
    : upstreamType && SAFE_IMAGE_TYPES.has(upstreamType)
      ? upstreamType
      : undefined;
  if (!contentType) throw new DashboardUnsupportedMediaError();
  return {
    bytes,
    contentType
  };
}

export async function getDashboardSettings(telegramId: string, database: PrismaClient = prisma): Promise<DashboardSettings> {
  return settingsView((await userContext(telegramId, database)).settings);
}

export async function updateDashboardSettings(
  telegramId: string,
  input: SettingsUpdateInput,
  database: PrismaClient = prisma
): Promise<DashboardSettings> {
  const user = await userContext(telegramId, database);
  if (input.timezone && !DateTime.now().setZone(input.timezone).isValid) {
    throw new DashboardValidationError("Choose a valid IANA timezone, such as Asia/Singapore.");
  }
  if ("quietHoursStart" in input || "quietHoursEnd" in input) {
    if (!("quietHoursStart" in input) || !("quietHoursEnd" in input) || (input.quietHoursStart === null) !== (input.quietHoursEnd === null)) {
      throw new DashboardValidationError("Update both quiet-hour fields together, or turn both off together.");
    }
  }
  const updated = await database.$transaction(async (tx) => {
    const settings = await tx.userSettings.update({ where: { userId: user.id }, data: input });
    if (input.timezone !== undefined || input.reminderIntervalMinutes !== undefined || input.dueNudgeMinutes !== undefined) {
      const tasks = await tx.task.findMany({ where: { userId: user.id, status: TaskStatus.OPEN, archivedAt: null } });
      const now = new Date();
      for (const task of tasks) {
        const interval = input.reminderIntervalMinutes !== undefined
          ? settings.reminderIntervalMinutes
          : task.reminderIntervalMinutes ?? settings.reminderIntervalMinutes;
        await tx.task.update({
          where: { id: task.id },
          data: {
            timezone: settings.timezone,
            ...(input.reminderIntervalMinutes !== undefined ? { reminderIntervalMinutes: interval } : {}),
            nextReminderAt: nextReminder(task.dueAt, interval, settings.dueNudgeMinutes, now)
          }
        });
      }
    }
    return settings;
  });
  return settingsView(updated);
}

export class DashboardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardValidationError";
  }
}

export type DashboardSearchKind = "task" | "note" | "idea" | "image" | "expense";
export type DashboardSearchResult = {
  kind: DashboardSearchKind;
  id: string;
  publicId: string;
  title: string;
  summary: string;
  timestamp: string;
  contentUrl?: string;
};

export async function searchDashboard(
  telegramId: string,
  query: string,
  kinds: DashboardSearchKind[],
  limit: number,
  database: PrismaClient = prisma
): Promise<DashboardSearchResult[]> {
  const user = await userContext(telegramId, database);
  const wanted = (kind: DashboardSearchKind) => kinds.length === 0 || kinds.includes(kind);
  const [tasks, notes, ideas, images, expenses] = await Promise.all([
    wanted("task") ? database.task.findMany({
      where: { userId: user.id, archivedAt: null, OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] },
      orderBy: { updatedAt: "desc" }, take: limit
    }) : [],
    wanted("note") ? database.note.findMany({
      where: { userId: user.id, archivedAt: null, mergedIntoNoteId: null, OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }, { summary: { contains: query, mode: "insensitive" } }] },
      orderBy: { updatedAt: "desc" }, take: limit
    }) : [],
    wanted("idea") ? database.idea.findMany({
      where: { userId: user.id, archivedAt: null, OR: [{ title: { contains: query, mode: "insensitive" } }, { concept: { contains: query, mode: "insensitive" } }] },
      orderBy: { updatedAt: "desc" }, take: limit
    }) : [],
    wanted("image") ? database.storedImage.findMany({
      where: { userId: user.id, OR: [{ caption: { contains: query, mode: "insensitive" } }, { fileName: { contains: query, mode: "insensitive" } }, { ocrText: { contains: query, mode: "insensitive" } }] },
      orderBy: { updatedAt: "desc" }, take: limit
    }) : [],
    wanted("expense") ? database.expense.findMany({
      where: { userId: user.id, OR: [{ merchant: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }, { category: { contains: query, mode: "insensitive" } }, { notes: { contains: query, mode: "insensitive" } }] },
      orderBy: { updatedAt: "desc" }, take: limit
    }) : []
  ]);
  return [
    ...tasks.map((item) => ({ kind: "task" as const, id: item.id, publicId: item.publicId, title: item.title, summary: item.description ?? item.title, timestamp: item.updatedAt.toISOString() })),
    ...notes.map((item) => ({ kind: "note" as const, id: item.id, publicId: item.publicId, title: item.title, summary: item.summary, timestamp: item.updatedAt.toISOString() })),
    ...ideas.map((item) => ({ kind: "idea" as const, id: item.id, publicId: item.publicId, title: item.title, summary: item.concept, timestamp: item.updatedAt.toISOString() })),
    ...images.map((item) => ({ kind: "image" as const, id: item.id, publicId: item.publicId, title: item.caption ?? item.fileName ?? "Saved image", summary: item.ocrText ?? item.caption ?? "", timestamp: item.updatedAt.toISOString(), contentUrl: `/api/v1/dashboard/images/${encodeURIComponent(item.id)}/content` })),
    ...expenses.map((item) => ({ kind: "expense" as const, id: item.id, publicId: item.publicId, title: item.merchant ?? item.description ?? "Expense", summary: `${item.currency} ${item.total.toString()}${item.category ? ` · ${item.category}` : ""}`, timestamp: item.updatedAt.toISOString() }))
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

export async function disconnectDashboardIntegration(
  telegramId: string,
  provider: "gmail" | "calendar" | "excel",
  database: PrismaClient = prisma
): Promise<{ provider: string; disconnected: boolean }> {
  const user = await userContext(telegramId, database);
  if (provider === "gmail") {
    return database.$transaction(async (tx) => {
      await tx.pendingGmailOAuth.deleteMany({ where: { userId: user.id } });
      const result = await tx.gmailConnection.deleteMany({ where: { userId: user.id } });
      return { provider, disconnected: result.count > 0 };
    });
  }
  if (provider === "calendar") {
    return database.$transaction(async (tx) => {
      await tx.pendingCalendarOAuth.deleteMany({ where: { userId: user.id } });
      const result = await tx.calendarConnection.deleteMany({ where: { userId: user.id } });
      return { provider, disconnected: result.count > 0 };
    });
  }
  return database.$transaction(async (tx) => {
    await tx.pendingMicrosoftOAuth.deleteMany({ where: { userId: user.id } });
    const result = await tx.microsoftConnection.deleteMany({ where: { userId: user.id } });
    return { provider, disconnected: result.count > 0 };
  });
}

export async function syncDashboardExcelExpenses(
  telegramId: string,
  database: PrismaClient = prisma,
  syncExpenses: (userId: string, timezone: string) => Promise<number> = syncUnsyncedExpensesForDashboard
): Promise<{ provider: "excel"; synced: number }> {
  const user = await userContext(telegramId, database);
  const synced = await syncExpenses(user.id, user.settings.timezone);
  return { provider: "excel", synced };
}

export async function exportDashboardData(telegramId: string, database: PrismaClient = prisma) {
  const user = await userContext(telegramId, database);
  const [profile, tasks, notes, ideas, expenses, images, reflections, gmail, calendar, excel] = await Promise.all([
    database.user.findUniqueOrThrow({ where: { id: user.id }, select: { telegramId: true, username: true, firstName: true, lastName: true, createdAt: true, updatedAt: true } }),
    database.task.findMany({ where: { userId: user.id }, select: { publicId: true, title: true, description: true, status: true, dueAt: true, timezone: true, recurrenceRule: true, pinnedAt: true, archivedAt: true, createdAt: true, updatedAt: true } }),
    database.note.findMany({ where: { userId: user.id }, select: { publicId: true, title: true, body: true, summary: true, tags: true, pinnedAt: true, archivedAt: true, createdAt: true, updatedAt: true } }),
    database.idea.findMany({ where: { userId: user.id }, select: { publicId: true, title: true, concept: true, problem: true, targetUser: true, type: true, status: true, tags: true, marketNotes: true, dos: true, donts: true, pinnedAt: true, archivedAt: true, createdAt: true, updatedAt: true } }),
    database.expense.findMany({ where: { userId: user.id }, select: { publicId: true, merchant: true, transactionAt: true, category: true, description: true, subtotal: true, tax: true, discount: true, total: true, currency: true, paymentMethod: true, sourceType: true, notes: true, excelSyncedAt: true, createdAt: true, updatedAt: true } }),
    database.storedImage.findMany({ where: { userId: user.id }, select: { publicId: true, mediaKind: true, mimeType: true, fileName: true, caption: true, ocrText: true, ocrConfidence: true, createdAt: true, updatedAt: true } }),
    database.reflection.findMany({ where: { userId: user.id }, select: { publicId: true, situation: true, balancedView: true, immediateAction: true, keepInMind: true, risks: true, pinnedAt: true, archivedAt: true, createdAt: true, updatedAt: true } }),
    database.gmailConnection.findUnique({ where: { userId: user.id }, select: { gmailEmail: true, scanEnabled: true, scanHourLocal: true, lastScanAt: true, createdAt: true } }),
    database.calendarConnection.findUnique({ where: { userId: user.id }, select: { calendarEmail: true, createdAt: true } }),
    database.microsoftConnection.findUnique({ where: { userId: user.id }, select: { microsoftEmail: true, workbookName: true, tableName: true, createdAt: true } })
  ]);
  return {
    format: "threadwise-export-v1",
    exportedAt: new Date().toISOString(),
    profile,
    settings: settingsView(user.settings),
    tasks,
    notes,
    ideas,
    expenses: expenses.map((item) => ({ ...item, subtotal: item.subtotal ? Number(item.subtotal) : null, tax: item.tax ? Number(item.tax) : null, discount: item.discount ? Number(item.discount) : null, total: Number(item.total) })),
    images,
    reflections,
    integrations: {
      gmail: gmail ? { connected: true, ...gmail } : { connected: false },
      calendar: calendar ? { connected: true, ...calendar } : { connected: false },
      excel: excel ? { connected: true, ...excel } : { connected: false }
    }
  };
}

export async function deleteDashboardAccount(telegramId: string, database: PrismaClient = prisma): Promise<void> {
  const user = await userContext(telegramId, database);
  await database.$transaction(async (tx) => {
    // Audit metadata may contain item titles. Remove it before the User cascade
    // would otherwise anonymize and retain those rows.
    await tx.auditLog.deleteMany({ where: { userId: user.id } });
    const deleted = await tx.user.deleteMany({ where: { id: user.id, telegramId } });
    if (deleted.count !== 1) throw new DashboardItemNotFoundError();
  });
}
