import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { PROTECTED_JSON_PLACEHOLDER, PROTECTED_PAYLOAD_PLACEHOLDER, serializeProtectedPayload } from "../src/security/protectedPayload";

const APPLY = process.argv.includes("--apply");
const APPLY_ACKNOWLEDGEMENT = "apply-phase-3-privacy";
const BATCH_SIZE = 25;
const LEASE_MS = 5 * 60_000;
const RUN_KIND = "phase3-content-backfill-v1";

type Row = { id: string; updatedAt?: Date } & Record<string, unknown>;
type Target = {
  name: string;
  count: () => Promise<number>;
  page: (cursor?: string) => Promise<Row[]>;
  rewrite: (row: Row) => Promise<boolean>;
};

function applyConfiguration() {
  if (!APPLY) return undefined;
  if (process.env.THREADWISE_PRIVACY_MIGRATION_ACK !== APPLY_ACKNOWLEDGEMENT) {
    throw new Error("The Phase 3 apply acknowledgement is missing.");
  }
  if (process.env.CONTENT_ENCRYPTION_MODE !== "write" || !process.env.CONTENT_ENCRYPTION_KEY) {
    throw new Error("Content encryption write mode and key are required for Phase 3 apply.");
  }
  const backupReference = process.env.THREADWISE_VERIFIED_BACKUP_REFERENCE?.trim();
  if (!backupReference || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/u.test(backupReference)) {
    throw new Error("A safe verified-backup reference is required for Phase 3 apply.");
  }
  return createHash("sha256").update(backupReference).digest("hex");
}

