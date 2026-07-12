import type { AiProviderStatus } from "../ai/types";
import { bold, code, h } from "../utils/html";
import type { ReminderDiagnostics } from "./reminders";

const startedAt = new Date();
const fallbackVersion = "0.13.0";

export type VersionStatus = {
  ai: AiProviderStatus;
  gmailConfigured: boolean;
  calendarConfigured: boolean;
  excelConfigured: boolean;
  reminders: ReminderDiagnostics;
};

export function appVersion(): string {
  return process.env.npm_package_version ?? fallbackVersion;
}

export function appStartedAt(): Date {
  return new Date(startedAt);
}

export function formatVersionStatus(status: VersionStatus, now = new Date()): string {
  const aiLine = status.ai.provider === "openai"
    ? `OpenAI${status.ai.activeChatModel ? ` (${status.ai.activeChatModel})` : ""}`
    : "heuristic fallback";

  return [
    `${bold("Threadwise")} ${code(`v${appVersion()}`)}`,
    `${bold("Deploy/start")} ${h(appStartedAt().toISOString())}`,
    `${bold("Checked")} ${h(now.toISOString())}`,
    "",
    `${bold("AI")} ${h(aiLine)}`,
    `${bold("Gmail")} ${status.gmailConfigured ? "configured" : "not configured"}`,
    `${bold("Google Calendar")} ${status.calendarConfigured ? "configured" : "not configured"}`,
    `${bold("Microsoft Excel")} ${status.excelConfigured ? "configured" : "not configured"}`,
    "",
    bold("Reminders"),
    `${bold("Last run")} ${h(status.reminders.lastFinishedAt ?? status.reminders.lastStartedAt ?? "never")}`,
    `${bold("Run source")} ${h(status.reminders.source ?? "none")}`,
    `${bold("Due tasks found")} ${status.reminders.dueTasksFound}`,
    `${bold("Sent")} ${status.reminders.remindersSent}`,
    `${bold("Deferred")} ${status.reminders.deferredForQuietHours}`,
    `${bold("Capped")} ${status.reminders.cappedByDailyLimit}`,
    `${bold("Failures")} ${status.reminders.failedDeliveries}`,
    status.reminders.lastError ? `${bold("Last error")} ${h(status.reminders.lastError)}` : undefined
  ].filter(Boolean).join("\n");
}
