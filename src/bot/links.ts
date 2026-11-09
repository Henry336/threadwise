/**
 * Builds every dashboard deep link the bot sends, so buttons can open the exact view or item.
 * Group and Study links go through the dashboard's /api/workspace/select route first, which
 * switches the browser to that opaque workspace id before redirecting to the target page.
 */
const DEFAULT_DASHBOARD_URL = "https://threadwise-dashboard.vercel.app";

export const DASHBOARD_URL = normalizeDashboardUrl(process.env.DASHBOARD_URL);

export type DashboardItemKind = "task" | "note" | "idea" | "image";
export type StudyDashboardItemKind = "study-item" | "study-resource";

/** Personal dashboard link to a view, optionally focused on one item. */
export function dashboardViewUrl(view: string, item?: { kind: DashboardItemKind; id: string }): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", view);
  if (item) {
    target.searchParams.set("item", item.id);
    target.searchParams.set("kind", item.kind);
  }
  return target.toString();
}

export function groupDashboardUrl(workspaceId: string, view?: string): string {
  return groupDashboardTargetUrl(workspaceId, view ? `/dashboard?view=${encodeURIComponent(view)}` : "/dashboard");
}

/** Link to edit a Today task draft: the Today view for Personal/Group, Study overview for Study. */
export function todayDraftDashboardUrl(draftId: string, workspace?: { id: string; study: boolean }): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", workspace?.study ? "study-overview" : "today");
  target.searchParams.set("draft", draftId);
  return workspace ? groupDashboardTargetUrl(workspace.id, `${target.pathname}${target.search}`) : target.toString();
}

export function groupDashboardItemUrl(workspaceId: string, view: string, kind: DashboardItemKind, id: string): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", view);
  target.searchParams.set("kind", kind);
  target.searchParams.set("item", id);
  return groupDashboardTargetUrl(workspaceId, `${target.pathname}${target.search}`);
}

export function studyDashboardItemUrl(workspaceId: string, view: string, kind: StudyDashboardItemKind, id: string): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", view);
  target.searchParams.set("kind", kind);
  target.searchParams.set("item", id);
  return groupDashboardTargetUrl(workspaceId, `${target.pathname}${target.search}`);
}

/** Link to a pending group TODO import review, where its rows can be edited before import. */
export function groupTaskImportReviewUrl(workspaceId: string, importId: string): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", "tasks");
  target.searchParams.set("import", importId);
  const select = new URL("/api/workspace/select", DASHBOARD_URL);
  select.searchParams.set("workspace", workspaceId);
  select.searchParams.set("next", `${target.pathname}${target.search}`);
  return select.toString();
}

/**
 * Link for the group "Find a time" scheduler. Telegram does not allow web_app buttons on normal
 * group messages, so this opens the bot's Main Mini App with a short startapp payload
 * (ftp_ = open poll, ftn_ = new poll, fts_ = schedule view). UUID dashes are removed to keep
 * the payload short. Without a bot username it falls back to a plain dashboard link.
 */
export function groupScheduleMiniAppUrl(
  botUsername: string | undefined,
  workspaceId: string,
  pollPublicId?: string,
  create = false,
): string {
  if (!botUsername) {
    const dashboard = new URL("/dashboard", DASHBOARD_URL);
    dashboard.searchParams.set("view", "schedule");
    if (pollPublicId) dashboard.searchParams.set("poll", pollPublicId);
    else if (create) dashboard.searchParams.set("new", "1");
    const select = new URL("/api/workspace/select", DASHBOARD_URL);
    select.searchParams.set("workspace", workspaceId);
    select.searchParams.set("next", `${dashboard.pathname}${dashboard.search}`);
    return select.toString();
  }
  const compactWorkspace = workspaceId.replace(/-/g, "");
  const payload = pollPublicId
    ? `ftp_${compactWorkspace}_${pollPublicId.replace(/-/g, "")}`
    : create
      ? `ftn_${compactWorkspace}`
      : `fts_${compactWorkspace}`;
  return `https://t.me/${botUsername.replace(/^@/, "")}?startapp=${encodeURIComponent(payload)}`;
}

/** Uses DASHBOARD_URL only if it is a valid https URL; anything else falls back to the production dashboard. */
function normalizeDashboardUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_DASHBOARD_URL;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : DEFAULT_DASHBOARD_URL;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

/** Wraps a dashboard path in the workspace-select redirect for an opaque group workspace id. */
function groupDashboardTargetUrl(workspaceId: string, target: string): string {
  const url = new URL("/api/workspace/select", DASHBOARD_URL);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("next", target);
  return url.toString();
}
