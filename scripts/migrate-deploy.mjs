import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const runtimeUrl = process.env.DATABASE_URL?.trim();
const configuredUrl = process.env.DIRECT_URL?.trim() || runtimeUrl;

if (!configuredUrl) {
  console.error("DATABASE_URL is required. Set DIRECT_URL as well when runtime traffic uses transaction pooling.");
  process.exit(1);
}

const migrationUrl = new URL(configuredUrl);
const isSupabaseTransactionPooler =
  migrationUrl.hostname.endsWith(".pooler.supabase.com") && migrationUrl.port === "6543";

if (isSupabaseTransactionPooler) {
  console.error(
    "Prisma migrations must not use the Supabase transaction pooler on port 6543. " +
    "Set DIRECT_URL to the direct or session-pooler connection on port 5432."
  );
  process.exit(1);
}

if (runtimeUrl && await allLocalMigrationsAreApplied(runtimeUrl)) {
  console.log("All checked-in Prisma migrations are already applied; no migration session is needed.");
  process.exit(0);
}

migrationUrl.searchParams.set("connection_limit", "1");
if (!migrationUrl.searchParams.has("pool_timeout")) {
  migrationUrl.searchParams.set("pool_timeout", "60");
}

const prismaExecutable = path.resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma"
);

console.log(
  `Running Prisma migrations through ${process.env.DIRECT_URL?.trim() ? "DIRECT_URL" : "DATABASE_URL"} ` +
  `(${migrationUrl.hostname}:${migrationUrl.port || "5432"}; credentials hidden).`
);

const result = spawnSync(prismaExecutable, ["migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: migrationUrl.toString() },
  shell: process.platform === "win32",
  stdio: "inherit"
});

if (result.error) {
  console.error(`Unable to start Prisma migrate: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

async function allLocalMigrationsAreApplied(databaseUrl) {
  const statusUrl = new URL(databaseUrl);

  if (statusUrl.hostname.endsWith(".pooler.supabase.com")) {
    statusUrl.port = "6543";
    statusUrl.searchParams.set("pgbouncer", "true");
  }

  statusUrl.searchParams.set("connection_limit", "1");
  statusUrl.searchParams.set("pool_timeout", "10");

  const statusClient = new PrismaClient({
    datasources: { db: { url: statusUrl.toString() } },
    log: ["error"]
  });

  try {
    const databaseMigrations = await statusClient.$queryRawUnsafe(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"'
    );
    const unfinishedMigration = databaseMigrations.some(
      (migration) => migration.finished_at === null && migration.rolled_back_at === null
    );

    if (unfinishedMigration) return false;

    const appliedMigrations = new Map(
      databaseMigrations
        .filter((migration) => migration.finished_at !== null && migration.rolled_back_at === null)
        .map((migration) => [migration.migration_name, migration.checksum])
    );
    const localMigrations = readdirSync(path.resolve("prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        checksum: createHash("sha256")
          .update(readFileSync(path.resolve("prisma", "migrations", entry.name, "migration.sql")))
          .digest("hex")
      }));

    return localMigrations.length > 0 && localMigrations.every(
      (migration) => appliedMigrations.get(migration.name) === migration.checksum
    );
  } catch {
    console.warn("Could not verify migration status through the runtime pool; continuing with Prisma migrate.");
    return false;
  } finally {
    await statusClient.$disconnect();
  }
}
