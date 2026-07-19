import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { AiProvider } from "../ai/types";
import { logger } from "../logger";
import {
  DashboardAuthenticationError,
  DashboardConfigurationError,
  verifyDashboardAuthorization
} from "./auth";
import {
  DashboardItemNotFoundError,
  DashboardConflictError,
  DashboardUpstreamError,
  DashboardUnsupportedMediaError,
  DashboardValidationError,
  analyzeDashboardIdea,
  archiveDashboardIdea,
  archiveDashboardNote,
  archiveDashboardTask,
  convertDashboardIdeaToTask,
  createDashboardExpense,
  createDashboardIdea,
  createDashboardNote,
  createDashboardTask,
  deleteDashboardAccount,
  deleteDashboardExpense,
  deleteDashboardImage,
  disconnectDashboardIntegration,
  exportDashboardData,
  getDashboardSettings,
  listDashboardExpenses,
  listDashboardIdeas,
  listDashboardImages,
  listDashboardNotes,
  listDashboardTasks,
  loadDashboardImageContent,
  searchDashboard,
  syncDashboardExcelExpenses,
  updateDashboardExpense,
  updateDashboardIdea,
  updateDashboardImage,
  updateDashboardNote,
  updateDashboardSettings,
  updateDashboardTask,
  type DashboardSearchKind
} from "./data";
import {
  dashboardIdParamsSchema,
  capturePreviewSchema,
  deleteAccountSchema,
  expenseCreateSchema,
  expenseListQuerySchema,
  expenseUpdateSchema,
  ideaConvertSchema,
  ideaCreateSchema,
  ideaListQuerySchema,
  ideaUpdateSchema,
  imageUpdateSchema,
  imageListQuerySchema,
  integrationParamsSchema,
  noteCreateSchema,
  noteListQuerySchema,
  noteUpdateSchema,
  searchQuerySchema,
  settingsUpdateSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema
} from "./schemas";
import { DashboardUserNotFoundError, getDashboardSnapshot, type DashboardSnapshot } from "./snapshot";
import { previewDashboardCapture } from "./capture";
import { subscribeDashboardChanges } from "./realtime";
import {
  DashboardGroupAccessError,
  assertPersonalWorkspace,
  assertWorkspaceManager,
  listDashboardWorkspaces,
  resolveDashboardWorkspace,
  type DashboardWorkspaceScope
} from "./workspaces";

export type DashboardRouteActions = {
  listTasks: typeof listDashboardTasks;
  createTask: typeof createDashboardTask;
  updateTask: typeof updateDashboardTask;
  archiveTask: typeof archiveDashboardTask;
  listNotes: typeof listDashboardNotes;
  createNote: typeof createDashboardNote;
  updateNote: typeof updateDashboardNote;
  archiveNote: typeof archiveDashboardNote;
  listIdeas: typeof listDashboardIdeas;
  createIdea: typeof createDashboardIdea;
  updateIdea: typeof updateDashboardIdea;
  archiveIdea: typeof archiveDashboardIdea;
  analyzeIdea: typeof analyzeDashboardIdea;
  convertIdeaToTask: typeof convertDashboardIdeaToTask;
  listExpenses: typeof listDashboardExpenses;
  createExpense: typeof createDashboardExpense;
  updateExpense: typeof updateDashboardExpense;
  deleteExpense: typeof deleteDashboardExpense;
  listImages: typeof listDashboardImages;
  updateImage: typeof updateDashboardImage;
  deleteImage: typeof deleteDashboardImage;
  loadImageContent: typeof loadDashboardImageContent;
  getSettings: typeof getDashboardSettings;
  updateSettings: typeof updateDashboardSettings;
  search: typeof searchDashboard;
  disconnectIntegration: typeof disconnectDashboardIntegration;
  syncExcelExpenses: typeof syncDashboardExcelExpenses;
  exportData: typeof exportDashboardData;
  deleteAccount: typeof deleteDashboardAccount;
};

type DashboardRouteOptions = {
  publicKey?: string;
  telegramBotToken?: string;
  ai?: AiProvider;
  loadSnapshot?: (telegramId: string) => Promise<DashboardSnapshot>;
  actions?: Partial<DashboardRouteActions>;
};

