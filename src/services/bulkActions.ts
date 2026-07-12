import { TaskStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { truncate } from "../utils/text";
import { archiveIdea, listRecentIdeas } from "./ideas";
import { archiveNote, listRecentNotes } from "./notes";
import { archiveTask, completeTask, listOpenTasks } from "./tasks";

export type BulkAction = "complete" | "delete";
export type BulkItemKind = "task" | "note" | "idea";

export type BulkActionRequest = {
  action: BulkAction;
  itemKind: BulkItemKind;
  references: string[];
};

type BulkPreviewItem = {
  id: string;
  publicId: string;
  title: string;
};

const MAX_BULK_ITEMS = 25;
const BULK_ACTION_TTL_MS = 15 * 60_000;

export function parseBulkActionRequest(text: string): BulkActionRequest | undefined {
  const normalized = text.trim().replace(/[.!?]+$/g, "");
  const markDone = normalized.match(/^mark\s+(?:my\s+)?tasks?\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i);
  const complete = markDone ?? normalized.match(/^(?:complete|finish|mark\s+done)\s+(?:my\s+)?(?:tasks?\s+)?(.+)$/i);
  if (complete?.[1]) {
    const references = parseBulkReferences(complete[1]);
    if (references && references.length > 1) return { action: "complete", itemKind: "task", references };
  }

  const remove = normalized.match(/^(?:delete|remove|archive|cancel)\s+(?:my\s+)?(tasks?|notes?|ideas?)\s+(.+)$/i);
  if (remove?.[1] && remove[2]) {
    const references = parseBulkReferences(remove[2]);
    if (!references || references.length < 2) return undefined;
    return { action: "delete", itemKind: singularKind(remove[1]), references };
  }

  const genericRemove = normalized.match(/^(?:delete|remove|archive|cancel)\s+(.+)$/i);
  const references = genericRemove?.[1] ? parseBulkReferences(genericRemove[1]) : undefined;
  if (!references || references.length < 2) return undefined;
  const publicKinds = [...new Set(references.filter((reference) => !/^\d+$/.test(reference)).map((reference) => reference.split("-")[0]))];
  if (publicKinds.length > 1) return undefined;
  const itemKind = publicKinds[0] ? singularKind(publicKinds[0]) : "task";
  return { action: "delete", itemKind, references };
}

export function parseBulkReferences(text: string): string[] | undefined {
  const found: string[] = [];
  const remainder = text.replace(/\b(?:TASK|NOTE|IDEA)-\d+\b|\b\d+\s*(?:-|to)\s*\d+\b|\b\d+\b/gi, (token) => {
    const range = token.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i);
    if (!range) {
      found.push(token.toUpperCase());
      return " ";
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start < 1 || end < start || end - start + 1 > MAX_BULK_ITEMS) return token;
    for (let value = start; value <= end; value += 1) found.push(String(value));
    return " ";
  });
  const unsupported = remainder.replace(/\band\b/gi, "").replace(/[\s,&+]+/g, "");
  if (unsupported || found.length < 1 || found.length > MAX_BULK_ITEMS) return undefined;
  return [...new Set(found)];
}

export async function createBulkActionPreview(
  userId: string,
  requestedByTelegramId: string,
  request: BulkActionRequest
) {
  if (request.action === "complete" && request.itemKind !== "task") {
    throw new Error("Only tasks can be completed. Notes and ideas can be deleted from active lists instead.");
  }
  const items = await resolveBulkItems(userId, request);
  if (items.length < 2) throw new Error("Choose at least two items for a bulk action.");
  await prisma.pendingBulkAction.deleteMany({ where: { userId, requestedByTelegramId } });
  const pending = await prisma.pendingBulkAction.create({
    data: {
      userId,
      action: request.action,
      itemKind: request.itemKind,
      itemIds: items.map((item) => item.id),
      requestedByTelegramId,
      expiresAt: new Date(Date.now() + BULK_ACTION_TTL_MS)
    }
  });
  return { pending, items, request };
}

export async function confirmBulkAction(userId: string, pendingId: string, telegramId: string) {
  const pending = await claimPendingBulkAction(userId, pendingId, telegramId);
  const request = { action: pending.action as BulkAction, itemKind: pending.itemKind as BulkItemKind };
  let changed = 0;
  let skipped = 0;
  const changedItems: BulkPreviewItem[] = [];

  for (const itemId of pending.itemIds) {
    try {
      if (request.action === "complete") {
        const completion = await completeTask(userId, itemId);
        if (completion.alreadyCompleted) skipped += 1;
        else {
          changed += 1;
          changedItems.push(completion.task);
        }
      } else if (request.itemKind === "task") {
        const item = await archiveTask(userId, itemId);
        changed += 1;
        changedItems.push(item);
      } else if (request.itemKind === "note") {
        const item = await archiveNote(userId, itemId);
        changed += 1;
        changedItems.push(item);
      } else {
        const item = await archiveIdea(userId, itemId);
        changed += 1;
        changedItems.push(item);
      }
    } catch {
      skipped += 1;
    }
  }

  return { ...request, changed, skipped, items: changedItems };
}

