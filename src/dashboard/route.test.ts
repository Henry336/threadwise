import Fastify from "fastify";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DASHBOARD_TOKEN_AUDIENCE, DASHBOARD_TOKEN_ISSUER } from "./auth";
import { registerDashboardRoute } from "./route";
import type { DashboardSnapshot } from "./snapshot";
import type { AiProvider } from "../ai/types";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe("dashboard API routes", () => {
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
    images: [],
    settings: {
      timezone: "Asia/Singapore",
      reminderIntervalMinutes: 180,
      maxRemindersPerDay: 200,
      dueNudgeMinutes: 3,
      reminderMode: "INDIVIDUAL",
      expenseCurrency: "SGD",
      ocrLanguages: "eng",
      directNudgesEnabled: false,
      calendarAutoSync: false,
      excelAutoSync: false
    },
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
    expect(response.json()).toEqual({
      ...snapshot,
      workspace: { id: "personal", kind: "PERSONAL", name: "Personal", role: "OWNER" }
    });
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

  it("derives list ownership solely from the signed subject and parses bounded pagination", async () => {
    const server = Fastify();
    const listTasks = vi.fn(async () => ({ items: [], page: 2, limit: 25, total: 0, totalPages: 1, hasMore: false }));
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { listTasks } });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard/tasks?page=2&limit=25&q=bank&status=DONE",
      headers: { authorization: `Bearer ${await validToken()}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tasks: { items: [], page: 2, limit: 25, total: 0, totalPages: 1, hasMore: false } });
    expect(listTasks).toHaveBeenCalledWith("123456789", { page: 2, limit: 25, q: "bank", status: "DONE" });
    await server.close();
  });

  it("rejects client-supplied ownership fields instead of trusting them", async () => {
    const server = Fastify();
    const createTask = vi.fn();
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { createTask } });

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/tasks",
      headers: { authorization: `Bearer ${await validToken()}` },
      payload: { title: "Private task", userId: "someone-else" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
    expect(createTask).not.toHaveBeenCalled();
    await server.close();
  });

  it("enforces the canonical 15-minute reminder floor for dashboard mutations", async () => {
    const server = Fastify();
    const createTask = vi.fn(async () => ({ id: "task-1" }));
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { createTask: createTask as never } });
    const authorization = `Bearer ${await validToken()}`;

    const rejected = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/tasks",
      headers: { authorization },
      payload: { title: "Too frequent", reminderIntervalMinutes: 1 }
    });
    expect(rejected.statusCode).toBe(400);
    expect(createTask).not.toHaveBeenCalled();

    const accepted = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/tasks",
      headers: { authorization },
      payload: { title: "Reasonable cadence", reminderIntervalMinutes: 15 }
    });
    expect(accepted.statusCode).toBe(200);
    expect(createTask).toHaveBeenCalledWith("123456789", { title: "Reasonable cadence", reminderIntervalMinutes: 15 });
    await server.close();
  });

  it("derives Excel sync ownership solely from the signed Telegram subject", async () => {
    const server = Fastify();
    const syncExcelExpenses = vi.fn(async () => ({ provider: "excel" as const, synced: 4 }));
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { syncExcelExpenses } });

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/integrations/excel/sync",
      headers: { authorization: `Bearer ${await validToken()}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: "excel", synced: 4 });
    expect(syncExcelExpenses).toHaveBeenCalledWith("123456789");
    await server.close();
  });

  it("starts Calendar OAuth for the signed owner and preserves the selected task", async () => {
    const server = Fastify();
    const connectIntegration = vi.fn(async () => ({ provider: "calendar" as const, url: "https://accounts.google.com/o/oauth2/v2/auth?state=safe" }));
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { connectIntegration } });

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/integrations/calendar/connect",
      headers: { authorization: `Bearer ${await validToken()}` },
      payload: { taskId: "task-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: "calendar", url: expect.stringContaining("accounts.google.com") });
    expect(connectIntegration).toHaveBeenCalledWith("123456789", "calendar", { taskId: "task-1" });
    await server.close();
  });

  it("requires the exact destructive confirmation phrase before deleting an account", async () => {
    const server = Fastify();
    const deleteAccount = vi.fn(async () => undefined);
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { deleteAccount } });
    const authorization = `Bearer ${await validToken()}`;

    const rejected = await server.inject({
      method: "DELETE",
      url: "/api/v1/dashboard/privacy/account",
      headers: { authorization },
      payload: { confirmation: "delete" }
    });
    expect(rejected.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();

    const accepted = await server.inject({
      method: "DELETE",
      url: "/api/v1/dashboard/privacy/account",
      headers: { authorization },
      payload: { confirmation: "DELETE MY THREADWISE DATA" }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ deleted: true });
    expect(deleteAccount).toHaveBeenCalledWith("123456789");
    await server.close();
  });

  it("serves authenticated raster bytes with defensive browser headers", async () => {
    const server = Fastify();
    const loadImageContent = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }));
    registerDashboardRoute(server, {
      publicKey: publicKeyPem,
      telegramBotToken: "secret-token",
      actions: { loadImageContent }
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard/images/IMG-1/content",
      headers: { authorization: `Bearer ${await validToken()}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["content-disposition"]).toContain("inline");
    expect(loadImageContent).toHaveBeenCalledWith("123456789", "IMG-1", "secret-token");
    await server.close();
  });

  it("runs idea analysis with the configured server-side AI and signed Telegram owner", async () => {
    const server = Fastify();
    const ai = { scoreIdea: vi.fn() } as unknown as AiProvider;
    const result = {
      idea: { id: "idea-1", publicId: "IDEA-1", title: "A useful idea" },
      brief: { buildability: 8, usefulness: 9 }
    };
    const analyzeIdea = vi.fn(async () => result);
    registerDashboardRoute(server, {
      publicKey: publicKeyPem,
      ai,
      actions: { analyzeIdea: analyzeIdea as never }
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/ideas/IDEA-1/analyze",
      headers: { authorization: `Bearer ${await validToken()}` },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(analyzeIdea).toHaveBeenCalledWith("123456789", "IDEA-1", ai);
    await server.close();
  });

  it("does not run mutations without a valid bearer token", async () => {
    const server = Fastify();
    const archiveTask = vi.fn();
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { archiveTask } });
    const response = await server.inject({ method: "DELETE", url: "/api/v1/dashboard/tasks/TASK-1" });
    expect(response.statusCode).toBe(401);
    expect(archiveTask).not.toHaveBeenCalled();
    await server.close();
  });
});
