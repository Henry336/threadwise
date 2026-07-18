import { describe, expect, it } from "vitest";
import { runtimeDatabaseUrl } from "./connectionUrl";

describe("runtimeDatabaseUrl", () => {
  it("moves a Supabase session-pooler URL to bounded transaction mode", () => {
    const result = new URL(runtimeDatabaseUrl(
      "postgresql://postgres.project:secret@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"
    ));

    expect(result.port).toBe("6543");
    expect(result.searchParams.get("pgbouncer")).toBe("true");
    expect(result.searchParams.get("connection_limit")).toBe("3");
    expect(result.searchParams.get("pool_timeout")).toBe("30");
    expect(result.searchParams.get("sslmode")).toBe("require");
  });

  it("never raises an explicitly smaller connection limit", () => {
    const result = new URL(runtimeDatabaseUrl(
      "postgresql://user:secret@example.com:5432/threadwise?connection_limit=1&pool_timeout=45"
    ));

    expect(result.searchParams.get("connection_limit")).toBe("1");
    expect(result.searchParams.get("pool_timeout")).toBe("45");
  });

  it("can retain Supabase session mode while still bounding Prisma", () => {
    const result = new URL(runtimeDatabaseUrl(
      "postgresql://postgres.project:secret@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres",
      { connectionLimit: 2, supabasePoolMode: "session" }
    ));

    expect(result.port).toBe("5432");
    expect(result.searchParams.has("pgbouncer")).toBe(false);
    expect(result.searchParams.get("connection_limit")).toBe("2");
  });
});