const defaultActions: DashboardRouteActions = {
  listTasks: listDashboardTasks,
  createTask: createDashboardTask,
  updateTask: updateDashboardTask,
  archiveTask: archiveDashboardTask,
  listNotes: listDashboardNotes,
  createNote: createDashboardNote,
  updateNote: updateDashboardNote,
  archiveNote: archiveDashboardNote,
  listIdeas: listDashboardIdeas,
  createIdea: createDashboardIdea,
  updateIdea: updateDashboardIdea,
  archiveIdea: archiveDashboardIdea,
  analyzeIdea: analyzeDashboardIdea,
  convertIdeaToTask: convertDashboardIdeaToTask,
  listExpenses: listDashboardExpenses,
  createExpense: createDashboardExpense,
  updateExpense: updateDashboardExpense,
  deleteExpense: deleteDashboardExpense,
  listImages: listDashboardImages,
  updateImage: updateDashboardImage,
  deleteImage: deleteDashboardImage,
  loadImageContent: loadDashboardImageContent,
  getSettings: getDashboardSettings,
  updateSettings: updateDashboardSettings,
  search: searchDashboard,
  disconnectIntegration: disconnectDashboardIntegration,
  syncExcelExpenses: syncDashboardExcelExpenses,
  exportData: exportDashboardData,
  deleteAccount: deleteDashboardAccount
};

type RouteWork = (telegramId: string, scope: DashboardWorkspaceScope) => Promise<unknown>;