export async function cancelBulkAction(userId: string, pendingId: string, telegramId: string) {
  await claimPendingBulkAction(userId, pendingId, telegramId);
}

export function formatBulkActionPreview(preview: Awaited<ReturnType<typeof createBulkActionPreview>>): string {
  const verb = preview.request.action === "complete"
    ? "Complete"
    : "Archive";
  const noun = `${preview.request.itemKind}${preview.items.length === 1 ? "" : "s"}`;
  return [
    bold("Confirm bulk action"),
    `${verb} ${preview.items.length} ${noun}?`,
    "",
    ...preview.items.map((item) => `${code(item.publicId)} ${h(truncate(item.title, 100))}`),
    "",
    "Nothing changes until you press Confirm. Only the person who requested this action can confirm it."
  ].join("\n");
}

export function formatBulkActionResult(result: Awaited<ReturnType<typeof confirmBulkAction>>): string {
  const verb = result.action === "complete"
    ? "Completed"
    : "Archived";
  return [
    bold(`${verb} ${result.changed} ${result.itemKind}${result.changed === 1 ? "" : "s"}`),
    ...result.items.map((item) => `${code(item.publicId)} ${h(truncate(item.title, 100))}`),
    result.skipped ? `${result.skipped} item${result.skipped === 1 ? " was" : "s were"} skipped because it had already changed or was unavailable.` : undefined
  ].filter(Boolean).join("\n");
}

async function claimPendingBulkAction(userId: string, pendingId: string, telegramId: string) {
  const pending = await prisma.pendingBulkAction.findFirstOrThrow({
    where: { id: pendingId, userId, expiresAt: { gt: new Date() } }
  });
  if (pending.requestedByTelegramId !== telegramId) {
    throw new Error("Only the person who requested this bulk action can confirm or cancel it.");
  }
  const claimed = await prisma.pendingBulkAction.deleteMany({
    where: { id: pending.id, userId, requestedByTelegramId: telegramId, expiresAt: { gt: new Date() } }
  });
  if (claimed.count !== 1) {
    throw new Error("That bulk action was already handled or expired.");
  }
  return pending;
}

async function resolveBulkItems(userId: string, request: BulkActionRequest): Promise<BulkPreviewItem[]> {
  const displayList: BulkPreviewItem[] = request.itemKind === "task"
    ? await listOpenTasks(userId)
    : request.itemKind === "note"
      ? await listRecentNotes(userId)
      : await listRecentIdeas(userId);
  const publicIds = request.references.filter((reference) => !/^\d+$/.test(reference));
  const explicitItems: BulkPreviewItem[] = request.itemKind === "task"
    ? await prisma.task.findMany({
        where: {
          userId,
          archivedAt: null,
          publicId: { in: publicIds },
          ...(request.action === "complete" ? { status: TaskStatus.OPEN } : { status: { not: TaskStatus.CANCELED } })
        }
      })
    : request.itemKind === "note"
      ? await prisma.note.findMany({ where: { userId, archivedAt: null, publicId: { in: publicIds } } })
      : await prisma.idea.findMany({ where: { userId, archivedAt: null, publicId: { in: publicIds } } });
  const byPublicId = new Map(explicitItems.map((item) => [item.publicId.toUpperCase(), item]));
  const resolved: BulkPreviewItem[] = [];
  for (const reference of request.references) {
    if (!referenceMatchesKind(reference, request.itemKind)) {
      throw new Error(`${reference} is not a ${request.itemKind} ID.`);
    }
    const numeric = Number(reference);
    const item = Number.isInteger(numeric) && numeric > 0 ? displayList[numeric - 1] : byPublicId.get(reference.toUpperCase());
    if (!item) throw new Error(`I couldn't find ${request.itemKind} ${reference}. Check the current list and try again.`);
    if (!resolved.some((candidate) => candidate.id === item.id)) resolved.push(item);
  }
  return resolved;
}

function referenceMatchesKind(reference: string, kind: BulkItemKind): boolean {
  if (/^\d+$/.test(reference)) return true;
  return reference.startsWith(`${kind.toUpperCase()}-`);
}

function singularKind(value: string): BulkItemKind {
  const normalized = value.toLowerCase().replace(/s$/, "");
  return normalized as BulkItemKind;
}
