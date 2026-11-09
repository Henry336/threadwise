/**
 * Cross-device autosave drafts for the Personal rich-note editor (PersonalNoteDraft rows).
 * One draft per user per key: "new" for an unsaved note, or the note id when editing one.
 * Drafts expire after seven days. Called from the personal note-draft routes in route.ts.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { DashboardConflictError, DashboardItemNotFoundError } from "./data";
import { saveRevisionedDraft } from "./noteDrafts";
import type { PersonalNoteDraftQueryInput, PersonalNoteDraftSaveInput } from "./schemas";
import { DashboardUserNotFoundError } from "./snapshot";

const PERSONAL_TELEGRAM_ID = /^[1-9]\d{0,19}$/u;

/** Loads the caller's live draft for a new note or an existing note, after clearing their expired drafts. */
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

/**
 * Autosaves a draft with optimistic concurrency (see saveRevisionedDraft). When the draft
 * edits an existing note, the note must still be the caller's and unchanged since the draft
 * began; otherwise it returns a conflict so an old draft cannot overwrite newer saved text.
 */
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
  return saveRevisionedDraft({
    expectedRevision: input.expectedRevision,
    find: () => database.personalNoteDraft.findUnique({ where: { userId_draftKey: { userId, draftKey } } }),
    purgeExpired: () => purgeExpiredPersonalNoteDrafts(userId, database),
    create: (expiresAt) => database.personalNoteDraft.create({
      data: {
        userId,
        draftKey,
        noteId,
        noteUpdatedAt: noteId ? new Date(input.noteUpdatedAt!) : null,
        title: input.title,
        body: input.body,
        expiresAt,
      },
    }),
    bump: (existing, expiresAt) => database.personalNoteDraft.updateMany({
      where: { id: existing.id, userId, revision: input.expectedRevision },
      data: { title: input.title, body: input.body, expiresAt, revision: { increment: 1 } },
    }),
    reload: (id) => database.personalNoteDraft.findUniqueOrThrow({ where: { id } }),
    conflict: draftConflict,
  });
}

/** Discards one of the caller's drafts (after filing or cancelling). Not found if it is not theirs. */
export async function deleteDashboardPersonalNoteDraft(
  telegramId: string,
  draftId: string,
  database: PrismaClient = prisma,
): Promise<void> {
  const userId = await personalUserId(telegramId, database);
  const removed = await database.personalNoteDraft.deleteMany({ where: { id: draftId, userId } });
  if (removed.count !== 1) throw new DashboardItemNotFoundError();
}

/**
 * Maps a Telegram id to the internal user id. Only a real human id is accepted (not a
 * synthetic "chat:" group owner), so these drafts stay Personal-only.
 */
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
