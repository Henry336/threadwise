/**
 * Study resources (notes, images, links, files, questions) and the capture state around them:
 * the ten-minute active module, pending captures waiting for a module choice, and silent
 * note-taking sessions that collect many messages into one note. Used by src/bot/studyCapture.ts,
 * src/bot/study.ts and the dashboard Study routes. Every query is scoped to one Study workspace.
 */
import {
  Prisma,
  StudyResourceKind,
  type StudyModule,
  type StudyWorkspace,
} from "@prisma/client";
import type { Bot } from "grammy";
import { randomBytes } from "crypto";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { StudyModeError, findStudyModule } from "./study";
import { completeSearchableContentUpdate, contentMatchesQuery, encryptedSearchClause } from "../security/contentEncryption";
import { rebuildStudyNoteLinks, recordStudyNoteRevision } from "./studyMarkdown";
import { deriveStudyResourceAnalysis, studyResourceWikiLookupKeys } from "./studyScale";
import { highestPublicNumber } from "./publicIds";
import { startLoop, type StopLoop } from "../utils/loop";

/** A note session auto-saves after 30 minutes without a new paragraph. */
export const STUDY_NOTE_IDLE_MS = 30 * 60_000;
export const STUDY_NOTE_POLL_MS = 60_000;
/** How long an opened module stays the default target for new captures. */
export const STUDY_CAPTURE_CONTEXT_MS = 10 * 60_000;
const RESOURCE_PAGE_SIZE = 6;

export type StudyResourceInput = {
  moduleId: string;
  kind: StudyResourceKind;
  title?: string;
  body?: string;
  url?: string;
  tags?: string[];
  telegramFileId?: string;
  telegramUniqueId?: string;
  mediaKind?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  ocrText?: string;
  ocrConfidence?: number;
  sourceMessageId?: number;
  sourceSenderTelegramId?: string;
  sourceSentAt?: Date;
};

/**
 * Opens a module as the capture target for the next ten minutes. The selection is stored on the
 * workspace row (not in memory) so it survives restarts, and it expires so later captures are not
 * filed into a module the owner has stopped thinking about. Archived modules are rejected.
 */
export async function setActiveStudyModule(workspace: StudyWorkspace, reference: string): Promise<StudyModule> {
  const module = await findStudyModule(workspace.id, reference);
  if (!module.active) throw new StudyModeError("That module is archived.", "invalid");
  const activeModuleUntil = new Date(Date.now() + STUDY_CAPTURE_CONTEXT_MS);
  await prisma.studyWorkspace.update({
    where: { id: workspace.id },
    data: { activeModuleId: module.id, activeModuleUntil },
  });
  await prisma.auditLog.create({
    data: {
      userId: workspace.ownerUserId,
      action: "study.module.activated",
      metadata: { workspaceId: workspace.id, moduleId: module.id, code: module.code, activeModuleUntil },
    },
  });
  return module;
}

/**
 * Returns the current capture module, or undefined. Reads fresh from the database rather than the
 * passed workspace object. Clears the selection as a side effect when it expired or the module was
 * archived, so stale context never lingers.
 */
export async function activeStudyModule(workspace: StudyWorkspace): Promise<StudyModule | undefined> {
  const now = new Date();
  const selected = await prisma.studyWorkspace.findUnique({
    where: { id: workspace.id },
    select: { activeModuleId: true, activeModuleUntil: true },
  });
  if (!selected?.activeModuleId || !selected.activeModuleUntil || selected.activeModuleUntil <= now) {
    if (selected?.activeModuleId || selected?.activeModuleUntil) {
      await prisma.studyWorkspace.updateMany({
        where: { id: workspace.id, OR: [{ activeModuleId: { not: null } }, { activeModuleUntil: { not: null } }] },
        data: { activeModuleId: null, activeModuleUntil: null },
      });
    }
    return undefined;
  }
  const module = await prisma.studyModule.findFirst({
    where: { id: selected.activeModuleId, workspaceId: workspace.id, active: true },
  }) ?? undefined;
  if (!module) {
    await prisma.studyWorkspace.updateMany({
      where: { id: workspace.id },
      data: { activeModuleId: null, activeModuleUntil: null },
    });
  }
  return module;
}

