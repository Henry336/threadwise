import { createHash, randomUUID } from "node:crypto";
import { CodexJobStatus, Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { PROTECTED_JSON_PLACEHOLDER, PROTECTED_PAYLOAD_PLACEHOLDER, serializeProtectedPayload } from "../src/security/protectedPayload";
import { compactStudyAnalysisSnapshot, readStoredStudyAnalysisSnapshot } from "../src/services/geminiStudyAnalysis";
import { abandonedStudyAnalysisStatuses, privacyRetentionCutoffs, reviewedSuggestionStatuses } from "../src/services/privacyRetention";

const APPLY = process.argv.includes("--apply");
const APPLY_ACKNOWLEDGEMENT = "apply-phase-3-retention";
const BATCH_SIZE = 25;
const LEASE_MS = 5 * 60_000;
const RUN_KIND = "phase3-retention-v1";

type MaintenanceRun = Awaited<ReturnType<typeof prisma.privacyMaintenanceRun.findUniqueOrThrow>>;
type RetentionOutcome = { processed: number; changed: number };
type Target = { name: string; count: () => Promise<number>; apply: (run: MaintenanceRun, workerId: string) => Promise<RetentionOutcome> };

function applyConfiguration(): string | undefined {
  if (!APPLY) return undefined;
  if (process.env.THREADWISE_PRIVACY_RETENTION_ACK !== APPLY_ACKNOWLEDGEMENT) throw new Error("The Phase 3 retention acknowledgement is missing.");
  if (process.env.CONTENT_ENCRYPTION_MODE !== "write" || !process.env.CONTENT_ENCRYPTION_KEY) throw new Error("Content encryption write mode and key are required for retention apply.");
  const reference = process.env.THREADWISE_VERIFIED_BACKUP_REFERENCE?.trim();
  if (!reference || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/u.test(reference)) throw new Error("A safe verified-backup reference is required for retention apply.");
  return createHash("sha256").update(reference).digest("hex");
}

function retentionTargets(now = new Date()): Target[] {
  const cutoffs = privacyRetentionCutoffs(now);
  const abandonedWhere = { status: { in: abandonedStudyAnalysisStatuses }, updatedAt: { lt: cutoffs.failedOrAbandonedBefore } } as const;
  return [
    {
      name: "expired-study-analysis-jobs",
      count: () => prisma.geminiStudyAnalysisJob.count({ where: abandonedWhere }),
      apply: (run, workerId) => deleteById(run, workerId,
        (after) => prisma.geminiStudyAnalysisJob.findMany({ where: { ...abandonedWhere, ...(after ? { id: { gt: after } } : {}) }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH_SIZE }),
        (row) => prisma.geminiStudyAnalysisJob.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } }).then(({ count }) => count === 1)),
    },
    {
      name: "expired-idea-analysis-jobs",
      count: () => prisma.geminiIdeaJob.count({ where: abandonedWhere }),
      apply: (run, workerId) => deleteById(run, workerId,
        (after) => prisma.geminiIdeaJob.findMany({ where: { ...abandonedWhere, ...(after ? { id: { gt: after } } : {}) }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH_SIZE }),
        (row) => prisma.geminiIdeaJob.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } }).then(({ count }) => count === 1)),
    },
    {
      name: "completed-study-diagnostics",
      count: () => prisma.geminiStudyAnalysisJob.count({ where: { status: CodexJobStatus.COMPLETED, completedAt: { lt: cutoffs.completedDiagnosticsBefore }, diagnosticsPurgedAt: null } }),
      apply: (run, workerId) => rewriteById(run, workerId,
        (after) => prisma.geminiStudyAnalysisJob.findMany({
          where: { status: CodexJobStatus.COMPLETED, completedAt: { lt: cutoffs.completedDiagnosticsBefore }, diagnosticsPurgedAt: null, ...(after ? { id: { gt: after } } : {}) },
          select: { id: true, updatedAt: true, evidenceJson: true, evidenceCiphertext: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
        }),
        (row) => prisma.geminiStudyAnalysisJob.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt, diagnosticsPurgedAt: null },
          data: {
            evidenceJson: PROTECTED_JSON_PLACEHOLDER as unknown as Prisma.InputJsonValue,
            evidenceCiphertext: serializeProtectedPayload(compactStudyAnalysisSnapshot(readStoredStudyAnalysisSnapshot(row))),
            prompt: PROTECTED_PAYLOAD_PLACEHOLDER,
            promptCiphertext: null,
            diagnosticsPurgedAt: now,
          },
        }).then(({ count }) => count === 1)),
    },
    {
      name: "completed-idea-prompts",
      count: () => prisma.geminiIdeaJob.count({ where: { status: CodexJobStatus.COMPLETED, completedAt: { lt: cutoffs.completedDiagnosticsBefore }, diagnosticsPurgedAt: null } }),
      apply: (run, workerId) => rewriteById(run, workerId,
        (after) => prisma.geminiIdeaJob.findMany({ where: { status: CodexJobStatus.COMPLETED, completedAt: { lt: cutoffs.completedDiagnosticsBefore }, diagnosticsPurgedAt: null, ...(after ? { id: { gt: after } } : {}) }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH_SIZE }),
        (row) => prisma.geminiIdeaJob.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, diagnosticsPurgedAt: null }, data: { prompt: PROTECTED_PAYLOAD_PLACEHOLDER, diagnosticsPurgedAt: now } }).then(({ count }) => count === 1)),
    },
    {
      name: "superseded-study-analysis-jobs",
      count: () => countSupersededStudy(cutoffs.supersededCompletedBefore),
      apply: (run, workerId) => scanSupersededStudy(run, workerId, cutoffs.supersededCompletedBefore),
    },
    {
      name: "superseded-idea-analysis-jobs",
      count: () => countSupersededIdea(cutoffs.supersededCompletedBefore),
      apply: (run, workerId) => scanSupersededIdea(run, workerId, cutoffs.supersededCompletedBefore),
    },
    {
      name: "reviewed-note-suggestions",
      count: () => prisma.studyNoteEditSuggestion.count({ where: { status: { in: reviewedSuggestionStatuses }, reviewedAt: { lt: cutoffs.reviewedSuggestionBefore } } }),
      apply: (run, workerId) => deleteById(run, workerId,
        (after) => prisma.studyNoteEditSuggestion.findMany({ where: { status: { in: reviewedSuggestionStatuses }, reviewedAt: { lt: cutoffs.reviewedSuggestionBefore }, ...(after ? { id: { gt: after } } : {}) }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH_SIZE }),
        (row) => prisma.studyNoteEditSuggestion.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } }).then(({ count }) => count === 1)),
    },
  ];
}

