import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertTodayFoundationAccess } from "./today";
import type { DashboardWorkspaceScope } from "./workspaces";
import { getStudyAnalysis, requestStudyAnalysis } from "../services/studyAnalysis";
import { reviewStudyNoteEditSuggestion } from "../services/studyNoteEditSuggestions";
import { DASHBOARD_URL } from "../bot/links";
import { createCalendarConnectUrl } from "../services/googleCalendar";
import { stopStudyCalendarSync, studyCalendarSnapshot, syncStudyTimetable } from "../services/studyCalendar";
import {
  archiveDashboardStudyItem,
  archiveDashboardStudyResource,
  archiveDashboardStudyScheduleBlock,
  archiveDashboardStudySession,
  completeDashboardStudyItem,
  createDashboardStudyItem,
  createDashboardStudyMistake,
  createDashboardStudyModule,
  createDashboardStudyOrigin,
  createDashboardStudyResource,
  createDashboardStudyScheduleBlock,
  deleteDashboardStudyNoteDraft,
  deleteDashboardStudyOrigin,
  getDashboardStudyItem,
  getDashboardStudyNoteDraft,
  getDashboardStudyResource,
  getDashboardStudySnapshot,
  importDashboardStudyNusmods,
  listDashboardStudyResources,
  loadDashboardStudyResourceContent,
  requireDashboardStudyWorkspace,
  resolveDashboardStudyCanvasAssignment,
  resolveDashboardStudyMistake,
  saveDashboardStudyNoteDraft,
  saveDashboardStudyWeeklyPlan,
  saveDashboardStudyWeeklyReview,
  searchDashboardStudy,
  searchDashboardStudyPlaces,
  startDashboardStudySession,
  stopDashboardStudySession,
  studyAnalysisRequestSchema,
  studyCanvasAssignmentActionSchema,
  studyIdParamsSchema,
  studyItemCreateSchema,
  studyItemUpdateSchema,
  studyMistakeCreateSchema,
  studyModuleCreateSchema,
  studyModuleUpdateSchema,
  studyNoteDraftQuerySchema,
  studyNoteDraftSaveSchema,
  studyNoteSuggestionReviewSchema,
  studyNusmodsImportSchema,
  studyOriginCreateSchema,
  studyOriginUpdateSchema,
  studyPlaceSearchSchema,
  studyResourceCreateSchema,
  studyResourceQuerySchema,
  studyResourceUpdateSchema,
  studyScheduleCreateSchema,
  studyScheduleDeleteSchema,
  studyScheduleUpdateSchema,
  studySearchQuerySchema,
  studySessionStartSchema,
  studySessionStopSchema,
  studySessionUpdateSchema,
  studySettingsUpdateSchema,
  studyWeeklyPlanSchema,
  studyWeeklyReviewSchema,
  syncDashboardStudyCanvas,
  updateDashboardStudyItem,
  updateDashboardStudyModule,
  updateDashboardStudyOrigin,
  updateDashboardStudyResource,
  updateDashboardStudyScheduleBlock,
  updateDashboardStudySession,
  updateDashboardStudySettings,
} from "./study";

type RouteWork = (telegramId: string, scope: DashboardWorkspaceScope) => Promise<unknown>;
type RouteRunner = (
  request: FastifyRequest,
  reply: FastifyReply,
  work: RouteWork,
  operation: string,
) => Promise<unknown>;

export type StudyDashboardRouteOptions = {
  telegramBotToken?: string;
  todayFoundationOwnerTelegramId?: string;
};

/**
 * Registers the Study-only dashboard API surface.
 *
 * Authentication, replay protection, rate limiting, and workspace resolution deliberately remain
 * owned by the parent router and enter through `run`. This keeps the security boundary centralized
 * while making the Study transport surface independently reviewable.
 */
