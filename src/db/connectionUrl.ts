export type SupabaseRuntimePoolMode = "auto" | "session" | "transaction";

export type RuntimeDatabaseUrlOptions = {
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
  supabasePoolMode?: SupabaseRuntimePoolMode;
};

const DEFAULT_CONNECTION_LIMIT = 3;
const DEFAULT_POOL_TIMEOUT_SECONDS = 30;

export function runtimeDatabaseUrl(rawUrl: string, options: RuntimeDatabaseUrlOptions = {}): string {
  const url = new URL(rawUrl);
  const connectionLimit = positiveInteger(options.connectionLimit, DEFAULT_CONNECTION_LIMIT);
  const poolTimeoutSeconds = positiveInteger(options.poolTimeoutSeconds, DEFAULT_POOL_TIMEOUT_SECONDS);
  const supabasePoolMode = options.supabasePoolMode ?? "auto";

  if (isSupabaseSharedPooler(url) && supabasePoolMode !== "session") {
    // Supavisor transaction mode shares database connections instead of
    // reserving one underlying connection for every long-lived client.
    url.port = "6543";
    url.searchParams.set("pgbouncer", "true");
  }

  const existingLimit = positiveInteger(Number(url.searchParams.get("connection_limit")), connectionLimit);
  url.searchParams.set("connection_limit", String(Math.min(existingLimit, connectionLimit)));

  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", String(poolTimeoutSeconds));
  }

  return url.toString();
}

function isSupabaseSharedPooler(url: URL): boolean {
  return url.hostname.endsWith(".pooler.supabase.com") && (url.port === "5432" || url.port === "6543");
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
