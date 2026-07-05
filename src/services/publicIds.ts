import { prisma } from "../db/prisma";

type PublicKind = "IDEA" | "TASK" | "REF" | "NOTE";

export async function nextPublicId(userId: string, kind: PublicKind): Promise<string> {
  if (kind === "IDEA") {
    const count = await prisma.idea.count({ where: { userId } });
    return `IDEA-${count + 1}`;
  }

  if (kind === "TASK") {
    const count = await prisma.task.count({ where: { userId } });
    return `TASK-${count + 1}`;
  }

  if (kind === "NOTE") {
    const count = await prisma.note.count({ where: { userId } });
    return `NOTE-${count + 1}`;
  }

  const count = await prisma.reflection.count({ where: { userId } });
  return `REF-${count + 1}`;
}
