/**
 * Allocates the short user-facing ids such as TASK-3 or NOTE-7.
 * Ids are numbered per owner (userId) and never reused, so an old id in a
 * chat message or audit log cannot point at a different item later.
 * Called by the services that create tasks, notes, ideas, images and expenses.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

type PublicKind = "IDEA" | "TASK" | "NOTE" | "EXP" | "IMG";

/**
 * Returns the next free "KIND-n" id for this owner by scanning existing ids.
 * Pass a transaction client so the read happens inside the same transaction
 * as the insert (see createWithPublicId).
 */
export async function nextPublicId(
  userId: string,
  kind: PublicKind,
  database: PrismaClient | Prisma.TransactionClient = prisma
): Promise<string> {
  const where = { userId, publicId: { startsWith: `${kind}-` } };
  const rows = kind === "IDEA"
    ? await database.idea.findMany({ where, select: { publicId: true } })
    : kind === "TASK"
      ? await database.task.findMany({ where, select: { publicId: true } })
      : kind === "NOTE"
        ? await database.note.findMany({ where, select: { publicId: true } })
        : kind === "EXP"
          ? await database.expense.findMany({ where, select: { publicId: true } })
          : await database.storedImage.findMany({ where, select: { publicId: true } });

  return `${kind}-${highestPublicNumber(rows, kind) + 1}`;
}

/**
 * The one rule for "PREFIX-n" public ids (TASK-3, NOTE-7, STUDY-2, SNOTE-4...):
 * the highest n already used, so a deleted row's number is never handed out
 * again. Malformed and unrelated ids are ignored.
 */
export function highestPublicNumber(rows: Array<{ publicId: string }>, prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const row of rows) {
    const suffix = Number(row.publicId.match(pattern)?.[1]);
    if (Number.isSafeInteger(suffix) && suffix > highest) highest = suffix;
  }
  return highest;
}

const PUBLIC_ID_CREATE_ATTEMPTS = 3;

/**
 * Creates a row whose public id is allocated inside the same transaction as
 * the insert. Two concurrent creates can still read the same highest number
 * (Postgres READ COMMITTED), so the loser's insert hits the unique
 * (userId, publicId) index; that conflict re-runs the whole transaction with
 * a fresh id instead of failing the user's request.
 */
export async function createWithPublicId<T>(
  userId: string,
  kind: PublicKind,
  create: (tx: Prisma.TransactionClient, publicId: string) => Promise<T>,
  database: PrismaClient = prisma
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.$transaction(async (tx) => create(tx, await nextPublicId(userId, kind, tx)));
    } catch (error) {
      if (attempt >= PUBLIC_ID_CREATE_ATTEMPTS || !isPublicIdUniqueConflict(error)) throw error;
    }
  }
}

/** True when a Prisma error is the unique-index clash on publicId (code P2002). */
function isPublicIdUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.some((field) => field === "publicId");
  return typeof target === "string" && target.toLowerCase().includes("publicid");
}