export function registerDashboardRoute(server: FastifyInstance, options: DashboardRouteOptions = {}): void {
  const loadSnapshot = options.loadSnapshot ?? getDashboardSnapshot;
  const actions = { ...defaultActions, ...options.actions };

  const run = async (request: FastifyRequest, reply: FastifyReply, work: RouteWork, operation: string) => {
    noStore(reply);
    try {
      const principal = await verifyDashboardAuthorization(request.headers.authorization, options.publicKey);
      const scope = await resolveDashboardWorkspace(
        principal.telegramId,
        dashboardWorkspaceHeader(request),
        options.telegramBotToken
      );
      return await work(scope.ownerTelegramId, scope);
    } catch (error) {
      return sendDashboardError(reply, error, operation);
    }
  };

  const loadScopedSnapshot: RouteWork = async (telegramId, scope) => ({
    ...await loadSnapshot(telegramId),
    workspace: scope.workspace
  });

  server.get("/api/v1/dashboard", async (request, reply) => run(request, reply, loadScopedSnapshot, "snapshot"));

  server.get("/api/v1/dashboard/snapshot", async (request, reply) => run(request, reply, loadScopedSnapshot, "snapshot"));

  server.get("/api/v1/dashboard/workspaces", async (request, reply) => {
    noStore(reply);
    try {
      const principal = await verifyDashboardAuthorization(request.headers.authorization, options.publicKey);
      return { workspaces: await listDashboardWorkspaces(principal.telegramId) };
    } catch (error) {
      return sendDashboardError(reply, error, "list_workspaces");
    }
  });

  server.get("/api/v1/dashboard/events", async (request, reply) => {
    noStore(reply);
    try {
      const principal = await verifyDashboardAuthorization(request.headers.authorization, options.publicKey);
      const scope = await resolveDashboardWorkspace(
        principal.telegramId,
        dashboardWorkspaceHeader(request),
        options.telegramBotToken
      );
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      reply.raw.write("retry: 2500\n\n");
      const unsubscribe = subscribeDashboardChanges(scope.ownerTelegramId, (event) => {
        if (!reply.raw.destroyed) reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(": threadwise heartbeat\n\n");
      }, 15_000);
      heartbeat.unref?.();
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      reply.raw.once("close", cleanup);
      reply.raw.once("error", cleanup);
      return reply;
    } catch (error) {
      return sendDashboardError(reply, error, "live_sync");
    }
  });

  server.post("/api/v1/dashboard/capture/preview", async (request, reply) => run(request, reply, async (telegramId) => {
    if (!options.ai) throw new DashboardConfigurationError("Dashboard capture intelligence is not configured.");
    return { preview: await previewDashboardCapture(telegramId, capturePreviewSchema.parse(request.body), options.ai) };
  }, "capture_preview"));

  server.get("/api/v1/dashboard/tasks", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = taskListQuerySchema.parse(request.query);
    return { tasks: await actions.listTasks(telegramId, query) };
  }, "list_tasks"));

  server.post("/api/v1/dashboard/tasks", async (request, reply) => run(request, reply, async (telegramId) => ({
    task: await actions.createTask(telegramId, taskCreateSchema.parse(request.body))
  }), "create_task"));

  server.patch("/api/v1/dashboard/tasks/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { task: await actions.updateTask(telegramId, id, taskUpdateSchema.parse(request.body)) };
  }, "update_task"));

  server.delete("/api/v1/dashboard/tasks/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await actions.archiveTask(telegramId, id);
    return { archived: true };
  }, "archive_task"));

  server.post("/api/v1/dashboard/notes", async (request, reply) => run(request, reply, async (telegramId) => ({
    note: await actions.createNote(telegramId, noteCreateSchema.parse(request.body))
  }), "create_note"));

  server.get("/api/v1/dashboard/notes", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = noteListQuerySchema.parse(request.query);
    return { notes: await actions.listNotes(telegramId, query) };
  }, "list_notes"));

  server.patch("/api/v1/dashboard/notes/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { note: await actions.updateNote(telegramId, id, noteUpdateSchema.parse(request.body)) };
  }, "update_note"));

  server.delete("/api/v1/dashboard/notes/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await actions.archiveNote(telegramId, id);
    return { archived: true };
  }, "archive_note"));

  server.post("/api/v1/dashboard/ideas", async (request, reply) => run(request, reply, async (telegramId) => ({
    idea: await actions.createIdea(telegramId, ideaCreateSchema.parse(request.body))
  }), "create_idea"));

  server.get("/api/v1/dashboard/ideas", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = ideaListQuerySchema.parse(request.query);
    return { ideas: await actions.listIdeas(telegramId, query) };
  }, "list_ideas"));

  server.patch("/api/v1/dashboard/ideas/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { idea: await actions.updateIdea(telegramId, id, ideaUpdateSchema.parse(request.body)) };
  }, "update_idea"));

  server.delete("/api/v1/dashboard/ideas/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await actions.archiveIdea(telegramId, id);
    return { archived: true };
  }, "archive_idea"));

  server.post("/api/v1/dashboard/ideas/:id/convert-to-task", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { task: await actions.convertIdeaToTask(telegramId, id, ideaConvertSchema.parse(request.body ?? {})) };
  }, "convert_idea"));

  server.post("/api/v1/dashboard/ideas/:id/analyze", async (request, reply) => run(request, reply, async (telegramId) => {
    if (!options.ai) throw new DashboardConfigurationError("Dashboard idea analysis is not configured.");
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return actions.analyzeIdea(telegramId, id, options.ai);
  }, "analyze_idea"));

  server.post("/api/v1/dashboard/expenses", async (request, reply) => run(request, reply, async (telegramId) => ({
    expense: await actions.createExpense(telegramId, expenseCreateSchema.parse(request.body))
  }), "create_expense"));

  server.get("/api/v1/dashboard/expenses", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = expenseListQuerySchema.parse(request.query);
    return { expenses: await actions.listExpenses(telegramId, query) };
  }, "list_expenses"));

  server.patch("/api/v1/dashboard/expenses/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { expense: await actions.updateExpense(telegramId, id, expenseUpdateSchema.parse(request.body)) };
  }, "update_expense"));

  server.delete("/api/v1/dashboard/expenses/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await actions.deleteExpense(telegramId, id);
    return { deleted: true };
  }, "delete_expense"));

  server.get("/api/v1/dashboard/images", async (request, reply) => run(request, reply, async (telegramId) => ({
    images: await actions.listImages(telegramId, imageListQuerySchema.parse(request.query))
  }), "list_images"));

  server.get("/api/v1/dashboard/images/:id/content", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const content = await actions.loadImageContent(telegramId, id, options.telegramBotToken);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header("Content-Disposition", `inline; filename="threadwise-image.${imageExtension(content.contentType)}"`);
    reply.type(content.contentType);
    return reply.send(Buffer.from(content.bytes));
  }, "load_image"));

  server.patch("/api/v1/dashboard/images/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { image: await actions.updateImage(telegramId, id, imageUpdateSchema.parse(request.body)) };
  }, "update_image"));

  server.delete("/api/v1/dashboard/images/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await actions.deleteImage(telegramId, id);
    return { deleted: true };
  }, "delete_image"));

  server.get("/api/v1/dashboard/search", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = searchQuerySchema.parse(request.query);
    const kinds = searchKinds(query.kinds);
    return { query: query.q, results: await actions.search(telegramId, query.q, kinds, query.limit) };
  }, "search"));

  server.get("/api/v1/dashboard/settings", async (request, reply) => run(request, reply, async (telegramId) => ({
    settings: await actions.getSettings(telegramId)
  }), "get_settings"));

  server.patch("/api/v1/dashboard/settings", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertWorkspaceManager(scope);
    return { settings: await actions.updateSettings(telegramId, settingsUpdateSchema.parse(request.body)) };
  }, "update_settings"));

  server.post("/api/v1/dashboard/integrations/:provider/disconnect", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { provider } = integrationParamsSchema.parse(request.params);
    return actions.disconnectIntegration(telegramId, provider);
  }, "disconnect_integration"));

  server.post("/api/v1/dashboard/integrations/excel/sync", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return actions.syncExcelExpenses(telegramId);
  }, "sync_excel_expenses"));

  server.get("/api/v1/dashboard/privacy/export", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    reply.header("Content-Disposition", 'attachment; filename="threadwise-export.json"');
    return actions.exportData(telegramId);
  }, "export_data"));

  server.delete("/api/v1/dashboard/privacy/account", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    deleteAccountSchema.parse(request.body);
    await actions.deleteAccount(telegramId);
    return { deleted: true };
  }, "delete_account"));
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "private, no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  reply.header("Vary", "Authorization");
}

