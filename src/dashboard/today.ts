import { PlanningScope, type PrismaClient, type StudyItemType } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import {
  appendTaskCaptureDraft,
  cancelTaskCaptureDraft,
  commitTaskCaptureDraft,
  createTaskCaptureDraft,
  getTaskCaptureDraft,
  reviewTaskCaptureDraft,
  updateTaskCaptureDraftItem,
  type DraftItemPatch,
  type TaskCaptureScope,
} from "../services/taskCaptureDrafts";
import { getDailyAgenda, planDailyAgendaEntry } from "../services/dailyAgenda";
import type { DashboardWorkspaceScope } from "./workspaces";
import { requireDashboardStudyWorkspace } from "./study";

export class TodayFoundationAccessError extends Error {
  constructor() {
    super("Not found.");
    this.name = "TodayFoundationAccessError";
  }
}

export function assertTodayFoundationAccess(
  principalTelegramId: string,
  ownerTelegramId = env.TODAY_FOUNDATION_OWNER_TELEGRAM_ID,
): void {
  if (!ownerTelegramId || principalTelegramId !== ownerTelegramId) {
    throw new TodayFoundationAccessError();
  }
}

export async function todayAgendaForDashboard(
  scope: DashboardWorkspaceScope,
  input: { localDate?: string; dueSoonDays?: number },
  database: PrismaClient = prisma,
) {
  const captureScope = await resolveTaskCaptureScope(scope, database);
  return getDailyAgenda({
    principalTelegramId: scope.principalTelegramId,
    scope: captureScope.scope,
    groupWorkspaceId: captureScope.groupWorkspaceId,
    studyWorkspaceId: captureScope.studyWorkspaceId,
  }, input, database);
}

export async function planTodayAgendaEntryForDashboard(
  scope: DashboardWorkspaceScope,
  entryId: string,
  plannedFor: string | null,
  database: PrismaClient = prisma,
) {
  const captureScope = await resolveTaskCaptureScope(scope, database);
  return planDailyAgendaEntry({
    principalTelegramId: scope.principalTelegramId,
    scope: captureScope.scope,
    groupWorkspaceId: captureScope.groupWorkspaceId,
    studyWorkspaceId: captureScope.studyWorkspaceId,
  }, entryId, plannedFor, database);
}

export async function createDashboardTaskCaptureDraft(
  scope: DashboardWorkspaceScope,
  input: { text: string; moduleId?: string; studyItemType?: StudyItemType },
  database: PrismaClient = prisma,
) {
  return createTaskCaptureDraft(await resolveTaskCaptureScope(scope, database), input.text, input, database);
}

export async function appendDashboardTaskCaptureDraft(
  scope: DashboardWorkspaceScope,
  draftId: string,
  input: { text: string; moduleId?: string; studyItemType?: StudyItemType },
  database: PrismaClient = prisma,
) {
  await requireScopedDraft(scope, draftId, database);
  return appendTaskCaptureDraft(draftId, scope.principalTelegramId, input.text, input, database);
}

export async function getDashboardTaskCaptureDraft(
  scope: DashboardWorkspaceScope,
  draftId: string,
  database: PrismaClient = prisma,
) {
  return requireScopedDraft(scope, draftId, database);
}

export async function reviewDashboardTaskCaptureDraft(
  scope: DashboardWorkspaceScope,
  draftId: string,
  database: PrismaClient = prisma,
) {
  await requireScopedDraft(scope, draftId, database);
  return reviewTaskCaptureDraft(draftId, scope.principalTelegramId, database);
}

export async function updateDashboardTaskCaptureDraftItem(
  scope: DashboardWorkspaceScope,
  draftId: string,
  itemId: string,
  patch: DraftItemPatch,
  database: PrismaClient = prisma,
) {
  await requireScopedDraft(scope, draftId, database);
  return updateTaskCaptureDraftItem(draftId, itemId, scope.principalTelegramId, patch, database);
}

export async function commitDashboardTaskCaptureDraft(
  scope: DashboardWorkspaceScope,
  draftId: string,
  database: PrismaClient = prisma,
) {
  await requireScopedDraft(scope, draftId, database);
  return commitTaskCaptureDraft(draftId, scope.principalTelegramId, database);
}

export async function cancelDashboardTaskCaptureDraft(
  scope: DashboardWorkspaceScope,
  draftId: string,
  database: PrismaClient = prisma,
) {
  await requireScopedDraft(scope, draftId, database);
  return cancelTaskCaptureDraft(draftId, scope.principalTelegramId, database);
}

async function resolveTaskCaptureScope(
  scope: DashboardWorkspaceScope,
  database: PrismaClient,
): Promise<TaskCaptureScope> {
  if (scope.workspace.mode === "STUDY") {
    const workspace = await requireDashboardStudyWorkspace(scope, database);
    return {
      ownerUserId: workspace.ownerUserId,
      principalTelegramId: scope.principalTelegramId,
      scope: PlanningScope.STUDY,
      timezone: workspace.timezone,
      studyWorkspaceId: workspace.id,
    };
  }
  const owner = await database.user.findUnique({
    where: { telegramId: scope.ownerTelegramId },
    include: { settings: true },
  });
  if (!owner?.settings) throw new TodayFoundationAccessError();
  if (scope.workspace.kind === "GROUP") {
    const workspace = await database.groupWorkspace.findFirst({
      where: { id: scope.workspace.id, ownerUserId: owner.id, isActive: true },
    });
    if (!workspace) throw new TodayFoundationAccessError();
    return {
      ownerUserId: owner.id,
      principalTelegramId: scope.principalTelegramId,
      scope: PlanningScope.GROUP,
      timezone: workspace.timezone || owner.settings.timezone,
      groupWorkspaceId: workspace.id,
    };
  }
  return {
    ownerUserId: owner.id,
    principalTelegramId: scope.principalTelegramId,
    scope: PlanningScope.PERSONAL,
    timezone: owner.settings.timezone,
  };
}

async function requireScopedDraft(
  scope: DashboardWorkspaceScope,
  draftId: string,
  database: PrismaClient,
) {
  const expected = await resolveTaskCaptureScope(scope, database);
  const draft = await getTaskCaptureDraft(draftId, scope.principalTelegramId, database);
  const matches = draft.scope === expected.scope
    && (draft.groupWorkspaceId ?? undefined) === expected.groupWorkspaceId
    && (draft.studyWorkspaceId ?? undefined) === expected.studyWorkspaceId;
  if (!matches) throw new TodayFoundationAccessError();
  return draft;
}