/** Like activeStudyModule, but also returns when the context expires and the minutes left, for display. */
export async function studyCaptureContext(workspace: StudyWorkspace): Promise<{
  module: StudyModule;
  expiresAt: Date;
  remainingMinutes: number;
} | undefined> {
  const now = new Date();
  const selected = await prisma.studyWorkspace.findUnique({
    where: { id: workspace.id },
    select: { activeModuleId: true, activeModuleUntil: true },
  });
  if (!selected?.activeModuleId || !selected.activeModuleUntil || selected.activeModuleUntil <= now) {
    await activeStudyModule(workspace);
    return undefined;
  }
  const module = await prisma.studyModule.findFirst({
    where: { id: selected.activeModuleId, workspaceId: workspace.id, active: true },
  });
  if (!module) {
    await activeStudyModule(workspace);
    return undefined;
  }
  return {
    module,
    expiresAt: selected.activeModuleUntil,
    remainingMinutes: Math.max(1, Math.ceil((selected.activeModuleUntil.getTime() - now.getTime()) / 60_000)),
  };
}

export async function requireActiveStudyModule(workspace: StudyWorkspace): Promise<StudyModule> {
  const module = await activeStudyModule(workspace);
  if (!module) throw new StudyModeError("Choose a module first. Tap Modules, then Open module.", "invalid");
  return module;
}

/**
 * Saves one resource into an active module of this workspace. A repeated Telegram file (same
 * telegramUniqueId) returns the existing row with duplicate=true instead of saving twice.
 * The insert, audit log, and for notes the first revision and wiki links, commit in one transaction.
 * Derived excerpt and wiki lookup columns are computed here so reads stay cheap.
 */
export async function createStudyResource(workspace: StudyWorkspace, input: StudyResourceInput) {
  const module = await prisma.studyModule.findFirst({
    where: { id: input.moduleId, workspaceId: workspace.id, active: true },
  });
  if (!module) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  if (input.telegramUniqueId) {
    const duplicate = await prisma.studyResource.findFirst({
      where: { workspaceId: workspace.id, telegramUniqueId: input.telegramUniqueId },
      include: { module: true },
    });
    if (duplicate) return { resource: duplicate, duplicate: true };
  }
  // Note sessions promise verbatim paragraph storage. Callers already trim
  // command syntax before it reaches this service; the shared persistence
  // layer must not silently rewrite intentional whitespace in captured text.
  const body = input.body;
  const caption = input.caption?.trim();
  const url = input.url?.trim();
  const fallback = input.fileName || caption || url || body || `${humanKind(input.kind)} capture`;
  const title = cleanTitle(input.title || deriveStudyResourceTitle(fallback));
  const publicId = await nextStudyResourcePublicId(workspace.id, input.kind);
  const analysis = deriveStudyResourceAnalysis({ kind: input.kind, body, caption, ocrText: input.ocrText });
  const resource = await prisma.$transaction(async (tx) => {
    const created = await tx.studyResource.create({
      data: {
      workspaceId: workspace.id,
      moduleId: module.id,
      publicId,
      kind: input.kind,
      title,
      body,
      url: url?.slice(0, 4_000),
      tags: normalizeTags(input.tags ?? []),
      telegramFileId: input.telegramFileId,
      telegramUniqueId: input.telegramUniqueId,
      mediaKind: input.mediaKind,
      mimeType: input.mimeType,
      fileName: input.fileName?.slice(0, 500),
      fileSize: input.fileSize,
      caption: caption?.slice(0, 4_000),
      ocrText: input.ocrText?.slice(0, 100_000),
      ...analysis,
      wikiLookupKeys: studyResourceWikiLookupKeys({ kind: input.kind, title, publicId }),
      ocrConfidence: input.ocrConfidence,
      sourceMessageId: input.sourceMessageId,
      sourceSenderTelegramId: input.sourceSenderTelegramId,
      sourceSentAt: input.sourceSentAt,
      },
      include: { module: true },
    });
    await tx.auditLog.create({ data: {
      userId: workspace.ownerUserId,
      action: "study.resource.created",
      metadata: {
        workspaceId: workspace.id,
        moduleId: module.id,
        resourceId: created.id,
        publicId,
        kind: input.kind,
      },
    } });
    if (created.kind === StudyResourceKind.NOTE) {
      await recordStudyNoteRevision(created, input.sourceMessageId ? "TELEGRAM" : "DASHBOARD", tx);
      await rebuildStudyNoteLinks(workspace.id, created.id, tx);
    }
    return created;
  });
  return { resource, duplicate: false };
}

