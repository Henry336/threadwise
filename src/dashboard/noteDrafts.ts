import { Prisma } from "@prisma/client";

/** How long an unfinished Personal or Study note draft lives after its last autosave. */
export const NOTE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type RevisionedDraft = { id: string; expiresAt: Date };

/**
 * The one optimistic-save flow behind Personal and Study note drafts. The first save must
 * claim revision 0; later saves only land when the caller's revision is still current, so
 * two devices cannot overwrite each other. An expired draft counts as absent, which is what
 * the old purge-before-every-autosave guaranteed, but the purge now runs only when an expired
 * row is actually in the way instead of on every keystroke batch.
 */
export async function saveRevisionedDraft<T extends RevisionedDraft>(store: {
  expectedRevision: number;
  find: () => Promise<T | null>;
  purgeExpired: () => Promise<unknown>;
  create: (expiresAt: Date) => Promise<T>;
  bump: (existing: T, expiresAt: Date) => Promise<{ count: number }>;
  reload: (id: string) => Promise<T>;
  conflict: () => Error;
}): Promise<T> {
  const now = Date.now();
  const expiresAt = new Date(now + NOTE_DRAFT_TTL_MS);
  let existing = await store.find();
  if (existing && existing.expiresAt.getTime() <= now) {
    await store.purgeExpired();
    existing = null;
  }
  if (!existing) {
    if (store.expectedRevision !== 0) throw store.conflict();
    try {
      return await store.create(expiresAt);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw store.conflict();
      throw error;
    }
  }
  const updated = await store.bump(existing, expiresAt);
  if (updated.count !== 1) throw store.conflict();
  return store.reload(existing.id);
}
