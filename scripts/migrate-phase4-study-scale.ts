import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/db/prisma";
import { deriveCanvasAnalysisExcerpt, deriveStudyResourceAnalysis, studyResourceWikiLookupKeys } from "../src/services/studyScale";

const APPLY = process.argv.includes("--apply");
const APPLY_ACKNOWLEDGEMENT = "apply-phase-4-study-scale";
const RUN_KIND = "phase4-study-scale-backfill-v1";
const BATCH_SIZE = 25;
const LEASE_MS = 5 * 60_000;

type ResourceRow = {
  id: string; updatedAt: Date; kind: Parameters<typeof deriveStudyResourceAnalysis>[0]["kind"];
  title: string; publicId: string; body: string | null; caption: string | null; ocrText: string | null;
};
type CanvasRow = { id: string; updatedAt: Date; extractedText: string | null };
type Row = ResourceRow | CanvasRow;
type Target = {
  name: string;
  count: () => Promise<number>;
  page: (after?: string) => Promise<Row[]>;
  rewrite: (row: Row) => Promise<boolean>;
};

function applyConfiguration(): string | undefined {
  if (!APPLY) return undefined;
  if (process.env.THREADWISE_PHASE4_STUDY_SCALE_ACK !== APPLY_ACKNOWLEDGEMENT) throw new Error("The Phase 4 apply acknowledgement is missing.");
  if (process.env.CONTENT_ENCRYPTION_MODE !== "write" || !process.env.CONTENT_ENCRYPTION_KEY) throw new Error("Content encryption write mode and key are required for Phase 4 apply.");
  const reference = process.env.THREADWISE_VERIFIED_BACKUP_REFERENCE?.trim();
  if (!reference || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/u.test(reference)) throw new Error("A safe verified-backup reference is required for Phase 4 apply.");
  return createHash("sha256").update(reference).digest("hex");
}

function targets(): Target[] {
  return [
    {
      name: "study-resources",
      count: () => prisma.studyResource.count(),
      page: (after) => prisma.studyResource.findMany({
        where: after ? { id: { gt: after } } : undefined,
        select: { id: true, updatedAt: true, kind: true, title: true, publicId: true, body: true, caption: true, ocrText: true },
        orderBy: { id: "asc" }, take: BATCH_SIZE,
      }),
      rewrite: (row) => {
        if (!("kind" in row)) throw new Error("Unexpected Canvas row in the Study-resource backfill.");
        return prisma.studyResource.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt },
          data: {
            ...deriveStudyResourceAnalysis(row),
            wikiLookupKeys: studyResourceWikiLookupKeys(row),
          },
        }).then(({ count }) => count === 1);
      },
    },
    {
      name: "canvas-materials",
      count: () => prisma.studyCanvasMaterial.count(),
      page: (after) => prisma.studyCanvasMaterial.findMany({
        where: after ? { id: { gt: after } } : undefined,
        select: { id: true, updatedAt: true, extractedText: true },
        orderBy: { id: "asc" }, take: BATCH_SIZE,
      }),
      rewrite: (row) => {
        if (!("extractedText" in row)) throw new Error("Unexpected Study-resource row in the Canvas backfill.");
        return prisma.studyCanvasMaterial.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt },
          data: { analysisExcerpt: deriveCanvasAnalysisExcerpt(row.extractedText), analysisExcerptReady: true },
        }).then(({ count }) => count === 1);
      },
    },
  ];
}

async function dryRun(items: Target[]) {
  const counts = [];
  for (const item of items) counts.push({ target: item.name, rows: await item.count() });
  console.table(counts);
  console.log("Dry run only. No maintenance row or Study content was changed.");
}

async function claimRun(backupReferenceHash: string, workerId: string) {
  const now = new Date();
  const completed = await prisma.privacyMaintenanceRun.findFirst({ where: { kind: RUN_KIND, status: "COMPLETED", backupReferenceHash } });
  if (completed) return { completed: true as const, run: completed };
  const existing = await prisma.privacyMaintenanceRun.findFirst({ where: { kind: RUN_KIND, status: "RUNNING" }, orderBy: { updatedAt: "desc" } });
  if (existing) {
    if (existing.backupReferenceHash !== backupReferenceHash) throw new Error("The running Phase 4 migration belongs to a different verified backup.");
    const claimed = await prisma.privacyMaintenanceRun.updateMany({
      where: { id: existing.id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }] },
      data: { leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), safeErrorCode: null },
    });
    if (claimed.count !== 1) throw new Error("Another Phase 4 migration worker holds the lease.");
    return { completed: false as const, run: await prisma.privacyMaintenanceRun.findUniqueOrThrow({ where: { id: existing.id } }) };
  }
  const run = await prisma.privacyMaintenanceRun.create({ data: { kind: RUN_KIND, status: "RUNNING", backupReferenceHash, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } });
  return { completed: false as const, run };
}

async function apply(items: Target[], backupReferenceHash: string) {
  const workerId = randomUUID();
  const claimed = await claimRun(backupReferenceHash, workerId);
  if (claimed.completed) {
    console.log("Phase 4 Study-scale backfill already completed for this verified backup reference.");
    return;
  }
  const run = claimed.run;
  const start = run.target ? Math.max(0, items.findIndex(({ name }) => name === run.target)) : 0;
  for (let index = start; index < items.length; index += 1) {
    const item = items[index]!;
    let cursor = run.target === item.name ? run.lastCursor ?? undefined : undefined;
    await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { target: item.name, lastCursor: cursor ?? null } });
    while (true) {
      const rows = await item.page(cursor);
      if (!rows.length) break;
      for (const row of rows) {
        if (!await item.rewrite(row)) {
          await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { conflictCount: { increment: 1 }, safeErrorCode: "CONCURRENT_CHANGE", leaseOwner: null, leaseExpiresAt: null } });
          throw new Error(`Concurrent change detected in ${item.name}; rerun after the live edit settles.`);
        }
        cursor = row.id;
        await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { lastCursor: cursor, processedCount: { increment: 1 }, changedCount: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
      }
    }
    await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { target: items[index + 1]?.name ?? null, lastCursor: null } });
  }
  await prisma.privacyMaintenanceRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), target: null, lastCursor: null, leaseOwner: null, leaseExpiresAt: null, safeErrorCode: null } });
  console.log("Phase 4 Study-scale backfill completed. Verify bounded payload aggregates before activation.");
}

async function main() {
  const backupHash = applyConfiguration();
  const items = targets();
  if (!backupHash) await dryRun(items); else await apply(items, backupHash);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Phase 4 migration failed safely."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