/**
 * Stores OCR text for an image after local OCR finishes, and refreshes the analysis excerpt.
 * completeSearchableContentUpdate keeps encrypted fields and their search index consistent.
 */
export async function updateStudyResourceOcr(
  workspaceId: string,
  resourceId: string,
  text: string,
  confidence: number,
): Promise<void> {
  const resource = await prisma.studyResource.findFirst({ where: { id: resourceId, workspaceId } });
  if (!resource) return;
  const ocrText = text.slice(0, 100_000);
  await prisma.studyResource.update({
    where: { id: resource.id },
    data: completeSearchableContentUpdate("StudyResource", resource, {
      ocrText, ocrConfidence: confidence,
      ...deriveStudyResourceAnalysis({ ...resource, ocrText }),
    }),
  });
}

/**
 * One page (six items) of active resources, pinned first, optionally filtered by module, kind or text.
 * Text search matches plaintext columns plus the encrypted-content search clause, then re-checks each
 * row after decryption with contentMatchesQuery, so a page can hold fewer than six results.
 */
export async function listStudyResources(
  workspaceId: string,
  input: { moduleId?: string; kind?: StudyResourceKind; query?: string; page?: number } = {},
) {
  const query = input.query?.trim();
  const encrypted = query ? encryptedSearchClause("StudyResource", query) : undefined;
  const where: Prisma.StudyResourceWhereInput = {
    workspaceId,
    archivedAt: null,
    module: { active: true },
    ...(input.moduleId ? { moduleId: input.moduleId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(query ? {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { body: { contains: query, mode: "insensitive" } },
        { caption: { contains: query, mode: "insensitive" } },
        { ocrText: { contains: query, mode: "insensitive" } },
        { fileName: { contains: query, mode: "insensitive" } },
        { url: { contains: query, mode: "insensitive" } },
        { tags: { has: query.toLowerCase().replace(/^#/, "") } },
        ...(encrypted ? [encrypted] : []),
      ],
    } : {}),
  };
  const totalItems = await prisma.studyResource.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalItems / RESOURCE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(input.page ?? 1)), totalPages);
  const resources = (await prisma.studyResource.findMany({
    where,
    include: { module: true },
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    skip: (page - 1) * RESOURCE_PAGE_SIZE,
    take: RESOURCE_PAGE_SIZE,
  })).filter((resource) => !query || contentMatchesQuery("StudyResource", resource, query));
  return { resources, page, totalPages, totalItems, query };
}

/** Finds a resource by public id (e.g. SNOTE-3) or internal UUID, only within active modules of this workspace. */
export async function findStudyResource(workspaceId: string, reference: string) {
  const normalized = reference.trim().toUpperCase();
  const resource = await prisma.studyResource.findFirst({
    where: {
      workspaceId,
      module: { active: true },
      OR: [
        { publicId: normalized },
        ...(isUuid(reference) ? [{ id: reference }] : []),
      ],
    },
    include: { module: true },
  });
  if (!resource) throw new StudyModeError(`I couldn't find ${normalized}.`, "not_found");
  return resource;
}

export async function pinStudyResource(workspace: StudyWorkspace, reference: string, pinned: boolean) {
  const resource = await findStudyResource(workspace.id, reference);
  const updated = await prisma.studyResource.update({
    where: { id: resource.id },
    data: { pinnedAt: pinned ? new Date() : null },
    include: { module: true },
  });
  await prisma.auditLog.create({
    data: {
      userId: workspace.ownerUserId,
      action: pinned ? "study.resource.pinned" : "study.resource.unpinned",
      metadata: { workspaceId: workspace.id, resourceId: resource.id, publicId: resource.publicId },
    },
  });
  return updated;
}

/** Soft-deletes a resource by setting archivedAt, so its public id is never reused. Audited. */
export async function archiveStudyResource(workspace: StudyWorkspace, reference: string) {
  const resource = await findStudyResource(workspace.id, reference);
  const updated = await prisma.studyResource.update({
    where: { id: resource.id },
    data: { archivedAt: new Date() },
    include: { module: true },
  });
  await prisma.auditLog.create({
    data: {
      userId: workspace.ownerUserId,
      action: "study.resource.archived",
      metadata: { workspaceId: workspace.id, resourceId: resource.id, publicId: resource.publicId },
    },
  });
  return updated;
}

/**
 * Parks a capture that cannot be saved yet (no clear module, or the owner must choose what it is).
 * The row holds the text or Telegram file reference and a random token used in button callbacks,
 * and expires after 30 minutes. Expired rows for the workspace are cleaned up on each call.
 */
export async function createStudyPendingCapture(workspace: StudyWorkspace, input: {
  moduleId?: string;
  sourceText?: string;
  telegramFileId?: string;
  telegramUniqueId?: string;
  mediaKind?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  sourceMessageId?: number;
  sourceSenderTelegramId?: string;
  sourceSentAt?: Date;
}) {
  if (input.moduleId) {
    const belongs = await prisma.studyModule.count({ where: { id: input.moduleId, workspaceId: workspace.id, active: true } });
    if (!belongs) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  }
  await prisma.studyPendingCapture.deleteMany({ where: { workspaceId: workspace.id, expiresAt: { lte: new Date() } } });
  return prisma.studyPendingCapture.create({
    data: {
      token: randomBytes(9).toString("base64url"),
      workspaceId: workspace.id,
      moduleId: input.moduleId,
      sourceText: input.sourceText?.slice(0, 100_000),
      telegramFileId: input.telegramFileId,
      telegramUniqueId: input.telegramUniqueId,
      mediaKind: input.mediaKind,
      mimeType: input.mimeType,
      fileName: input.fileName,
      fileSize: input.fileSize,
      sourceMessageId: input.sourceMessageId,
      sourceSenderTelegramId: input.sourceSenderTelegramId,
      sourceSentAt: input.sourceSentAt,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
}

/**
 * Claims a pending capture exactly once by deleting it inside a transaction. If two button taps race,
 * only the one whose delete removes the row succeeds; the other gets a conflict. When the last capture
 * of an album batch is claimed, the batch is marked COMPLETED.
 */
export async function consumeStudyPendingCapture(workspaceId: string, token: string) {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.studyPendingCapture.findFirst({
      where: { workspaceId, token, expiresAt: { gt: new Date() } },
    });
    if (!pending) throw new StudyModeError("That capture was already handled or expired. Send it again if needed.", "not_found");
    const claimed = await tx.studyPendingCapture.deleteMany({ where: { id: pending.id, workspaceId, token } });
    if (claimed.count !== 1) throw new StudyModeError("That capture was already handled or expired. Send it again if needed.", "conflict");
    if (pending.batchId) {
      const remaining = await tx.studyPendingCapture.count({ where: { workspaceId, batchId: pending.batchId } });
      if (remaining === 0) {
        await tx.studyPendingCaptureBatch.updateMany({
          where: { id: pending.batchId, workspaceId },
          data: { status: "COMPLETED", completedAt: new Date(), leaseExpiresAt: null },
        });
      }
    }
    return pending;
  });
}

export async function findStudyPendingCapture(workspaceId: string, token: string) {
  const pending = await prisma.studyPendingCapture.findFirst({
    where: { workspaceId, token, expiresAt: { gt: new Date() } },
  });
  if (!pending) throw new StudyModeError("That capture choice expired. Send it again.", "not_found");
  return pending;
}

/** Newest unexpired pending capture sent by this Telegram user, used when a reply refers to "the last capture". */
export async function findLatestStudyPendingCapture(workspaceId: string, actorTelegramId: string | number) {
  return prisma.studyPendingCapture.findFirst({
    where: {
      workspaceId,
      sourceSenderTelegramId: String(actorTelegramId),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Records the module the owner picked for a pending capture, checking it is an active module of this workspace. */
export async function setStudyPendingCaptureModule(workspaceId: string, token: string, moduleId: string) {
  const pending = await findStudyPendingCapture(workspaceId, token);
  const module = await prisma.studyModule.findFirst({ where: { id: moduleId, workspaceId, active: true } });
  if (!module) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  await prisma.studyPendingCapture.update({ where: { id: pending.id }, data: { moduleId: module.id } });
  return { pending: { ...pending, moduleId: module.id }, module };
}

export async function updateStudyPendingCaptureCaption(workspaceId: string, token: string, caption: string) {
  const pending = await findStudyPendingCapture(workspaceId, token);
  return prisma.studyPendingCapture.update({
    where: { id: pending.id },
    data: { sourceText: caption.trim().slice(0, 4_000) || null },
  });
}

export async function updateStudyPendingCaptureSourceText(workspaceId: string, token: string, sourceText: string) {
  const pending = await findStudyPendingCapture(workspaceId, token);
  return prisma.studyPendingCapture.update({
    where: { id: pending.id },
    data: { sourceText: sourceText.trim().slice(0, 100_000) || null },
  });
}

export async function updateStudyPendingCaptureOcr(
  workspaceId: string,
  token: string,
  text: string,
  confidence: number,
) {
  const pending = await findStudyPendingCapture(workspaceId, token);
  return prisma.studyPendingCapture.update({
    where: { id: pending.id },
    data: { ocrText: text.slice(0, 100_000), ocrConfidence: confidence },
  });
}

/**
 * Starts silent note-taking for a module: following messages become paragraphs of one note.
 * There is at most one session per workspace. A live session is resumed; an expired one is saved
 * first, then replaced.
 */
export async function startStudyNoteCaptureSession(workspace: StudyWorkspace, moduleId: string) {
  const module = await prisma.studyModule.findFirst({ where: { id: moduleId, workspaceId: workspace.id, active: true } });
  if (!module) throw new StudyModeError("That module does not belong to this Study workspace.", "forbidden");
  const existing = await prisma.studyNoteCaptureSession.findUnique({
    where: { workspaceId: workspace.id },
    include: { _count: { select: { segments: true } }, module: true },
  });
  if (existing && existing.expiresAt > new Date()) return { session: existing, resumed: true };
  if (existing) await finalizeStudyNoteCaptureSession(workspace);
  const session = await prisma.studyNoteCaptureSession.create({
    data: {
      workspaceId: workspace.id,
      moduleId: module.id,
      chatId: workspace.boundChatId!,
      expiresAt: nextNoteExpiry(),
    },
    include: { _count: { select: { segments: true } }, module: true },
  });
  return { session, resumed: false };
}

export async function currentStudyNoteCaptureSession(workspaceId: string) {
  return prisma.studyNoteCaptureSession.findUnique({
    where: { workspaceId },
    include: { _count: { select: { segments: true } }, module: true },
  });
}

/**
 * Adds one Telegram message as a paragraph and pushes the idle expiry forward. A unique constraint on
 * the message id makes a redelivered Telegram update return "duplicate" instead of a second copy.
 */
export async function appendStudyNoteSegment(
  workspaceId: string,
  telegramMessageId: number,
  text: string,
): Promise<"saved" | "duplicate" | "expired" | "missing"> {
  const session = await prisma.studyNoteCaptureSession.findUnique({ where: { workspaceId } });
  if (!session) return "missing";
  if (session.expiresAt <= new Date()) return "expired";
  try {
    await prisma.$transaction([
      prisma.studyNoteCaptureSegment.create({ data: { sessionId: session.id, telegramMessageId, text } }),
      prisma.studyNoteCaptureSession.update({ where: { id: session.id }, data: { expiresAt: nextNoteExpiry() } }),
    ]);
    return "saved";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
}

/** Discards the note session and its paragraphs; returns how many paragraphs were dropped. */
export async function cancelStudyNoteCaptureSession(workspaceId: string): Promise<number> {
  const session = await prisma.studyNoteCaptureSession.findUnique({
    where: { workspaceId },
    include: { _count: { select: { segments: true } } },
  });
  if (!session) return 0;
  await prisma.studyNoteCaptureSession.delete({ where: { id: session.id } });
  return session._count.segments;
}

/**
 * Joins the session's paragraphs in message order into one note, saves it via createStudyResource,
 * and deletes the session. An empty session is simply closed. Returns the chat id so the caller can reply.
 */
export async function finalizeStudyNoteCaptureSession(workspace: StudyWorkspace) {
  const session = await prisma.studyNoteCaptureSession.findUnique({
    where: { workspaceId: workspace.id },
    include: { segments: { orderBy: [{ createdAt: "asc" }, { telegramMessageId: "asc" }] }, module: true },
  });
  if (!session) return undefined;
  const paragraphs = session.segments.map((segment) => segment.text).filter((text) => text.trim());
  if (paragraphs.length === 0) {
    await prisma.studyNoteCaptureSession.delete({ where: { id: session.id } });
    return { chatId: session.chatId, paragraphCount: 0, module: session.module };
  }
  const body = paragraphs.join("\n\n");
  const result = await createStudyResource(workspace, {
    moduleId: session.moduleId,
    kind: StudyResourceKind.NOTE,
    title: deriveStudyResourceTitle(paragraphs[0]!),
    body,
    sourceMessageId: session.segments[0]?.telegramMessageId,
  });
  await prisma.studyNoteCaptureSession.delete({ where: { id: session.id } });
  return {
    chatId: session.chatId,
    paragraphCount: paragraphs.length,
    module: session.module,
    resource: result.resource,
  };
}

/**
 * Saves up to 20 idle note sessions per pass. Each one is re-read before saving so a session that got
 * a new paragraph in the meantime is left running.
 */
export async function finalizeExpiredStudyNoteSessions(now = new Date()) {
  const sessions = await prisma.studyNoteCaptureSession.findMany({
    where: { expiresAt: { lte: now } },
    include: { workspace: true },
    orderBy: { expiresAt: "asc" },
    take: 20,
  });
  const results: NonNullable<Awaited<ReturnType<typeof finalizeStudyNoteCaptureSession>>>[] = [];
  for (const session of sessions) {
    const current = await prisma.studyNoteCaptureSession.findUnique({ where: { id: session.id } });
    if (!current || current.expiresAt > now) continue;
    const finalized = await finalizeStudyNoteCaptureSession(session.workspace);
    if (finalized) results.push(finalized);
  }
  return results;
}

/** Auto-saves Study note captures that ran out of time. */
export function startStudyNoteCaptureExpiryLoop(bot: Bot, pollMs = STUDY_NOTE_POLL_MS): StopLoop {
  return startLoop("Study note capture expiry", pollMs, () => autoSaveStudyNotes(bot));
}

/** Default title: the first sentence of the text, on one line, capped at 96 characters. */
export function deriveStudyResourceTitle(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim() || "Untitled capture";
  const sentence = singleLine.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? singleLine;
  return cleanTitle(sentence);
}

/**
 * Split stored Study text for Telegram without changing the persisted body.
 * The budget is measured after HTML escaping because a note containing many
 * ampersands or angle brackets can otherwise exceed Telegram's message limit
 * even when its raw character count looks safe.
 */
export function paginateStudyText(value: string, maxEscapedLength = 3_100): string[] {
  const paragraphs = value.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const pages: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [value]) {
    const chunks = escapedLength(paragraph) <= maxEscapedLength
      ? [paragraph]
      : splitStudyTextChunk(paragraph, maxEscapedLength);
    for (const chunk of chunks) {
      const candidate = current ? `${current}\n\n${chunk}` : chunk;
      if (escapedLength(candidate) <= maxEscapedLength) current = candidate;
      else {
        if (current) pages.push(current);
        current = chunk;
      }
    }
  }
  if (current) pages.push(current);
  return pages.length ? pages : ["No text."];
}

function cleanTitle(value: string): string {
  const characters = Array.from(value.replace(/\s+/g, " ").trim() || "Untitled capture");
  return characters.length <= 96 ? characters.join("") : `${characters.slice(0, 95).join("").trimEnd()}…`;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 20);
}

/**
 * Splits one paragraph that is too long for a Telegram page. Binary search finds the longest prefix
 * that fits after escaping, then the cut moves back to a nearby space or punctuation mark when one
 * exists in the last 40 percent of the chunk.
 */
function splitStudyTextChunk(value: string, maxEscapedLength: number): string[] {
  const chunks: string[] = [];
  let remaining = Array.from(value);
  while (escapedLength(remaining.join("")) > maxEscapedLength) {
    let low = 1;
    let high = remaining.length;
    let best = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (escapedLength(remaining.slice(0, middle).join("")) <= maxEscapedLength) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    let boundary = best;
    for (let index = best - 1; index >= Math.floor(best * 0.6); index -= 1) {
      if (/\s|[.!?;,]/u.test(remaining[index] ?? "")) {
        boundary = index + 1;
        break;
      }
    }
    chunks.push(remaining.slice(0, boundary).join("").trim());
    remaining = remaining.slice(boundary);
    while (remaining[0] && /\s/u.test(remaining[0])) remaining.shift();
  }
  const tail = remaining.join("").trim();
  if (tail) chunks.push(tail);
  return chunks;
}

function escapedLength(value: string): number {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").length;
}

/** Next human-readable id for this kind in this workspace (SNOTE-n, SIMG-n, ...), one above the highest used. */
async function nextStudyResourcePublicId(workspaceId: string, kind: StudyResourceKind): Promise<string> {
  const prefix: Record<StudyResourceKind, string> = {
    [StudyResourceKind.NOTE]: "SNOTE",
    [StudyResourceKind.IMAGE]: "SIMG",
    [StudyResourceKind.LINK]: "SLINK",
    [StudyResourceKind.FILE]: "SFILE",
    [StudyResourceKind.QUESTION]: "QUESTION",
  };
  const root = prefix[kind];
  const rows = await prisma.studyResource.findMany({ where: { workspaceId, publicId: { startsWith: `${root}-` } }, select: { publicId: true } });
  return `${root}-${highestPublicNumber(rows, root) + 1}`;
}

/**
 * Loop body: saves expired note sessions, then posts a short confirmation that deletes itself after
 * 3.5 seconds. Errors are logged so one bad pass does not stop the loop.
 */
async function autoSaveStudyNotes(bot: Bot): Promise<void> {
  try {
    const results = await finalizeExpiredStudyNoteSessions();
    for (const result of results) {
      const memberCount = await bot.api.getChatMemberCount(result.chatId).catch(() => undefined);
      // Auto-save still persists the draft, but proactive chat output fails
      // closed if the sealed Study group can no longer be verified.
      if (memberCount !== 2) continue;
      const text = result.resource
        ? `Auto-saved ${result.module.code} note · ${result.paragraphCount} paragraph${result.paragraphCount === 1 ? "" : "s"}`
        : "Empty Study note closed.";
      const message = await bot.api.sendMessage(result.chatId, text, {
        reply_markup: {
          keyboard: [[{ text: "Study menu" }]],
          resize_keyboard: true,
          is_persistent: true,
          input_field_placeholder: "Capture for Study Mode…",
        },
      });
      const removal = setTimeout(() => void bot.api.deleteMessage(result.chatId, message.message_id).catch(() => undefined), 3_500);
      removal.unref?.();
    }
  } catch (error) {
    logger.error("Could not auto-save expired Study note sessions.", { error: String(error) });
  }
}

function humanKind(kind: StudyResourceKind): string {
  return kind.toLowerCase().replace(/_/g, " ");
}

function nextNoteExpiry(): Date {
  return new Date(Date.now() + STUDY_NOTE_IDLE_MS);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