async function countSupersededStudy(before: Date) { return scanSupersededStudy(undefined, undefined, before); }
async function countSupersededIdea(before: Date) { return scanSupersededIdea(undefined, undefined, before); }

function scanSupersededStudy(run: undefined, workerId: undefined, before: Date): Promise<number>;
function scanSupersededStudy(run: MaintenanceRun, workerId: string, before: Date): Promise<RetentionOutcome>;
async function scanSupersededStudy(run: MaintenanceRun | undefined, workerId: string | undefined, before: Date): Promise<number | RetentionOutcome> {
  let cursor = run?.lastCursor ?? undefined, processed = 0, changed = 0;
  while (true) {
    const rows = await prisma.geminiStudyAnalysisJob.findMany({ where: { status: CodexJobStatus.COMPLETED, completedAt: { lt: before }, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, workspaceId: true, moduleId: true, mode: true, completedAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH_SIZE });
    if (!rows.length) return run ? { processed, changed } : changed;
    for (const row of rows) {
      const newer = await prisma.geminiStudyAnalysisJob.count({ where: { workspaceId: row.workspaceId, moduleId: row.moduleId, mode: row.mode, status: CodexJobStatus.COMPLETED, completedAt: { gt: row.completedAt! } } });
      let removed = false;
      if (newer && run) {
        removed = (await prisma.geminiStudyAnalysisJob.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } })).count === 1;
        if (!removed) return conflict(run.id, workerId!, processed, changed);
      }
      processed += 1; changed += newer ? 1 : 0; cursor = row.id;
      if (run) await checkpoint(run.id, workerId!, cursor, Boolean(newer));
    }
  }
}

