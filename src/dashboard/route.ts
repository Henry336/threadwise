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
  createDashboardExcelWorkbook,
  createDashboardIdea,
  createDashboardIntegrationConnectUrl,
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
  syncDashboardCalendarTasks,
  updateDashboardExpense,
  updateDashboardIdea,
  updateDashboardImage,
  updateDashboardNote,
  updateDashboardSettings,
  updateDashboardTask,
  updateDashboardTaskCalendar,
  type DashboardSearchKind
} from "./data";
import {
  dashboardIdParamsSchema,
  capturePreviewSchema,
  calendarTaskIntegrationSchema,
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
  integrationConnectSchema,
  integrationParamsSchema,
  noteCreateSchema,
  noteListQuerySchema,
  noteUpdateSchema,
  searchQuerySchema,
  settingsUpdateSchema,
  taskCreateSchema,
  taskCollaborationSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  availabilityPollCreateSchema,
  availabilityResponseSchema,
  availabilityFinalizeSchema,
  availabilityCloseSchema,
  availabilityCalendarSchema,
} from "./schemas";
import { DashboardUserNotFoundError, getDashboardSnapshot, type DashboardSnapshot } from "./snapshot";
import { previewDashboardCapture } from "./capture";
import { subscribeDashboardChanges } from "./realtime";
import { getDashboardGroupCollaboration, recordDashboardTaskMutation, updateDashboardTaskCollaboration } from "./collaboration";
import {
  DashboardGroupAccessError,
  assertPersonalWorkspace,
  assertWorkspaceManager,
  listDashboardWorkspaces,
  resolveDashboardWorkspace,
  type DashboardWorkspaceScope
} from "./workspaces";
import {
  GroupSchedulingError,
  cancelAvailabilityPoll,
  createAvailabilityPoll,
  finalizeAvailabilityPoll,
  getAvailabilityPoll,
  listAvailabilityPolls,
  prepareAvailabilityReminder,
  releaseAvailabilityReminderReservation,
  resolveSchedulingActor,
  submitAvailability,
  updateAvailabilityCalendar,
  type SchedulingScope,
} from "../services/groupScheduling";
import {
  publishAvailabilityPollCardWithToken,
  refreshAvailabilityPollCardWithToken,
  sendAvailabilityReminderWithToken,
} from "../bot/scheduling";

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
  connectIntegration: typeof createDashboardIntegrationConnectUrl;
  syncCalendarTasks: typeof syncDashboardCalendarTasks;
  updateTaskCalendar: typeof updateDashboardTaskCalendar;
  createExcelWorkbook: typeof createDashboardExcelWorkbook;
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
  connectIntegration: createDashboardIntegrationConnectUrl,
  syncCalendarTasks: syncDashboardCalendarTasks,
  updateTaskCalendar: updateDashboardTaskCalendar,
  createExcelWorkbook: createDashboardExcelWorkbook,
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

  const loadScopedSnapshot: RouteWork = async (telegramId, scope) => {
    const [snapshot, collaboration, scheduling] = await Promise.all([
      loadSnapshot(telegramId),
      getDashboardGroupCollaboration(scope),
      scope.workspace.kind === "GROUP" ? listAvailabilityPolls(schedulingScope(scope)) : Promise.resolve(undefined),
    ]);
    return {
      ...snapshot,
      ...(scope.workspace.kind === "GROUP" ? { expenses: [], integrations: [] } : {}),
      workspace: scope.workspace,
      ...(collaboration ? { collaboration } : {}),
      ...(scheduling ? { scheduling: { polls: scheduling } } : {}),
    };
  };

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

  server.get("/api/v1/dashboard/scheduling/polls", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    return { polls: await listAvailabilityPolls(schedulingScope(scope)) };
  }, "list_availability_polls"));

  server.get("/api/v1/dashboard/scheduling/polls/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { poll: await getAvailabilityPoll(schedulingScope(scope), id) };
  }, "get_availability_poll"));

  server.post("/api/v1/dashboard/scheduling/polls", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    await assertWorkspaceManager(scope, options.telegramBotToken);
    const scheduleScope = schedulingScope(scope);
    const poll = await createAvailabilityPoll(scheduleScope, await resolveSchedulingActor(scheduleScope), availabilityPollCreateSchema.parse(request.body));
    await bestEffortScheduleNotification("publish", options.telegramBotToken, scheduleScope, poll);
    return { poll };
  }, "create_availability_poll"));

  server.patch("/api/v1/dashboard/scheduling/polls/:id/availability", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const scheduleScope = schedulingScope(scope);
    const poll = await submitAvailability(scheduleScope, id, availabilityResponseSchema.parse(request.body));
    await bestEffortScheduleNotification("refresh", options.telegramBotToken, scheduleScope, poll);
    return { poll };
  }, "submit_availability"));

  server.post("/api/v1/dashboard/scheduling/polls/:id/finalize", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    await assertWorkspaceManager(scope, options.telegramBotToken);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const input = availabilityFinalizeSchema.parse(request.body);
    const scheduleScope = schedulingScope(scope);
    const poll = await finalizeAvailabilityPoll(scheduleScope, await resolveSchedulingActor(scheduleScope), id, input.startAt, input.expectedRevision);
    await bestEffortScheduleNotification("refresh", options.telegramBotToken, scheduleScope, poll);
    return { poll };
  }, "finalize_availability_poll"));

  server.post("/api/v1/dashboard/scheduling/polls/:id/remind", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    await assertWorkspaceManager(scope, options.telegramBotToken);
    if (!options.telegramBotToken) throw new DashboardConfigurationError("Telegram delivery is temporarily unavailable.");
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const scheduleScope = schedulingScope(scope);
    const result = await prepareAvailabilityReminder(scheduleScope, id);
    if (result.pendingMembers.length > 0) {
      try {
        await sendAvailabilityReminderWithToken(options.telegramBotToken, scheduleScope, result.poll, result.pendingMembers);
      } catch (error) {
        await releaseAvailabilityReminderReservation(scheduleScope, result.poll.id, result.reservationAt);
        throw error;
      }
      await bestEffortScheduleNotification("refresh", options.telegramBotToken, scheduleScope, result.poll);
    }
    return result;
  }, "remind_availability_poll"));

  server.post("/api/v1/dashboard/scheduling/polls/:id/cancel", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    await assertWorkspaceManager(scope, options.telegramBotToken);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const input = availabilityCloseSchema.parse(request.body);
    const scheduleScope = schedulingScope(scope);
    const poll = await cancelAvailabilityPoll(scheduleScope, await resolveSchedulingActor(scheduleScope), id, input.expectedRevision);
    await bestEffortScheduleNotification("refresh", options.telegramBotToken, scheduleScope, poll);
    return { poll };
  }, "cancel_availability_poll"));

  server.post("/api/v1/dashboard/scheduling/polls/:id/calendar", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const input = availabilityCalendarSchema.parse(request.body);
    const scheduleScope = schedulingScope(scope);
    const poll = await updateAvailabilityCalendar(scheduleScope, id, input.action);
    await bestEffortScheduleNotification("refresh", options.telegramBotToken, scheduleScope, poll);
    return { poll };
  }, "update_availability_calendar"));

  server.post("/api/v1/dashboard/capture/preview", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    if (!options.ai) throw new DashboardConfigurationError("Dashboard capture intelligence is not configured.");
    const preview = await previewDashboardCapture(telegramId, capturePreviewSchema.parse(request.body), options.ai);
    if (scope.workspace.kind === "GROUP" && preview.kind === "expense") {
      throw new DashboardGroupAccessError("Expenses stay in personal Threadwise workspaces. Switch to Personal to capture this expense.");
    }
    return { preview };
  }, "capture_preview"));

  server.get("/api/v1/dashboard/tasks", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = taskListQuerySchema.parse(request.query);
    return { tasks: await actions.listTasks(telegramId, query) };
  }, "list_tasks"));

  server.post("/api/v1/dashboard/tasks", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const task = await actions.createTask(telegramId, taskCreateSchema.parse(request.body));
    await recordDashboardTaskMutation(scope, task, { kind: "created" }, options.telegramBotToken);
    return { task };
  }, "create_task"));

  server.patch("/api/v1/dashboard/tasks/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const input = taskUpdateSchema.parse(request.body);
    const task = await actions.updateTask(telegramId, id, input);
    await recordDashboardTaskMutation(scope, task, { kind: "updated", input }, options.telegramBotToken);
    return { task };
  }, "update_task"));

  server.post("/api/v1/dashboard/tasks/:id/collaboration", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return updateDashboardTaskCollaboration(
      scope,
      id,
      taskCollaborationSchema.parse(request.body),
      options.telegramBotToken,
    );
  }, "update_task_collaboration"));

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

  server.post("/api/v1/dashboard/expenses", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return { expense: await actions.createExpense(telegramId, expenseCreateSchema.parse(request.body)) };
  }, "create_expense"));

  server.get("/api/v1/dashboard/expenses", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const query = expenseListQuerySchema.parse(request.query);
    return { expenses: await actions.listExpenses(telegramId, query) };
  }, "list_expenses"));

  server.patch("/api/v1/dashboard/expenses/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { expense: await actions.updateExpense(telegramId, id, expenseUpdateSchema.parse(request.body)) };
  }, "update_expense"));

  server.delete("/api/v1/dashboard/expenses/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
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

  server.get("/api/v1/dashboard/search", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const query = searchQuerySchema.parse(request.query);
    let kinds = searchKinds(query.kinds);
    if (scope.workspace.kind === "GROUP") {
      if (kinds.includes("expense")) throw new DashboardGroupAccessError("Expenses are available only in personal workspaces.");
      if (kinds.length === 0) kinds = ["task", "note", "idea", "image"];
    }
    return { query: query.q, results: await actions.search(telegramId, query.q, kinds, query.limit) };
  }, "search"));

  server.get("/api/v1/dashboard/settings", async (request, reply) => run(request, reply, async (telegramId) => ({
    settings: await actions.getSettings(telegramId)
  }), "get_settings"));

  server.patch("/api/v1/dashboard/settings", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    await assertWorkspaceManager(scope, options.telegramBotToken);
    return { settings: await actions.updateSettings(telegramId, settingsUpdateSchema.parse(request.body)) };
  }, "update_settings"));

  server.post("/api/v1/dashboard/integrations/:provider/disconnect", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { provider } = integrationParamsSchema.parse(request.params);
    return actions.disconnectIntegration(telegramId, provider);
  }, "disconnect_integration"));

  server.post("/api/v1/dashboard/integrations/:provider/connect", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { provider } = integrationParamsSchema.parse(request.params);
    return actions.connectIntegration(telegramId, provider, integrationConnectSchema.parse(request.body ?? {}));
  }, "connect_integration"));

  server.post("/api/v1/dashboard/integrations/calendar/sync", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return actions.syncCalendarTasks(telegramId);
  }, "sync_calendar_tasks"));

  server.post("/api/v1/dashboard/integrations/calendar/task", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const input = calendarTaskIntegrationSchema.parse(request.body);
    return actions.updateTaskCalendar(telegramId, input.taskId, input.action);
  }, "update_task_calendar"));

  server.post("/api/v1/dashboard/integrations/excel/workbook", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return actions.createExcelWorkbook(telegramId);
  }, "create_excel_workbook"));

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

