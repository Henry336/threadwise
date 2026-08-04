import { describe, expect, it, vi } from "vitest";
import { parseTrustedDeployTargets, verifyTrustedDeployment } from "./trustedDeployment";

describe("trusted deployment broker", () => {
  it("accepts only explicit HTTPS health targets", () => {
    expect(parseTrustedDeployTargets(JSON.stringify({
      threadwise: {
        provider: "render",
        healthUrl: "https://threadwise.example/health",
        expectedService: "threadwise"
      },
      unsafe: { provider: "render", healthUrl: "http://localhost:3000/health" }
    }))).toEqual({
      threadwise: {
        provider: "render",
        healthUrl: "https://threadwise.example/health",
        expectedService: "threadwise"
      }
    });
  });

  it("verifies the merged commit without exposing provider credentials", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      service: "threadwise",
      commit: "abcdef123456"
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await verifyTrustedDeployment({
      alias: "threadwise",
      mergeCommitSha: "abcdef1234567890",
      targets: {
        threadwise: {
          provider: "render",
          healthUrl: "https://threadwise.example/health",
          expectedService: "threadwise"
        }
      },
      timeoutMs: 1_000,
      pollMs: 1,
      fetcher: fetcher as typeof fetch
    });
    expect(result.status).toBe("VERIFIED");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("blocks an unconfigured project", async () => {
    await expect(verifyTrustedDeployment({
      alias: "unknown",
      mergeCommitSha: "abcdef1234567890",
      targets: {}
    })).resolves.toMatchObject({ status: "BLOCKED", target: "unknown" });
  });
});
