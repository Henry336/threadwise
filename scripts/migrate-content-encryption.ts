import { prisma } from "../src/db/prisma";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 100;

type MigrationTarget = {
  name: string;
  count: () => Promise<number>;
  page: (cursor?: string) => Promise<Array<{ id: string } & Record<string, unknown>>>;
  rewrite: (row: { id: string } & Record<string, unknown>) => Promise<void>;
};

async function main() {
  if (APPLY && process.env.CONTENT_ENCRYPTION_MODE !== "write") {
    throw new Error("Set CONTENT_ENCRYPTION_MODE=write before running with --apply.");
  }
  if (APPLY && !process.env.CONTENT_ENCRYPTION_KEY) {
    throw new Error("Set CONTENT_ENCRYPTION_KEY before running with --apply.");
  }

  const targets: MigrationTarget[] = [
    target("tasks", () => prisma.task.count(), (cursor) => prisma.task.findMany({
      select: { id: true, title: true, description: true, sourceText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.task.update({ where: { id: row.id }, data: { title: row.title as string, description: row.description as string | null, sourceText: row.sourceText as string, searchTokens: [] } }).then(() => undefined)),
    target("notes", () => prisma.note.count(), (cursor) => prisma.note.findMany({
      select: { id: true, title: true, body: true, summary: true, sourceText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.note.update({ where: { id: row.id }, data: { title: row.title as string, body: row.body as string, summary: row.summary as string, sourceText: row.sourceText as string, searchTokens: [] } }).then(() => undefined)),
    target("ideas", () => prisma.idea.count(), (cursor) => prisma.idea.findMany({
      select: { id: true, title: true, concept: true, problem: true, targetUser: true, sourceText: true, marketNotes: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.idea.update({ where: { id: row.id }, data: { title: row.title as string, concept: row.concept as string, problem: row.problem as string | null, targetUser: row.targetUser as string | null, sourceText: row.sourceText as string, marketNotes: row.marketNotes as string | null, searchTokens: [] } }).then(() => undefined)),
    target("stored images", () => prisma.storedImage.count(), (cursor) => prisma.storedImage.findMany({
      select: { id: true, fileName: true, caption: true, ocrText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.storedImage.update({ where: { id: row.id }, data: { fileName: row.fileName as string | null, caption: row.caption as string | null, ocrText: row.ocrText as string | null, searchTokens: [] } }).then(() => undefined)),
    target("study resources", () => prisma.studyResource.count(), (cursor) => prisma.studyResource.findMany({
      select: { id: true, title: true, body: true, url: true, fileName: true, caption: true, ocrText: true }, orderBy: { id: "asc" }, take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }), (row) => prisma.studyResource.update({ where: { id: row.id }, data: { title: row.title as string, body: row.body as string | null, url: row.url as string | null, fileName: row.fileName as string | null, caption: row.caption as string | null, ocrText: row.ocrText as string | null, searchTokens: [] } }).then(() => undefined)),
  ];

  const counts = await Promise.all(targets.map(async (item) => ({ name: item.name, count: await item.count() })));
  console.table(counts);
  if (!APPLY) {
    console.log("Dry run only. Back up the database, set CONTENT_ENCRYPTION_MODE=write and rerun with --apply.");
    return;
  }

  for (const item of targets) {
    let cursor: string | undefined;
    let processed = 0;
    while (true) {
      const rows = await item.page(cursor);
      if (!rows.length) break;
      for (const row of rows) await item.rewrite(row);
      cursor = rows.at(-1)!.id;
      processed += rows.length;
      console.log(`${item.name}: ${processed}`);
    }
  }
  console.log("Content encryption migration complete. Keep the key in Render secrets and retain the backup.");
}

function target(
  name: string,
  count: MigrationTarget["count"],
  page: MigrationTarget["page"],
  rewrite: MigrationTarget["rewrite"],
): MigrationTarget {
  return { name, count, page, rewrite };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