function dashboardWorkspaceHeader(request: FastifyRequest): string | undefined {
  const value = request.headers["x-threadwise-workspace"];
  const workspace = Array.isArray(value) ? value[0] : value;
  return typeof workspace === "string" && workspace.trim() ? workspace.trim() : undefined;
}

function searchKinds(value: string | undefined): DashboardSearchKind[] {
  if (!value?.trim()) return [];
  const allowed = new Set<DashboardSearchKind>(["task", "note", "idea", "image", "expense"]);
  const kinds = [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (kinds.some((kind) => !allowed.has(kind as DashboardSearchKind))) {
    throw new DashboardValidationError("Unknown search kind.");
  }
  return kinds as DashboardSearchKind[];
}

function sendDashboardError(reply: FastifyReply, error: unknown, operation: string) {
  if (error instanceof DashboardAuthenticationError) {
    return reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="threadwise-dashboard", error="invalid_token"')
      .send({ error: "unauthorized" });
  }
  if (error instanceof DashboardGroupAccessError) {
    return reply.code(403).send({ error: "group_access_denied", message: error.message });
  }
  if (error instanceof DashboardConfigurationError) {
    logger.error("Dashboard API is not configured correctly.", { errorType: error.name });
    return reply.code(503).send({ error: "dashboard_api_unavailable" });
  }
  if (error instanceof DashboardUserNotFoundError || error instanceof DashboardItemNotFoundError) {
    return reply.code(404).send({ error: error instanceof DashboardUserNotFoundError ? "user_not_found" : "not_found" });
  }
  if (error instanceof DashboardConflictError) {
    return reply.code(409).send({ error: "revision_conflict", message: error.message });
  }
  if (error instanceof ZodError || error instanceof DashboardValidationError) {
    const message = error instanceof ZodError ? error.issues[0]?.message : error.message;
    return reply.code(400).send({ error: "invalid_request", ...(message ? { message } : {}) });
  }
  if (error instanceof DashboardUpstreamError) {
    return reply.code(502).send({ error: "image_unavailable" });
  }
  if (error instanceof DashboardUnsupportedMediaError) {
    return reply.code(415).send({ error: "unsupported_image_type" });
  }
  logger.error("Dashboard API request failed.", {
    operation,
    errorType: error instanceof Error ? error.name : "UnknownError"
  });
  return reply.code(500).send({ error: operation === "snapshot" ? "dashboard_snapshot_failed" : "dashboard_request_failed" });
}

function imageExtension(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  return contentType.slice("image/".length);
}
