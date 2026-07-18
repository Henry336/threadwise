import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl, type SupabaseRuntimePoolMode } from "./connectionUrl";

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
const connectionLimit = optionalPositiveInteger(process.env.DATABASE_CONNECTION_LIMIT);
const poolTimeoutSeconds = optionalPositiveInteger(process.env.DATABASE_POOL_TIMEOUT_SECONDS);
const configuredPoolMode = process.env.SUPABASE_RUNTIME_POOL_MODE;
const supabasePoolMode: SupabaseRuntimePoolMode =
  configuredPoolMode === "session" || configuredPoolMode === "transaction" ? configuredPoolMode : "auto";

const datasourceUrl = configuredDatabaseUrl
  ? runtimeDatabaseUrl(configuredDatabaseUrl, {
      connectionLimit,
      poolTimeoutSeconds,
      supabasePoolMode
    })
  : undefined;

export const prisma = new PrismaClient({
  ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