function targets(): Target[] {
  return [
    target("tasks", () => prisma.task.count(), (cursor) => prisma.task.findMany({
      select: { id: true, updatedAt: true, title: true, description: true, sourceText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.task.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { title: row.title as string, description: row.description as string | null, sourceText: row.sourceText as string },
    }).then(({ count }) => count === 1)),
    target("notes", () => prisma.note.count(), (cursor) => prisma.note.findMany({
      select: { id: true, updatedAt: true, title: true, body: true, summary: true, sourceText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.note.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { title: row.title as string, body: row.body as string, summary: row.summary as string, sourceText: row.sourceText as string },
    }).then(({ count }) => count === 1)),
    target("ideas", () => prisma.idea.count(), (cursor) => prisma.idea.findMany({
      select: { id: true, updatedAt: true, title: true, concept: true, problem: true, targetUser: true, sourceText: true, marketNotes: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.idea.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { title: row.title as string, concept: row.concept as string, problem: row.problem as string | null, targetUser: row.targetUser as string | null, sourceText: row.sourceText as string, marketNotes: row.marketNotes as string | null },
    }).then(({ count }) => count === 1)),
    target("stored-images", () => prisma.storedImage.count(), (cursor) => prisma.storedImage.findMany({
      select: { id: true, updatedAt: true, fileName: true, caption: true, ocrText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.storedImage.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { fileName: row.fileName as string | null, caption: row.caption as string | null, ocrText: row.ocrText as string | null },
    }).then(({ count }) => count === 1)),
    target("study-resources", () => prisma.studyResource.count(), (cursor) => prisma.studyResource.findMany({
      select: { id: true, updatedAt: true, title: true, body: true, url: true, fileName: true, caption: true, ocrText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.studyResource.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { title: row.title as string, body: row.body as string | null, url: row.url as string | null, fileName: row.fileName as string | null, caption: row.caption as string | null, ocrText: row.ocrText as string | null },
    }).then(({ count }) => count === 1)),
    target("study-resource-revisions", () => prisma.studyResourceRevision.count(), (cursor) => prisma.studyResourceRevision.findMany({
      select: { id: true, title: true, body: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.studyResourceRevision.update({
      where: { id: row.id }, data: { title: row.title as string, body: row.body as string },
    }).then(() => true)),
    target("idea-ai-jobs", () => prisma.geminiIdeaJob.count(), (cursor) => prisma.geminiIdeaJob.findMany({
      select: { id: true, updatedAt: true, prompt: true, finalResponse: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.geminiIdeaJob.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt }, data: { prompt: row.prompt as string, finalResponse: row.finalResponse as string | null },
    }).then(({ count }) => count === 1)),
    target("study-analysis-jobs", () => prisma.geminiStudyAnalysisJob.count(), (cursor) => prisma.geminiStudyAnalysisJob.findMany({
      select: { id: true, updatedAt: true, evidenceJson: true, prompt: true, result: true, evidenceCiphertext: true, promptCiphertext: true, resultCiphertext: true },
      orderBy: { id: "asc" }, take: BATCH_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => {
      const evidenceCiphertext = row.evidenceCiphertext as string | null ?? serializeProtectedPayload(row.evidenceJson);
      const promptCiphertext = row.promptCiphertext as string | null ?? String(row.prompt);
      const resultCiphertext = row.resultCiphertext as string | null ?? (row.result ? serializeProtectedPayload(row.result) : null);
      return prisma.geminiStudyAnalysisJob.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: {
          evidenceJson: PROTECTED_JSON_PLACEHOLDER as unknown as Prisma.InputJsonValue,
          prompt: PROTECTED_PAYLOAD_PLACEHOLDER,
          result: resultCiphertext ? PROTECTED_JSON_PLACEHOLDER as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
          evidenceCiphertext,
          promptCiphertext,
          resultCiphertext,
        },
      }).then(({ count }) => count === 1);
    }),
    target("study-note-suggestions", () => prisma.studyNoteEditSuggestion.count(), (cursor) => prisma.studyNoteEditSuggestion.findMany({
      select: { id: true, updatedAt: true, originalBody: true, suggestedBody: true, rationale: true, appliedBody: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.studyNoteEditSuggestion.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt }, data: { originalBody: row.originalBody as string, suggestedBody: row.suggestedBody as string, rationale: row.rationale as string, appliedBody: row.appliedBody as string | null },
    }).then(({ count }) => count === 1)),
    target("canvas-extracted-text", () => prisma.studyCanvasMaterial.count({ where: { extractedText: { not: null } } }), (cursor) => prisma.studyCanvasMaterial.findMany({
      where: { extractedText: { not: null } }, select: { id: true, updatedAt: true, extractedText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.studyCanvasMaterial.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt }, data: { extractedText: row.extractedText as string },
    }).then(({ count }) => count === 1)),
  ];
}

function target(name: string, count: Target["count"], page: Target["page"], rewrite: Target["rewrite"]): Target {
  return { name, count, page, rewrite };
}

async function dryRun(items: Target[]): Promise<void> {
  const counts = [];
  for (const item of items) counts.push({ target: item.name, rows: await item.count() });
  console.table(counts);
  console.log("Dry run only. No maintenance row or protected content was changed.");
}

async function claimRun(backupReferenceHash: string, workerId: string) {
  const now = new Date();
  const existing = await prisma.privacyMaintenanceRun.findFirst({ where: { kind: RUN_KIND, status: "RUNNING" }, orderBy: { updatedAt: "desc" } });
  if (existing) {
    if (existing.backupReferenceHash !== backupReferenceHash) throw new Error("The running migration belongs to a different verified backup.");
    const claimed = await prisma.privacyMaintenanceRun.updateMany({
      where: { id: existing.id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }] },
      data: { leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), safeErrorCode: null },
    });
    if (claimed.count !== 1) throw new Error("Another Phase 3 migration worker holds the lease.");
    return prisma.privacyMaintenanceRun.findUniqueOrThrow({ where: { id: existing.id } });
  }
  return prisma.privacyMaintenanceRun.create({
    data: { kind: RUN_KIND, status: "RUNNING", backupReferenceHash, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
}

async function apply(items: Target[], backupReferenceHash: string): Promise<void> {
  const completed = await prisma.privacyMaintenanceRun.findFirst({
    where: { kind: RUN_KIND, status: "COMPLETED", backupReferenceHash },
    select: { id: true },
  });
  if (completed) {
    console.log("Phase 3 privacy backfill already completed for this verified backup reference.");
    return;
  }
  const workerId = randomUUID();
  const run = await claimRun(backupReferenceHash, workerId);
  const startIndex = run.target ? Math.max(0, items.findIndex(({ name }) => name === run.target)) : 0;
  for (let targetIndex = startIndex; targetIndex < items.length; targetIndex += 1) {
    const item = items[targetIndex]!;
    let cursor = run.target === item.name ? run.lastCursor ?? undefined : undefined;
    await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { target: item.name, lastCursor: cursor ?? null } });
    while (true) {
      const rows = await item.page(cursor);
      if (!rows.length) break;
      for (const row of rows) {
        const changed = await item.rewrite(row);
        if (!changed) {
          await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { conflictCount: { increment: 1 }, safeErrorCode: "CONCURRENT_CHANGE", leaseOwner: null, leaseExpiresAt: null } });
          throw new Error(`Concurrent change detected in ${item.name}; rerun after the live edit settles.`);
        }
        cursor = row.id;
        await prisma.privacyMaintenanceRun.update({
          where: { id: run.id },
          data: { lastCursor: cursor, processedCount: { increment: 1 }, changedCount: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
        });
      }
      console.log(`${item.name}: ${rows.length} rows committed in the latest batch`);
    }
    const nextTarget = items[targetIndex + 1]?.name ?? null;
    await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { target: nextTarget, lastCursor: null } });
  }
  await prisma.privacyMaintenanceRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", completedAt: new Date(), target: null, lastCursor: null, leaseOwner: null, leaseExpiresAt: null, safeErrorCode: null },
  });
  console.log("Phase 3 privacy backfill completed. Run the aggregate inspector before any legacy-column removal.");
}

async function main() {
  const backupReferenceHash = applyConfiguration();
  const items = targets();
  if (!APPLY) return dryRun(items);
  await apply(items, backupReferenceHash!);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 3 privacy migration failed safely.");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
