import { TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { bold, code, h, italic } from "../utils/html";
import { truncate } from "../utils/text";

export type ArchiveKind = "notes" | "ideas" | "tasks" | "reflections";

export type ArchivedItem = {
  id: string;
  publicId: string;
  title: string;
  summary: string;
  archivedAt: Date;
  archivedReason?: string | null;
  mergedIntoPublicId?: string | null;
};

export type ArchivedPage = {
  kind: ArchiveKind;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: ArchivedItem[];
};

const DEFAULT_PAGE_SIZE = 10;

export function parseArchiveKind(value: string): ArchiveKind | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "note" || normalized === "notes") return "notes";
  if (normalized === "idea" || normalized === "ideas") return "ideas";
  if (normalized === "task" || normalized === "tasks") return "tasks";
  if (normalized === "reflection" || normalized === "reflections" || normalized === "reflect") return "reflections";
  return undefined;
}

export async function listArchivedItems(userId: string, kind: ArchiveKind, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<ArchivedPage> {
  if (kind === "notes") {
    const totalItems = await prisma.note.count({ where: { userId, archivedAt: { not: null } } });
    const safePage = clampedPage(page, pageSize, totalItems);
    const notes = await prisma.note.findMany({
      where: { userId, archivedAt: { not: null } },
      include: { mergedIntoNote: true },
      orderBy: { archivedAt: "desc" },
      skip: (safePage - 1) * pageSize,
      take: pageSize
    });

    return pageResult(kind, safePage, pageSize, totalItems, notes.map((note) => ({
      id: note.id,
      publicId: note.publicId,
      title: note.title,
      summary: note.summary,
      archivedAt: note.archivedAt ?? note.updatedAt,
      archivedReason: note.archivedReason,
      mergedIntoPublicId: note.mergedIntoNote?.publicId ?? null
    })));
  }

  if (kind === "ideas") {
    const totalItems = await prisma.idea.count({ where: { userId, archivedAt: { not: null } } });
    const safePage = clampedPage(page, pageSize, totalItems);
    const ideas = await prisma.idea.findMany({
      where: { userId, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      skip: (safePage - 1) * pageSize,
      take: pageSize
    });

    return pageResult(kind, safePage, pageSize, totalItems, ideas.map((idea) => ({
      id: idea.id,
      publicId: idea.publicId,
      title: idea.title,
      summary: idea.concept,
      archivedAt: idea.archivedAt ?? idea.updatedAt,
      archivedReason: idea.archivedReason
    })));
  }

  if (kind === "tasks") {
    const totalItems = await prisma.task.count({ where: { userId, archivedAt: { not: null } } });
    const safePage = clampedPage(page, pageSize, totalItems);
    const tasks = await prisma.task.findMany({
      where: { userId, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      skip: (safePage - 1) * pageSize,
      take: pageSize
    });

    return pageResult(kind, safePage, pageSize, totalItems, tasks.map((task) => ({
      id: task.id,
      publicId: task.publicId,
      title: task.title,
      summary: task.description ?? task.sourceText,
      archivedAt: task.archivedAt ?? task.updatedAt,
      archivedReason: task.archivedReason
    })));
  }

  const totalItems = await prisma.reflection.count({ where: { userId, archivedAt: { not: null } } });
  const safePage = clampedPage(page, pageSize, totalItems);
  const reflections = await prisma.reflection.findMany({
    where: { userId, archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    skip: (safePage - 1) * pageSize,
    take: pageSize
  });

  return pageResult(kind, safePage, pageSize, totalItems, reflections.map((reflection) => ({
    id: reflection.id,
    publicId: reflection.publicId,
    title: reflection.situation,
    summary: reflection.immediateAction,
    archivedAt: reflection.archivedAt ?? reflection.updatedAt,
    archivedReason: reflection.archivedReason
  })));
}

export async function restoreArchivedItem(userId: string, reference: string) {
  const normalized = reference.trim().toUpperCase();
  if (normalized.startsWith("NOTE-")) {
    const note = await prisma.note.updateMany({
      where: { userId, publicId: normalized, archivedAt: { not: null } },
      data: { archivedAt: null, archivedReason: null, mergedIntoNoteId: null }
    });
    return note.count > 0 ? `Restored ${code(normalized)} to active notes.` : undefined;
  }

  if (normalized.startsWith("IDEA-")) {
    const idea = await prisma.idea.updateMany({
      where: { userId, publicId: normalized, archivedAt: { not: null } },
      data: { archivedAt: null, archivedReason: null }
    });
    return idea.count > 0 ? `Restored ${code(normalized)} to active ideas.` : undefined;
  }

  if (normalized.startsWith("TASK-")) {
    const task = await prisma.task.updateMany({
      where: { userId, publicId: normalized, archivedAt: { not: null } },
      data: { archivedAt: null, archivedReason: null, status: TaskStatus.OPEN }
    });
    return task.count > 0 ? `Restored ${code(normalized)} to open tasks.` : undefined;
  }

  if (normalized.startsWith("REF-")) {
    const reflection = await prisma.reflection.updateMany({
      where: { userId, publicId: normalized, archivedAt: { not: null } },
      data: { archivedAt: null, archivedReason: null }
    });
    return reflection.count > 0 ? `Restored ${code(normalized)} to active reflections.` : undefined;
  }

  return undefined;
}

export function formatArchivedPage(page: ArchivedPage): string {
  if (page.totalItems === 0) {
    return `No archived ${page.kind} yet.`;
  }

  return [
    bold(`Archived ${page.kind}`),
    `${italic(`Page ${page.page} of ${page.totalPages}`)} ${code(`${page.totalItems} total`)}`,
    "",
    ...page.items.map((item) => formatArchivedItem(item)),
    "",
    `${italic("Use")} ${code(`/restore ${page.items[0]?.publicId ?? "NOTE-1"}`)} ${italic("to bring one back.")}`
  ].join("\n\n");
}

function formatArchivedItem(item: ArchivedItem): string {
  const reason = item.archivedReason ? ` ${italic(item.archivedReason)}` : "";
  const mergedInto = item.mergedIntoPublicId ? `\n${bold("Merged into")} ${code(item.mergedIntoPublicId)}` : "";
  return [
    `${code(item.publicId)} ${bold(item.title)}${reason}`,
    h(truncate(item.summary, 180)),
    `${bold("Archived")} ${h(item.archivedAt.toLocaleString())}${mergedInto}`
  ].join("\n");
}

function pageResult(kind: ArchiveKind, page: number, pageSize: number, totalItems: number, items: ArchivedItem[]): ArchivedPage {
  return {
    kind,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    items
  };
}

function clampedPage(page: number, pageSize: number, totalItems: number): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}