export function registerStudyDashboardRoutes(
  server: FastifyInstance,
  run: RouteRunner,
  options: StudyDashboardRouteOptions,
): void {
  server.get("/api/v1/dashboard/study/snapshot", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { study: await getDashboardStudySnapshot(workspace) };
  }, "study_snapshot"));

  server.post("/api/v1/dashboard/study/calendar/connect", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const returnTo = new URL("/dashboard?view=study-timetable&resume=study-calendar-sync", DASHBOARD_URL).toString();
    return {
      url: await createCalendarConnectUrl(workspace.ownerUserId, workspace.ownerTelegramId, { returnTo }),
    };
  }, "study_calendar_connect"));

  server.post("/api/v1/dashboard/study/calendar/sync", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { calendar: await syncStudyTimetable(workspace) };
  }, "study_calendar_sync"));

  server.post("/api/v1/dashboard/study/calendar/stop", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    await stopStudyCalendarSync(workspace);
    return { calendar: await studyCalendarSnapshot(await requireDashboardStudyWorkspace(scope)) };
  }, "study_calendar_stop"));

  server.post("/api/v1/dashboard/study/modules", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { module: await createDashboardStudyModule(workspace, studyModuleCreateSchema.parse(request.body)) };
  }, "study_create_module"));

  server.patch("/api/v1/dashboard/study/modules/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { module: await updateDashboardStudyModule(workspace, id, studyModuleUpdateSchema.parse(request.body)) };
  }, "study_update_module"));

  server.get("/api/v1/dashboard/study/modules/:id/analysis", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    const { mode } = studyAnalysisRequestSchema.parse(request.query);
    return getStudyAnalysis(workspace, id, mode);
  }, "study_get_module_analysis"));

  server.post("/api/v1/dashboard/study/modules/:id/analysis", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    const { mode } = studyAnalysisRequestSchema.parse(request.body ?? {});
    return requestStudyAnalysis(workspace, id, scope.principalTelegramId, mode);
  }, "study_request_module_analysis"));

  server.patch("/api/v1/dashboard/study/analysis-suggestions/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    const suggestion = await reviewStudyNoteEditSuggestion(workspace, id, studyNoteSuggestionReviewSchema.parse(request.body));
    return { suggestion };
  }, "study_review_analysis_suggestion"));

  server.post("/api/v1/dashboard/study/items", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const input = studyItemCreateSchema.parse(request.body);
    if (input.plannedFor !== undefined) {
      assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    }
    return { item: await createDashboardStudyItem(workspace, input) };
  }, "study_create_item"));

  server.get("/api/v1/dashboard/study/items/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { item: await getDashboardStudyItem(workspace, id) };
  }, "study_get_item"));

  server.patch("/api/v1/dashboard/study/items/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    const input = studyItemUpdateSchema.parse(request.body);
    if (input.plannedFor !== undefined) {
      assertTodayFoundationAccess(scope.principalTelegramId, options.todayFoundationOwnerTelegramId);
    }
    return { item: await updateDashboardStudyItem(workspace, id, input) };
  }, "study_update_item"));

  server.delete("/api/v1/dashboard/study/items/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    await archiveDashboardStudyItem(workspace, id);
    return { archived: true };
  }, "study_archive_item"));

  server.post("/api/v1/dashboard/study/items/:id/complete", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { item: await completeDashboardStudyItem(workspace, id, false) };
  }, "study_complete_item"));

  server.get("/api/v1/dashboard/study/note-drafts", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { draft: await getDashboardStudyNoteDraft(workspace, studyNoteDraftQuerySchema.parse(request.query)) };
  }, "study_get_note_draft"));

  server.patch("/api/v1/dashboard/study/note-drafts", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { draft: await saveDashboardStudyNoteDraft(workspace, studyNoteDraftSaveSchema.parse(request.body)) };
  }, "study_save_note_draft"));

  server.delete("/api/v1/dashboard/study/note-drafts/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    await deleteDashboardStudyNoteDraft(workspace, id);
    return { deleted: true };
  }, "study_delete_note_draft"));

  server.get("/api/v1/dashboard/study/resources", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { resources: await listDashboardStudyResources(workspace, studyResourceQuerySchema.parse(request.query)) };
  }, "study_list_resources"));

  server.post("/api/v1/dashboard/study/resources", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { resource: await createDashboardStudyResource(workspace, studyResourceCreateSchema.parse(request.body)) };
  }, "study_create_resource"));

  server.get("/api/v1/dashboard/study/resources/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { resource: await getDashboardStudyResource(workspace, id) };
  }, "study_get_resource"));

  server.patch("/api/v1/dashboard/study/resources/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { resource: await updateDashboardStudyResource(workspace, id, studyResourceUpdateSchema.parse(request.body)) };
  }, "study_update_resource"));

  server.delete("/api/v1/dashboard/study/resources/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    await archiveDashboardStudyResource(workspace, id);
    return { archived: true };
  }, "study_archive_resource"));

  server.get("/api/v1/dashboard/study/resources/:id/content", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    const content = await loadDashboardStudyResourceContent(workspace, id, options.telegramBotToken);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header("Content-Disposition", `${content.inline ? "inline" : "attachment"}; filename="${content.fileName}"`);
    reply.type(content.contentType);
    return reply.send(Buffer.from(content.bytes));
  }, "study_resource_content"));

  server.get("/api/v1/dashboard/study/search", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const query = studySearchQuerySchema.parse(request.query);
    return { query: query.q, results: await searchDashboardStudy(workspace, query) };
  }, "study_search"));

  server.post("/api/v1/dashboard/study/sessions/start", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { session: await startDashboardStudySession(workspace, studySessionStartSchema.parse(request.body)) };
  }, "study_start_session"));

  server.post("/api/v1/dashboard/study/sessions/stop", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { session: await stopDashboardStudySession(workspace, studySessionStopSchema.parse(request.body ?? {})) };
  }, "study_stop_session"));

  server.patch("/api/v1/dashboard/study/sessions/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { session: await updateDashboardStudySession(workspace, id, studySessionUpdateSchema.parse(request.body)) };
  }, "study_update_session"));

  server.delete("/api/v1/dashboard/study/sessions/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { session: await archiveDashboardStudySession(workspace, id) };
  }, "study_archive_session"));

  server.post("/api/v1/dashboard/study/mistakes", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { mistake: await createDashboardStudyMistake(workspace, studyMistakeCreateSchema.parse(request.body)) };
  }, "study_create_mistake"));

  server.post("/api/v1/dashboard/study/mistakes/:id/resolve", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { mistake: await resolveDashboardStudyMistake(workspace, id) };
  }, "study_resolve_mistake"));

  server.patch("/api/v1/dashboard/study/weekly-plan", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { week: await saveDashboardStudyWeeklyPlan(workspace, studyWeeklyPlanSchema.parse(request.body)) };
  }, "study_weekly_plan"));

  server.post("/api/v1/dashboard/study/review", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { review: await saveDashboardStudyWeeklyReview(workspace, studyWeeklyReviewSchema.parse(request.body)) };
  }, "study_weekly_review"));

  server.patch("/api/v1/dashboard/study/settings", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { settings: await updateDashboardStudySettings(workspace, studySettingsUpdateSchema.parse(request.body)) };
  }, "study_update_settings"));

  server.post("/api/v1/dashboard/study/canvas/sync", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { sync: await syncDashboardStudyCanvas(workspace) };
  }, "study_canvas_sync"));

  server.post("/api/v1/dashboard/study/nusmods/import", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { import: await importDashboardStudyNusmods(workspace, studyNusmodsImportSchema.parse(request.body ?? {})) };
  }, "study_nusmods_import"));

  server.patch("/api/v1/dashboard/study/canvas/assignments/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    const input = studyCanvasAssignmentActionSchema.parse(request.body);
    return { assignment: await resolveDashboardStudyCanvasAssignment(workspace, id, input.action) };
  }, "study_canvas_review"));

  server.post("/api/v1/dashboard/study/origins", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { origin: await createDashboardStudyOrigin(workspace, studyOriginCreateSchema.parse(request.body)) };
  }, "study_create_origin"));

  server.get("/api/v1/dashboard/study/places", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { q } = studyPlaceSearchSchema.parse(request.query);
    return { places: await searchDashboardStudyPlaces(workspace, q) };
  }, "study_search_places"));

  server.patch("/api/v1/dashboard/study/origins/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { origin: await updateDashboardStudyOrigin(workspace, id, studyOriginUpdateSchema.parse(request.body)) };
  }, "study_update_origin"));

  server.delete("/api/v1/dashboard/study/origins/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    await deleteDashboardStudyOrigin(workspace, id);
    return { deleted: true };
  }, "study_delete_origin"));

  server.post("/api/v1/dashboard/study/schedule", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    return { block: await createDashboardStudyScheduleBlock(workspace, studyScheduleCreateSchema.parse(request.body)) };
  }, "study_create_schedule"));

  server.patch("/api/v1/dashboard/study/schedule/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    return { block: await updateDashboardStudyScheduleBlock(workspace, id, studyScheduleUpdateSchema.parse(request.body)) };
  }, "study_update_schedule"));

  server.delete("/api/v1/dashboard/study/schedule/:id", async (request, reply) => run(request, reply, async (_telegramId, scope) => {
    const workspace = await requireDashboardStudyWorkspace(scope);
    const { id } = studyIdParamsSchema.parse(request.params);
    await archiveDashboardStudyScheduleBlock(workspace, id, studyScheduleDeleteSchema.parse(request.body ?? {}));
    return { archived: true };
  }, "study_archive_schedule"));
}