function schedulingScope(scope: DashboardWorkspaceScope): SchedulingScope {
  if (scope.workspace.kind !== "GROUP" || !scope.telegramChatId) {
    throw new DashboardGroupAccessError("Find a time is available in shared group workspaces.");
  }
  return {
    workspaceId: scope.workspace.id,
    ownerTelegramId: scope.ownerTelegramId,
    telegramChatId: scope.telegramChatId,
    viewerTelegramId: scope.principalTelegramId,
    viewerRole: scope.workspace.role,
  };
}

async function bestEffortScheduleNotification(
  action: "publish" | "refresh",
  botToken: string | undefined,
  scope: SchedulingScope,
  poll: Awaited<ReturnType<typeof getAvailabilityPoll>>,
): Promise<void> {
  if (!botToken) return;
  try {
    if (action === "publish") await publishAvailabilityPollCardWithToken(botToken, scope, poll);
    else await refreshAvailabilityPollCardWithToken(botToken, scope, poll);
  } catch (error) {
    logger.warn("Scheduling changed but its Telegram card could not be updated.", {
      action,
      pollId: poll.publicId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
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
  if (error instanceof GroupSchedulingError) {
    const status = error.code === "not_found" ? 404
      : error.code === "forbidden" ? 403
        : error.code === "conflict" || error.code === "cooldown" ? 409
          : error.code === "not_connected" ? 412
            : 400;
    return reply.code(status).send({ error: `scheduling_${error.code}`, message: error.message });
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
