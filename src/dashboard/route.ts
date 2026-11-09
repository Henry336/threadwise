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
  getDashboardIdea,
  getDashboardImage,
  getDashboardNote,
  getDashboardSettings,
  getDashboardTask,
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
  createDashboardBrowserSession,
  DashboardBrowserSessionError,
  requireActiveDashboardBrowserSession,
  revokeDashboardBrowserSession,
} from "./browserSessions";
import {
  deleteDashboardPersonalNoteDraft,
  getDashboardPersonalNoteDraft,
  saveDashboardPersonalNoteDraft,
} from "./personalNoteDrafts";
import {
  dashboardIdParamsSchema,
  dashboardBrowserSessionCreateSchema,
  dashboardBrowserSessionParamsSchema,
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
  personalNoteDraftQuerySchema,
  personalNoteDraftSaveSchema,
  searchQuerySchema,
  settingsUpdateSchema,
  taskCreateSchema,
  taskCollaborationSchema,
  taskImportItemUpdateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  availabilityPollCreateSchema,
  availabilityResponseSchema,
  availabilityFinalizeSchema,
  availabilityCloseSchema,
  availabilityCalendarSchema,
  taskCaptureDraftAppendSchema,
  taskCaptureDraftCreateSchema,
  taskCaptureDraftItemUpdateSchema,
  todayAgendaQuerySchema,
  todayAgendaPlanSchema,
  todayAgendaOrderSchema,
} from "./schemas";
import { DashboardUserNotFoundError, getDashboardSnapshot } from "./snapshot";
import { previewDashboardCapture } from "./capture";
import { subscribeDashboardChanges } from "./realtime";
import { assertDashboardTaskMutation, getDashboardGroupCollaboration, recordDashboardTaskMutation, updateDashboardTaskCollaboration } from "./collaboration";
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
import { StudyModeError } from "../services/study";
import {
  DashboardRequestReplayError,
  consumeDashboardMutationToken,
} from "../security/dashboardRequestReplay";
import {
  SharedRateLimitExceededError,
  limitDashboardRequest,
} from "../security/sharedRateLimit";
import { DashboardStudyAccessError } from "./study";
import { registerStudyDashboardRoutes } from "./studyRoutes";
import {
  cancelTaskImport,
  getTaskImportReview,
  importReviewedTasks,
  resolveTaskImportActor,
  TaskImportError,
  updateTaskImportItem,
  type TaskImportReview,
} from "../services/taskImports";
import { DailyAgendaError } from "../services/dailyAgenda";
import { TaskCaptureDraftError } from "../services/taskCaptureDrafts";
import {
  TodayFoundationAccessError,
  appendDashboardTaskCaptureDraft,
  assertTodayFoundationAccess,
  cancelDashboardTaskCaptureDraft,
  commitDashboardTaskCaptureDraft,
  createDashboardTaskCaptureDraft,
  getDashboardTaskCaptureDraft,
  reviewDashboardTaskCaptureDraft,
  todayAgendaForDashboard,
  planTodayAgendaEntryForDashboard,
  updateDashboardTaskCaptureDraftItem,
  completeTodayAgendaEntryForDashboard,
  reorderTodayAgendaForDashboard,
} from "./today";

type DashboardRouteOptions = {
  publicKey?: string;
  telegramBotToken?: string;
  ai?: AiProvider;
  todayFoundationOwnerTelegramId?: string;
};

type RouteWork = (telegramId: string, scope: DashboardWorkspaceScope) => Promise<unknown>;

/**
 * Registers every dashboard API route on the Fastify server. Routes call the data layer
 * directly, so production and tests run the same code path; tests replace modules with vi.mock.
 */
