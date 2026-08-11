import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl, type SupabaseRuntimePoolMode } from "./connectionUrl";
import { contentCipherFromEnvironment, decryptContentTree, prepareContentWrite } from "../security/contentEncryption";

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

const basePrisma = new PrismaClient({
  ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});

const contentCipher = contentCipherFromEnvironment();

const protectedPrisma = basePrisma.$extends({
  name: "threadwise-content-encryption",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const protectedArgs = prepareContentWrite(model, operation, args, contentCipher) as typeof args;
        const result = await query(protectedArgs);
        return decryptContentTree(result, contentCipher);
      }
    }
  }
});

// Keep the public client type compatible with existing service seams. Query
// extensions are still applied at runtime, including inside transactions.
export const prisma = protectedPrisma as unknown as PrismaClient;

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

