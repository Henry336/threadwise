const DEFAULT_DASHBOARD_URL = "https://threadwise-dashboard.vercel.app";

export const DASHBOARD_URL = normalizeDashboardUrl(process.env.DASHBOARD_URL);

export function groupDashboardUrl(workspaceId: string, view?: string): string {
  const url = new URL("/api/workspace/select", DASHBOARD_URL);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("next", view ? `/dashboard?view=${view}` : "/dashboard");
  return url.toString();
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