export function registerDashboardRoute(server: FastifyInstance, options: DashboardRouteOptions = {}): void {
  /**
   * The one entry point every dashboard route goes through: no-store headers, token check, rate
   * limit, replay guard (a no-op for GET), workspace resolution, then the route's work, with every
   * error mapped by `sendDashboardError`. `personal: true` skips the workspace header for routes
   * about the signed-in person themselves (browser sessions, the workspace list).
   */
  const run = async (
    request: FastifyRequest,
    reply: FastifyReply,
    work: RouteWork,
    operation: string,
    runOptions: { personal?: boolean } = {},
  ) => {
    noStore(reply);
    try {
      const principal = await verifyDashboardAuthorization(request.headers.authorization, options.publicKey);
      await limitDashboardRequest(principal, request.method, operation);
      await consumeDashboardMutationToken(principal, request.method, operation);
      const scope = await resolveDashboardWorkspace(
        principal.telegramId,
        runOptions.personal ? undefined : dashboardWorkspaceHeader(request),
        options.telegramBotToken
      );
      return await work(scope.ownerTelegramId, scope);
    } catch (error) {
      return sendDashboardError(reply, error, operation);
    }
  };

  const loadScopedSnapshot: RouteWork = async (telegramId, scope) => {
    const [snapshot, collaboration, scheduling] = await Promise.all([
      getDashboardSnapshot(telegramId),
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

  const personal = { personal: true };

  server.post("/api/v1/dashboard/browser-sessions", async (request, reply) => run(request, reply, async (telegramId) => {
    const { ttlSeconds } = dashboardBrowserSessionCreateSchema.parse(request.body);
    const session = await createDashboardBrowserSession(telegramId, ttlSeconds);
    return { session: { id: session.id, expiresAt: session.expiresAt.toISOString() } };
  }, "create_browser_session", personal));

  server.get("/api/v1/dashboard/browser-sessions/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardBrowserSessionParamsSchema.parse(request.params);
    const session = await requireActiveDashboardBrowserSession(telegramId, id);
    return { session: { id: session.id, expiresAt: session.expiresAt.toISOString() } };
  }, "verify_browser_session", personal));

  server.delete("/api/v1/dashboard/browser-sessions/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardBrowserSessionParamsSchema.parse(request.params);
    await revokeDashboardBrowserSession(telegramId, id);
    return { revoked: true };
  }, "revoke_browser_session", personal));

  server.get("/api/v1/dashboard", async (request, reply) => run(request, reply, loadScopedSnapshot, "snapshot"));

  // The dashboard's client-side refresh calls api("snapshot"), which the BFF forwards here.
  server.get("/api/v1/dashboard/snapshot", async (request, reply) => run(request, reply, loadScopedSnapshot, "snapshot"));

  server.get("/api/v1/dashboard/workspaces", async (request, reply) => run(request, reply, async (telegramId) => ({
    workspaces: await listDashboardWorkspaces(telegramId),
  }), "list_workspaces", personal));

  server.get("/api/v1/dashboard/task-imports/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertGroupWorkspace(scope);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { taskImport: await getTaskImportReview(id, scope.workspace.id) };
  }, "get_task_import"));

  server.patch("/api/v1/dashboard/task-imports/:id/items/:itemId", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertGroupWorkspace(scope);
    const params = request.params as { id?: string; itemId?: string };
    const id = dashboardIdParamsSchema.parse({ id: params.id }).id;
    const itemId = dashboardIdParamsSchema.parse({ id: params.itemId }).id;
    const taskImport = await getTaskImportReview(id, scope.workspace.id);
    const actor = await dashboardTaskImportActor(scope, taskImport, options.telegramBotToken);
    const input = taskImportItemUpdateSchema.parse(request.body);
    const { dueAt, ...changes } = input;
    return {
      taskImport: await updateTaskImportItem(id, itemId, actor, {
        ...changes,
        ...(dueAt !== undefined ? { dueAt: dueAt === null ? null : new Date(dueAt) } : {}),
      }, scope.workspace.id),
    };
  }, "update_task_import_item"));

  server.post("/api/v1/dashboard/task-imports/:id/import", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertGroupWorkspace(scope);
    if (!options.ai) throw new DashboardConfigurationError("Task import is temporarily unavailable.");
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const taskImport = await getTaskImportReview(id, scope.workspace.id);
    const actor = await dashboardTaskImportActor(scope, taskImport, options.telegramBotToken);
    return importReviewedTasks(id, actor, options.ai, scope.workspace.id);
  }, "import_reviewed_tasks"));

  server.post("/api/v1/dashboard/task-imports/:id/cancel", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertGroupWorkspace(scope);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const taskImport = await getTaskImportReview(id, scope.workspace.id);
    const actor = await dashboardTaskImportActor(scope, taskImport, options.telegramBotToken);
    return { taskImport: await cancelTaskImport(id, actor, scope.workspace.id) };
  }, "cancel_task_import"));

  server.get("/api/v1/dashboard/events", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    reply.raw.write("retry: 2500\n\n");
    const revisionTelegramId = scope.workspace.mode === "STUDY"
      ? scope.principalTelegramId
      : scope.ownerTelegramId;
    const unsubscribe = subscribeDashboardChanges(revisionTelegramId, (event) => {
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
  }, "live_sync"));

  registerStudyDashboardRoutes(server, run, {
    telegramBotToken: options.telegramBotToken,
    todayFoundationOwnerTelegramId: options.todayFoundationOwnerTelegramId,
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

  server.post("/api/v1/dashboard/capture/preview", async (request, reply) => run(request, reply, async (telegramId) => {
    if (!options.ai) throw new DashboardConfigurationError("Dashboard capture intelligence is not configured.");
    return { preview: await previewDashboardCapture(telegramId, capturePreviewSchema.parse(request.body), options.ai) };
  }, "capture_preview"));

  server.get("/api/v1/dashboard/today", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    return { agenda: await todayAgendaForDashboard(scope, todayAgendaQuerySchema.parse(request.query)) };
  }, "today_agenda"));

  server.patch("/api/v1/dashboard/today/order", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    return { agenda: await reorderTodayAgendaForDashboard(scope, todayAgendaOrderSchema.parse(request.body)) };
  }, "reorder_today_agenda"));

  server.patch("/api/v1/dashboard/today/:id/plan", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const input = todayAgendaPlanSchema.parse(request.body);
    return { entry: await planTodayAgendaEntryForDashboard(scope, id, input.plannedFor) };
  }, "plan_today_entry"));

  server.post("/api/v1/dashboard/today/:id/complete", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await assertDashboardTaskMutation(scope, id, "complete", options.telegramBotToken);
    const entry = await completeTodayAgendaEntryForDashboard(scope, id);
    await recordDashboardTaskMutation(scope, entry, { kind: "updated", input: { status: "DONE" } }, options.telegramBotToken);
    return { entry };
  }, "complete_today_entry"));

  server.post("/api/v1/dashboard/task-drafts", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    return { draft: await createDashboardTaskCaptureDraft(scope, taskCaptureDraftCreateSchema.parse(request.body)) };
  }, "create_task_draft"));

  server.get("/api/v1/dashboard/task-drafts/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { draft: await getDashboardTaskCaptureDraft(scope, id) };
  }, "get_task_draft"));

  server.post("/api/v1/dashboard/task-drafts/:id/items", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { draft: await appendDashboardTaskCaptureDraft(scope, id, taskCaptureDraftAppendSchema.parse(request.body)) };
  }, "append_task_draft"));

  server.patch("/api/v1/dashboard/task-drafts/:id/items/:itemId", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const params = request.params as { id?: string; itemId?: string };
    const id = dashboardIdParamsSchema.parse({ id: params.id }).id;
    const itemId = dashboardIdParamsSchema.parse({ id: params.itemId }).id;
    const input = taskCaptureDraftItemUpdateSchema.parse(request.body);
    const { plannedFor, dueAt, ...changes } = input;
    return {
      draft: await updateDashboardTaskCaptureDraftItem(scope, id, itemId, {
        ...changes,
        ...(plannedFor !== undefined ? {
          plannedFor: plannedFor === null ? null : new Date(`${plannedFor}T00:00:00.000Z`),
        } : {}),
        ...(dueAt !== undefined ? { dueAt: dueAt === null ? null : new Date(dueAt) } : {}),
      }),
    };
  }, "update_task_draft_item"));

  server.post("/api/v1/dashboard/task-drafts/:id/review", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { draft: await reviewDashboardTaskCaptureDraft(scope, id) };
  }, "review_task_draft"));

  server.post("/api/v1/dashboard/task-drafts/:id/commit", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { draft: await commitDashboardTaskCaptureDraft(scope, id) };
  }, "commit_task_draft"));

  server.delete("/api/v1/dashboard/task-drafts/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { draft: await cancelDashboardTaskCaptureDraft(scope, id) };
  }, "cancel_task_draft"));

  server.get("/api/v1/dashboard/tasks", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = taskListQuerySchema.parse(request.query);
    return { tasks: await listDashboardTasks(telegramId, query) };
  }, "list_tasks"));

  server.get("/api/v1/dashboard/tasks/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { task: await getDashboardTask(telegramId, id) };
  }, "get_task"));

  server.post("/api/v1/dashboard/tasks", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const input = taskCreateSchema.parse(request.body);
    if (input.plannedFor !== undefined) {
      assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    }
    const task = await createDashboardTask(telegramId, input);
    await recordDashboardTaskMutation(scope, task, { kind: "created" }, options.telegramBotToken);
    return { task };
  }, "create_task"));

  server.patch("/api/v1/dashboard/tasks/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const input = taskUpdateSchema.parse(request.body);
    if (input.plannedFor !== undefined) {
      assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    }
    const completionOnly = input.status === "DONE" && Object.keys(input).every((key) => key === "status");
    await assertDashboardTaskMutation(scope, id, completionOnly ? "complete" : "manage", options.telegramBotToken);
    const task = await updateDashboardTask(telegramId, id, input);
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

  server.delete("/api/v1/dashboard/tasks/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await assertDashboardTaskMutation(scope, id, "manage", options.telegramBotToken);
    await archiveDashboardTask(telegramId, id);
    return { archived: true };
  }, "archive_task"));

  server.get("/api/v1/dashboard/note-drafts", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return { draft: await getDashboardPersonalNoteDraft(telegramId, personalNoteDraftQuerySchema.parse(request.query)) };
  }, "get_personal_note_draft"));

  server.patch("/api/v1/dashboard/note-drafts", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return { draft: await saveDashboardPersonalNoteDraft(telegramId, personalNoteDraftSaveSchema.parse(request.body)) };
  }, "save_personal_note_draft"));

  server.delete("/api/v1/dashboard/note-drafts/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await deleteDashboardPersonalNoteDraft(telegramId, id);
    return { deleted: true };
  }, "delete_personal_note_draft"));

  server.post("/api/v1/dashboard/notes", async (request, reply) => run(request, reply, async (telegramId) => ({
    note: await createDashboardNote(telegramId, noteCreateSchema.parse(request.body))
  }), "create_note"));

  server.get("/api/v1/dashboard/notes", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = noteListQuerySchema.parse(request.query);
    return { notes: await listDashboardNotes(telegramId, query) };
  }, "list_notes"));

  server.get("/api/v1/dashboard/notes/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { note: await getDashboardNote(telegramId, id) };
  }, "get_note"));

  server.patch("/api/v1/dashboard/notes/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { note: await updateDashboardNote(telegramId, id, noteUpdateSchema.parse(request.body)) };
  }, "update_note"));

  server.delete("/api/v1/dashboard/notes/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await archiveDashboardNote(telegramId, id);
    return { archived: true };
  }, "archive_note"));

  server.post("/api/v1/dashboard/ideas", async (request, reply) => run(request, reply, async (telegramId) => ({
    idea: await createDashboardIdea(telegramId, ideaCreateSchema.parse(request.body))
  }), "create_idea"));

  server.get("/api/v1/dashboard/ideas", async (request, reply) => run(request, reply, async (telegramId) => {
    const query = ideaListQuerySchema.parse(request.query);
    return { ideas: await listDashboardIdeas(telegramId, query) };
  }, "list_ideas"));

  server.get("/api/v1/dashboard/ideas/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { idea: await getDashboardIdea(telegramId, id) };
  }, "get_idea"));

  server.patch("/api/v1/dashboard/ideas/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { idea: await updateDashboardIdea(telegramId, id, ideaUpdateSchema.parse(request.body)) };
  }, "update_idea"));

  server.delete("/api/v1/dashboard/ideas/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await archiveDashboardIdea(telegramId, id);
    return { archived: true };
  }, "archive_idea"));

  server.post("/api/v1/dashboard/ideas/:id/convert-to-task", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { task: await convertDashboardIdeaToTask(telegramId, id, ideaConvertSchema.parse(request.body ?? {})) };
  }, "convert_idea"));

  server.post("/api/v1/dashboard/ideas/:id/analyze", async (request, reply) => run(request, reply, async (telegramId) => {
    if (!options.ai) throw new DashboardConfigurationError("Dashboard idea analysis is not configured.");
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return analyzeDashboardIdea(telegramId, id, options.ai);
  }, "analyze_idea"));

  server.post("/api/v1/dashboard/expenses", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return { expense: await createDashboardExpense(telegramId, expenseCreateSchema.parse(request.body)) };
  }, "create_expense"));

  server.get("/api/v1/dashboard/expenses", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const query = expenseListQuerySchema.parse(request.query);
    return { expenses: await listDashboardExpenses(telegramId, query) };
  }, "list_expenses"));

  server.patch("/api/v1/dashboard/expenses/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { expense: await updateDashboardExpense(telegramId, id, expenseUpdateSchema.parse(request.body)) };
  }, "update_expense"));

  server.delete("/api/v1/dashboard/expenses/:id", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await deleteDashboardExpense(telegramId, id);
    return { deleted: true };
  }, "delete_expense"));

  server.get("/api/v1/dashboard/images", async (request, reply) => run(request, reply, async (telegramId) => ({
    images: await listDashboardImages(telegramId, imageListQuerySchema.parse(request.query))
  }), "list_images"));

  server.get("/api/v1/dashboard/images/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { image: await getDashboardImage(telegramId, id) };
  }, "get_image"));

  server.get("/api/v1/dashboard/images/:id/content", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    const content = await loadDashboardImageContent(telegramId, id, options.telegramBotToken);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header("Content-Disposition", `inline; filename="threadwise-image.${imageExtension(content.contentType)}"`);
    reply.type(content.contentType);
    return reply.send(Buffer.from(content.bytes));
  }, "load_image"));

  server.patch("/api/v1/dashboard/images/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    return { image: await updateDashboardImage(telegramId, id, imageUpdateSchema.parse(request.body)) };
  }, "update_image"));

  server.delete("/api/v1/dashboard/images/:id", async (request, reply) => run(request, reply, async (telegramId) => {
    const { id } = dashboardIdParamsSchema.parse(request.params);
    await deleteDashboardImage(telegramId, id);
    return { deleted: true };
  }, "delete_image"));

  server.get("/api/v1/dashboard/search", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    const query = searchQuerySchema.parse(request.query);
    let kinds = searchKinds(query.kinds);
    if (scope.workspace.kind === "GROUP") {
      if (kinds.includes("expense")) throw new DashboardGroupAccessError("Expenses are available only in personal workspaces.");
      if (kinds.length === 0) kinds = ["task", "note", "idea", "image"];
    }
    return { query: query.q, results: await searchDashboard(telegramId, query.q, kinds, query.limit) };
  }, "search"));

  server.get("/api/v1/dashboard/settings", async (request, reply) => run(request, reply, async (telegramId) => ({
    settings: await getDashboardSettings(telegramId)
  }), "get_settings"));

  server.patch("/api/v1/dashboard/settings", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    await assertWorkspaceManager(scope, options.telegramBotToken);
    const input = settingsUpdateSchema.parse(request.body);
    if (input.overviewQuotes !== undefined) assertPersonalWorkspace(scope);
    if (
      input.morningBriefEnabled !== undefined
      || input.morningBriefTime !== undefined
      || input.eveningDebriefEnabled !== undefined
      || input.eveningDebriefTime !== undefined
    ) {
      assertPersonalWorkspace(scope);
      assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    }
    return { settings: await updateDashboardSettings(telegramId, input) };
  }, "update_settings"));

  server.post("/api/v1/dashboard/integrations/:provider/disconnect", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { provider } = integrationParamsSchema.parse(request.params);
    return disconnectDashboardIntegration(telegramId, provider);
  }, "disconnect_integration"));

  server.post("/api/v1/dashboard/integrations/:provider/connect", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const { provider } = integrationParamsSchema.parse(request.params);
    return createDashboardIntegrationConnectUrl(telegramId, provider, integrationConnectSchema.parse(request.body ?? {}));
  }, "connect_integration"));

  server.post("/api/v1/dashboard/integrations/calendar/sync", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return syncDashboardCalendarTasks(telegramId);
  }, "sync_calendar_tasks"));

  server.post("/api/v1/dashboard/integrations/calendar/task", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    const input = calendarTaskIntegrationSchema.parse(request.body);
    return updateDashboardTaskCalendar(telegramId, input.taskId, input.action);
  }, "update_task_calendar"));

  server.post("/api/v1/dashboard/integrations/excel/workbook", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return createDashboardExcelWorkbook(telegramId);
  }, "create_excel_workbook"));

  server.post("/api/v1/dashboard/integrations/excel/sync", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    return syncDashboardExcelExpenses(telegramId);
  }, "sync_excel_expenses"));

  server.get("/api/v1/dashboard/privacy/export", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    reply.header("Content-Disposition", 'attachment; filename="threadwise-export.json"');
    return exportDashboardData(telegramId);
  }, "export_data"));

  server.delete("/api/v1/dashboard/privacy/account", async (request, reply) => run(request, reply, async (telegramId, scope) => {
    assertPersonalWorkspace(scope);
    deleteAccountSchema.parse(request.body);
    await deleteDashboardAccount(telegramId);
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

function assertGroupWorkspace(scope: DashboardWorkspaceScope): void {
  if (scope.workspace.kind !== "GROUP") {
    throw new DashboardGroupAccessError("TODO imports are available in shared group workspaces.");
  }
}

async function dashboardTaskImportActor(
  scope: DashboardWorkspaceScope,
  taskImport: TaskImportReview,
  botToken: string | undefined,
) {
  const isSender = taskImport.requestedByTelegramId === scope.principalTelegramId;
  if (!isSender) await assertWorkspaceManager(scope, botToken);
  return resolveTaskImportActor(scope.workspace.id, scope.principalTelegramId, !isSender);
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

function friendlyValidationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Check the highlighted fields and try again.";
  if (issue.code !== "invalid_type") return issue.message;
  const key = String(issue.path.at(-1) ?? "field");
  const labels: Record<string, string> = {
    customTypeLabel: "Custom type",
    destination: "Destination",
    destinationPlaceId: "Destination",
    recurrenceStartDate: "Starts on",
    recurrenceEndDate: "Ends on",
    defaultOriginId: "Usual origin",
  };
  const label = labels[key] ?? key.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (value) => value.toUpperCase());
  return `${label} has an invalid value. Clear it or enter a valid value, then try again.`;
}

type ErrorClass<T extends Error = Error> = new (...args: never[]) => T;

/** Errors that always map to one status and one public code; `true` also returns their message. */
const PLAIN_ERRORS: Array<[ErrorClass, number, string, boolean]> = [
  [DashboardGroupAccessError, 403, "group_access_denied", true],
  [DashboardStudyAccessError, 404, "not_found", false],
  [TodayFoundationAccessError, 404, "not_found", false],
  [DashboardUserNotFoundError, 404, "user_not_found", false],
  [DashboardItemNotFoundError, 404, "not_found", false],
  [DashboardConflictError, 409, "revision_conflict", true],
  [DashboardUpstreamError, 502, "image_unavailable", false],
  [DashboardUnsupportedMediaError, 415, "unsupported_image_type", false],
];

/** Domain errors that carry a `code`: the response is `<prefix>_<code>`, with the listed status or 400. */
const CODED_ERRORS: Array<[ErrorClass<Error & { code: string }>, string, Record<string, number>]> = [
  [TaskCaptureDraftError, "task_draft", { not_found: 404, forbidden: 404, conflict: 409, expired: 409 }],
  [DailyAgendaError, "today", { not_found: 404, forbidden: 404, conflict: 409 }],
  [StudyModeError, "study", { not_found: 404, forbidden: 404, conflict: 409, disabled: 412, not_bound: 412 }],
  [GroupSchedulingError, "scheduling", { not_found: 404, forbidden: 403, conflict: 409, cooldown: 409, not_connected: 412 }],
  [TaskImportError, "task_import", { not_found: 404, forbidden: 403, conflict: 409, expired: 409 }],
];

/**
 * Turns any error thrown inside `run` into the dashboard's public error contract. Auth, replay,
 * session and rate-limit errors need their own headers; the rest are table lookups. Anything
 * unknown is logged without its message and returned as a generic 500.
 */
function sendDashboardError(reply: FastifyReply, error: unknown, operation: string) {
  if (error instanceof DashboardAuthenticationError) {
    return reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="threadwise-dashboard", error="invalid_token"')
      .send({ error: "unauthorized" });
  }
  if (error instanceof DashboardRequestReplayError) {
    return reply.code(409).send({
      error: "request_replayed",
      message: "This request was already processed. Refresh and try again.",
    });
  }
  if (error instanceof DashboardBrowserSessionError) {
    if (error.code === "user_not_found") return reply.code(404).send({ error: "user_not_found" });
    return reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="threadwise-dashboard", error="invalid_session"')
      .send({ error: "session_inactive" });
  }
  if (error instanceof SharedRateLimitExceededError) {
    return reply
      .code(429)
      .header("Retry-After", String(error.retryAfterSeconds))
      .send({ error: "rate_limited", message: "Too many requests. Try again shortly." });
  }
  for (const [type, status, code, withMessage] of PLAIN_ERRORS) {
    if (error instanceof type) return reply.code(status).send({ error: code, ...(withMessage ? { message: error.message } : {}) });
  }
  for (const [type, prefix, statuses] of CODED_ERRORS) {
    if (error instanceof type) {
      return reply.code(statuses[error.code] ?? 400).send({ error: `${prefix}_${error.code}`, message: error.message });
    }
  }
  if (error instanceof DashboardConfigurationError) {
    logger.error("Dashboard API is not configured correctly.", { errorType: error.name });
    return reply.code(503).send({ error: "dashboard_api_unavailable" });
  }
  if (error instanceof ZodError || error instanceof DashboardValidationError) {
    const message = error instanceof ZodError ? friendlyValidationMessage(error) : error.message;
    return reply.code(400).send({ error: "invalid_request", ...(message ? { message } : {}) });
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
