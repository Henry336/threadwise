import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { DashboardConflictError, DashboardItemNotFoundError } from "./data";
import type { PersonalNoteDraftQueryInput, PersonalNoteDraftSaveInput } from "./schemas";
import { DashboardUserNotFoundError } from "./snapshot";

const PERSONAL_TELEGRAM_ID = /^[1-9]\d{0,19}$/u;
const PERSONAL_NOTE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export async function getDashboardPersonalNoteDraft(
  telegramId: string,
  input: PersonalNoteDraftQueryInput,
  database: PrismaClient = prisma,
) {
  const userId = await personalUserId(telegramId, database);
  await purgeExpiredPersonalNoteDrafts(userId, database);
  return database.personalNoteDraft.findFirst({
    where: {
      userId,
      draftKey: input.noteId ?? "new",
      expiresAt: { gt: new Date() },
    },
  });
}

export async function saveDashboardPersonalNoteDraft(
  telegramId: string,
  input: PersonalNoteDraftSaveInput,
  database: PrismaClient = prisma,
) {
  const userId = await personalUserId(telegramId, database);
  const noteId = input.noteId ?? null;
  const draftKey = noteId ?? "new";
  if (noteId) {
    const note = await database.note.findFirst({
      where: { id: noteId, userId, archivedAt: null, mergedIntoNoteId: null },
      select: { id: true, updatedAt: true },
    });
    if (!note) throw new DashboardItemNotFoundError();
    if (note.updatedAt.toISOString() !== input.noteUpdatedAt) {
      throw new DashboardConflictError("The saved note changed before this draft started. Reload it before continuing.");
    }
  }
  await purgeExpiredPersonalNoteDrafts(userId, database);
  const expiresAt = new Date(Date.now() + PERSONAL_NOTE_DRAFT_TTL_MS);
  const existing = await database.personalNoteDraft.findUnique({
    where: { userId_draftKey: { userId, draftKey } },
  });
  if (!existing) {
    if (input.expectedRevision !== 0) throw draftConflict();
    try {
      return await database.personalNoteDraft.create({
        data: {
          userId,
          draftKey,
          noteId,
          noteUpdatedAt: noteId ? new Date(input.noteUpdatedAt!) : null,
          title: input.title,
          body: input.body,
          expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw draftConflict();
      throw error;
    }
  }
  const updated = await database.personalNoteDraft.updateMany({
    where: { id: existing.id, userId, revision: input.expectedRevision },
    data: { title: input.title, body: input.body, expiresAt, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw draftConflict();
  return database.personalNoteDraft.findUniqueOrThrow({ where: { id: existing.id } });
}

export async function deleteDashboardPersonalNoteDraft(
  telegramId: string,
  draftId: string,
  database: PrismaClient = prisma,
): Promise<void> {
  const userId = await personalUserId(telegramId, database);
  const removed = await database.personalNoteDraft.deleteMany({ where: { id: draftId, userId } });
  if (removed.count !== 1) throw new DashboardItemNotFoundError();
}

async function personalUserId(telegramId: string, database: PrismaClient): Promise<string> {
  if (!PERSONAL_TELEGRAM_ID.test(telegramId)) throw new DashboardUserNotFoundError();
  const user = await database.user.findUnique({ where: { telegramId }, select: { id: true, settings: true } });
  if (!user?.settings) throw new DashboardUserNotFoundError();
  return user.id;
}

async function purgeExpiredPersonalNoteDrafts(userId: string, database: PrismaClient): Promise<void> {
  await database.personalNoteDraft.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
}

function draftConflict(): DashboardConflictError {
  return new DashboardConflictError("This draft changed somewhere else. Reload it before continuing.");
}
