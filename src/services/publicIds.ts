import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

type PublicKind = "IDEA" | "TASK" | "NOTE" | "EXP" | "IMG";

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

  let highest = 0;
  const pattern = new RegExp(`^${kind}-(\\d+)$`);
  for (const row of rows) {
    const suffix = Number(row.publicId.match(pattern)?.[1]);
    if (Number.isSafeInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${kind}-${highest + 1}`;
}
