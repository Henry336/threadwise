import Fastify from "fastify";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DASHBOARD_TOKEN_AUDIENCE, DASHBOARD_TOKEN_ISSUER } from "./auth";
import { registerDashboardRoute } from "./route";
import type { DashboardSnapshot } from "./snapshot";
import type { AiProvider } from "../ai/types";
import { DashboardRequestReplayError } from "../security/dashboardRequestReplay";
import { SharedRateLimitExceededError } from "../security/sharedRateLimit";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock("../security/dashboardRequestReplay", () => ({
  DashboardRequestReplayError: class DashboardRequestReplayError extends Error {},
  consumeDashboardMutationToken: vi.fn(async () => undefined),
}));

vi.mock("../security/sharedRateLimit", () => ({
  SharedRateLimitExceededError: class SharedRateLimitExceededError extends Error {
    constructor(readonly retryAfterSeconds: number) { super("Too many requests."); }
  },
  limitDashboardRequest: vi.fn(async () => undefined),
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
      excelAutoSync: false,
      overviewQuotes: [],
      morningBriefEnabled: false,
      morningBriefTime: "08:00",
      eveningDebriefEnabled: false,
      eveningDebriefTime: "21:00"
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

  it("creates, verifies, and revokes only the authenticated owner's browser session", async () => {
    const server = Fastify();
    const session = {
      id: "0c68a350-c061-4a86-a63f-842c132dc77d",
      expiresAt: new Date("2026-09-07T14:00:00.000Z"),
    };
    const createBrowserSession = vi.fn(async () => session);
    const requireActiveBrowserSession = vi.fn(async () => session);
    const revokeBrowserSession = vi.fn(async () => undefined);
    registerDashboardRoute(server, {
      publicKey: publicKeyPem,
      actions: { createBrowserSession, requireActiveBrowserSession, revokeBrowserSession },
    });
    const authorization = `Bearer ${await validToken()}`;

    const created = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/browser-sessions",
      headers: { authorization },
      payload: { ttlSeconds: 604_800 },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ session: { id: session.id, expiresAt: session.expiresAt.toISOString() } });
    expect(createBrowserSession).toHaveBeenCalledWith("123456789", 604_800);

    const checked = await server.inject({
      method: "GET",
      url: `/api/v1/dashboard/browser-sessions/${session.id}`,
      headers: { authorization },
    });
    expect(checked.statusCode).toBe(200);
    expect(requireActiveBrowserSession).toHaveBeenCalledWith("123456789", session.id);

    const revoked = await server.inject({
      method: "DELETE",
      url: `/api/v1/dashboard/browser-sessions/${session.id}`,
      headers: { authorization },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ revoked: true });
    expect(revokeBrowserSession).toHaveBeenCalledWith("123456789", session.id);
    await server.close();
  });

  it("keeps Personal rich-note drafts behind the signed owner and bounded route schemas", async () => {
    const server = Fastify();
    const getPersonalNoteDraft = vi.fn(async () => null);
    const savePersonalNoteDraft = vi.fn(async () => ({ id: "0c68a350-c061-4a86-a63f-842c132dc77d", revision: 1 }));
    const deletePersonalNoteDraft = vi.fn(async () => undefined);
    registerDashboardRoute(server, {
      publicKey: publicKeyPem,
      actions: { getPersonalNoteDraft, savePersonalNoteDraft, deletePersonalNoteDraft } as never,
    });
    const authorization = `Bearer ${await validToken()}`;

    const loaded = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard/note-drafts",
      headers: { authorization },
    });
    expect(loaded.statusCode).toBe(200);
    expect(getPersonalNoteDraft).toHaveBeenCalledWith("123456789", {});

    const saved = await server.inject({
      method: "PATCH",
      url: "/api/v1/dashboard/note-drafts",
      headers: { authorization },
      payload: { title: "Private draft", body: "Unfinished Markdown", expectedRevision: 0 },
    });
    expect(saved.statusCode).toBe(200);
    expect(savePersonalNoteDraft).toHaveBeenCalledWith("123456789", {
      title: "Private draft", body: "Unfinished Markdown", expectedRevision: 0,
    });

    const removed = await server.inject({
      method: "DELETE",
      url: "/api/v1/dashboard/note-drafts/0c68a350-c061-4a86-a63f-842c132dc77d",
      headers: { authorization },
    });
    expect(removed.statusCode).toBe(200);
    expect(deletePersonalNoteDraft).toHaveBeenCalledWith("123456789", "0c68a350-c061-4a86-a63f-842c132dc77d");
    await server.close();
  });

  it("keeps the Phase 1 Today API hidden from every non-owner principal", async () => {
    const server = Fastify();
    registerDashboardRoute(server, {
      publicKey: publicKeyPem,
      todayFoundationOwnerTelegramId: "999999999",
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard/today",
      headers: { authorization: `Bearer ${await validToken()}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    await server.close();
  });

  it("gates planned-day task mutations until the owner foundation is enabled", async () => {
    const createTask = vi.fn(async () => ({ id: "task-1" }));
    const blockedServer = Fastify();
    registerDashboardRoute(blockedServer, {
      publicKey: publicKeyPem,
      todayFoundationOwnerTelegramId: "999999999",
      actions: { createTask: createTask as never },
    });
    const request = {
      method: "POST" as const,
      url: "/api/v1/dashboard/tasks",
      headers: { authorization: `Bearer ${await validToken()}` },
      payload: { title: "Plan me", plannedFor: "2026-08-31" },
    };
    const blocked = await blockedServer.inject(request);
    expect(blocked.statusCode).toBe(404);
    expect(createTask).not.toHaveBeenCalled();
    await blockedServer.close();

    const ownerServer = Fastify();
    registerDashboardRoute(ownerServer, {
      publicKey: publicKeyPem,
      todayFoundationOwnerTelegramId: "123456789",
      actions: { createTask: createTask as never },
    });
    const accepted = await ownerServer.inject({
      ...request,
      headers: { authorization: `Bearer ${await validToken()}` },
    });
    expect(accepted.statusCode).toBe(200);
    expect(createTask).toHaveBeenCalledWith("123456789", { title: "Plan me", plannedFor: "2026-08-31" });
    await ownerServer.close();
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

  it("turns schema type errors into field-specific user guidance", async () => {
    const server = Fastify();
    const createTask = vi.fn();
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { createTask } });

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/tasks",
      headers: { authorization: `Bearer ${await validToken()}` },
      payload: { title: null },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_request",
      message: "Title has an invalid value. Clear it or enter a valid value, then try again.",
    });
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

  it("hydrates an exact task reference outside the paginated snapshot", async () => {
    const server = Fastify();
    const task = { id: "task-older", publicId: "TASK-OLDER", title: "Older task", status: "OPEN" };
    const getTask = vi.fn(async () => task);
    registerDashboardRoute(server, { publicKey: publicKeyPem, actions: { getTask: getTask as never } });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard/tasks/TASK-OLDER",
      headers: { authorization: `Bearer ${await validToken()}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task });
    expect(getTask).toHaveBeenCalledWith("123456789", "TASK-OLDER");
    await server.close();
  });

  it("rejects a replayed mutation before repeating its side effect", async () => {
    const server = Fastify();
    const createTask = vi.fn(async () => ({ id: "task-1" }));
    const consumed = new Set<string>();
    const requestReplayGuard = vi.fn(async (principal: { tokenId: string }, method: string) => {
      if (method !== "POST") return;
      if (consumed.has(principal.tokenId)) throw new DashboardRequestReplayError();
      consumed.add(principal.tokenId);
    });
    registerDashboardRoute(server, {
      publicKey: publicKeyPem,
      actions: { createTask: createTask as never },
      requestReplayGuard: requestReplayGuard as never,
    });
    const authorization = `Bearer ${await validToken()}`;

    const first = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/tasks",
      headers: { authorization },
      payload: { title: "Only once" },
    });
    const replay = await server.inject({
      method: "POST",
      url: "/api/v1/dashboard/tasks",
      headers: { authorization },
      payload: { title: "Only once" },
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ error: "request_replayed" });
    expect(createTask).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("returns a bounded retry response before running rate-limited work", async () => {
    const server = Fastify();
    const loadSnapshot = vi.fn(async () => snapshot);
    const requestRateLimiter = vi.fn(async () => {
      throw new SharedRateLimitExceededError(17);
    });
    registerDashboardRoute(server, { publicKey: publicKeyPem, loadSnapshot, requestRateLimiter });

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { authorization: `Bearer ${await validToken()}` },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("17");
    expect(response.json()).toMatchObject({ error: "rate_limited" });
    expect(loadSnapshot).not.toHaveBeenCalled();
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
