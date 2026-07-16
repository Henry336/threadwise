import Fastify from "fastify";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DASHBOARD_TOKEN_AUDIENCE, DASHBOARD_TOKEN_ISSUER } from "./auth";
import { registerDashboardRoute } from "./route";
import type { DashboardSnapshot } from "./snapshot";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe("GET /api/v1/dashboard", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let publicKeyPem: string;

  const snapshot = {
    user: {
      telegramId: "123456789",
      firstName: "Henry",
      fullName: "Henry",
      timezone: "Asia/Singapore",
      accent: "iris"
    },
    generatedAt: "2026-07-16T10:00:00.000Z",
    tasks: [],
    notes: [],
    ideas: [],
    expenses: [],
    activity: [],
    integrations: []
  } satisfies DashboardSnapshot;

  beforeAll(async () => {
    const keyPair = await generateKeyPair("EdDSA");
    privateKey = keyPair.privateKey;
    publicKeyPem = await exportSPKI(keyPair.publicKey);
  });

  async function validToken() {
    return new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer(DASHBOARD_TOKEN_ISSUER)
      .setAudience(DASHBOARD_TOKEN_AUDIENCE)
      .setSubject("123456789")
      .setIssuedAt()
      .setExpirationTime("60s")
      .setJti("route-test")
      .sign(privateKey);
  }

  it("returns only the authenticated user's snapshot with non-cacheable headers", async () => {
    const server = Fastify();
    const loadSnapshot = vi.fn(async () => snapshot);
    registerDashboardRoute(server, { publicKey: publicKeyPem, loadSnapshot });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { authorization: `Bearer ${await validToken()}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot);
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(loadSnapshot).toHaveBeenCalledWith("123456789");
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers.vary).toBe("Authorization");
    await server.close();
  });

  it("returns a generic 401 and never queries data for an invalid token", async () => {
    const server = Fastify();
    const loadSnapshot = vi.fn(async () => snapshot);
    registerDashboardRoute(server, { publicKey: publicKeyPem, loadSnapshot });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { authorization: "Bearer invalid" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers["www-authenticate"]).toContain("invalid_token");
    expect(loadSnapshot).not.toHaveBeenCalled();
    await server.close();
  });

  it("fails closed when the dashboard public key is not configured", async () => {
    const server = Fastify();
    const loadSnapshot = vi.fn(async () => snapshot);
    registerDashboardRoute(server, { loadSnapshot });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { authorization: `Bearer ${await validToken()}` }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "dashboard_api_unavailable" });
    expect(loadSnapshot).not.toHaveBeenCalled();
    await server.close();
  });
});
