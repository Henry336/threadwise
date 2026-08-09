const DEFAULT_DASHBOARD_URL = "https://threadwise-dashboard.vercel.app";

export const DASHBOARD_URL = normalizeDashboardUrl(process.env.DASHBOARD_URL);

export type DashboardItemKind = "task" | "note" | "idea" | "image";

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

export function groupDashboardItemUrl(workspaceId: string, view: string, kind: DashboardItemKind, id: string): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", view);
  target.searchParams.set("kind", kind);
  target.searchParams.set("item", id);
  return groupDashboardTargetUrl(workspaceId, `${target.pathname}${target.search}`);
}

export function groupTaskImportReviewUrl(workspaceId: string, importId: string): string {
  const target = new URL("/dashboard", DASHBOARD_URL);
  target.searchParams.set("view", "tasks");
  target.searchParams.set("import", importId);
  const select = new URL("/api/workspace/select", DASHBOARD_URL);
  select.searchParams.set("workspace", workspaceId);
  select.searchParams.set("next", `${target.pathname}${target.search}`);
  return select.toString();
}

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

function normalizeDashboardUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_DASHBOARD_URL;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : DEFAULT_DASHBOARD_URL;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

function groupDashboardTargetUrl(workspaceId: string, target: string): string {
  const url = new URL("/api/workspace/select", DASHBOARD_URL);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("next", target);
  return url.toString();
}