function scanSupersededIdea(run: undefined, workerId: undefined, before: Date): Promise<number>;
function scanSupersededIdea(run: MaintenanceRun, workerId: string, before: Date): Promise<RetentionOutcome>;
async function scanSupersededIdea(run: MaintenanceRun | undefined, workerId: string | undefined, before: Date): Promise<number | RetentionOutcome> {
  let cursor = run?.lastCursor ?? undefined, processed = 0, changed = 0;
  while (true) {
    const rows = await prisma.geminiIdeaJob.findMany({ where: { status: CodexJobStatus.COMPLETED, completedAt: { lt: before }, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, userId: true, ideaId: true, action: true, completedAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: BATCH_SIZE });
    if (!rows.length) return run ? { processed, changed } : changed;
    for (const row of rows) {
      const newer = await prisma.geminiIdeaJob.count({ where: { userId: row.userId, ideaId: row.ideaId, action: row.action, status: CodexJobStatus.COMPLETED, completedAt: { gt: row.completedAt! } } });
      let removed = false;
      if (newer && run) {
        removed = (await prisma.geminiIdeaJob.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } })).count === 1;
        if (!removed) return conflict(run.id, workerId!, processed, changed);
      }
      processed += 1; changed += newer ? 1 : 0; cursor = row.id;
      if (run) await checkpoint(run.id, workerId!, cursor, Boolean(newer));
    }
  }
}

async function deleteById<T extends { id: string }>(run: MaintenanceRun, workerId: string, page: (after?: string) => Promise<T[]>, remove: (row: T) => Promise<boolean>) {
  return rewriteById(run, workerId, page, remove);
}
async function rewriteById<T extends { id: string }>(run: MaintenanceRun, workerId: string, page: (after?: string) => Promise<T[]>, rewrite: (row: T) => Promise<boolean>) {
  let cursor = run.lastCursor ?? undefined, processed = 0, changed = 0;
  while (true) {
    const rows = await page(cursor);
    if (!rows.length) return { processed, changed };
    for (const row of rows) {
      if (!await rewrite(row)) return conflict(run.id, workerId, processed, changed);
      processed += 1; changed += 1; cursor = row.id;
      await checkpoint(run.id, workerId, cursor, true);
    }
  }
}

async function conflict(runId: string, workerId: string, processed: number, changed: number): Promise<never> {
  await prisma.privacyMaintenanceRun.updateMany({ where: { id: runId, leaseOwner: workerId }, data: { conflictCount: { increment: 1 }, safeErrorCode: "CONCURRENT_CHANGE", leaseOwner: null, leaseExpiresAt: null } });
  void processed; void changed;
  throw new Error("Retention stopped safely because a row changed concurrently.");
}
async function checkpoint(runId: string, workerId: string, cursor: string, changed: boolean) {
  const updated = await prisma.privacyMaintenanceRun.updateMany({ where: { id: runId, leaseOwner: workerId }, data: { lastCursor: cursor, processedCount: { increment: 1 }, ...(changed ? { changedCount: { increment: 1 } } : {}), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  if (updated.count !== 1) throw new Error("The retention lease was lost.");
}

async function claimRun(backupReferenceHash: string, workerId: string) {
  const now = new Date();
  const existing = await prisma.privacyMaintenanceRun.findFirst({ where: { kind: RUN_KIND, status: "RUNNING" }, orderBy: { updatedAt: "desc" } });
  if (existing) {
    if (existing.backupReferenceHash !== backupReferenceHash) throw new Error("The running retention job belongs to a different verified backup.");
    const claimed = await prisma.privacyMaintenanceRun.updateMany({ where: { id: existing.id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }] }, data: { leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), safeErrorCode: null } });
    if (claimed.count !== 1) throw new Error("Another retention worker holds the lease.");
    return prisma.privacyMaintenanceRun.findUniqueOrThrow({ where: { id: existing.id } });
  }
  return prisma.privacyMaintenanceRun.create({ data: { kind: RUN_KIND, status: "RUNNING", backupReferenceHash, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } });
}

async function dryRun(items: Target[]) {
  const counts = [];
  for (const item of items) counts.push({ category: item.name, rows: await item.count() });
  console.table(counts);
  console.log("Dry run only. No maintenance row or protected content was changed.");
}

async function apply(items: Target[], backupReferenceHash: string) {
  const workerId = randomUUID();
  let run = await claimRun(backupReferenceHash, workerId);
  const start = run.target ? Math.max(0, items.findIndex(({ name }) => name === run.target)) : 0;
  for (let index = start; index < items.length; index += 1) {
    const item = items[index]!;
    if (run.target !== item.name) {
      run = await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { target: item.name, lastCursor: null } });
    }
    const outcome = await item.apply(run, workerId);
    run = await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { target: index + 1 < items.length ? items[index + 1]!.name : null, lastCursor: null } });
    void outcome;
  }
  await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, target: null, lastCursor: null } });
  console.log("Privacy retention completed. Only aggregate counters were recorded.");
}

async function main() {
  const backupHash = applyConfiguration();
  const items = retentionTargets();
  if (!backupHash) await dryRun(items); else await apply(items, backupHash);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Privacy retention failed safely."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
