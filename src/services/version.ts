/**
 * Version and runtime status. appVersion feeds the public /health response in src/server.ts and the
 * /version and help replies in src/bot; formatVersionStatus renders the AI, Calendar, and reminder-loop
 * diagnostics shown by the version command.
 */
import type { AiProviderStatus } from "../ai/types";
import { bold, code, h } from "../utils/html";
import type { ReminderDiagnostics } from "./reminders";

/** Captured when this module first loads, which is close to process start. */
const startedAt = new Date();
/** Used only when the process was not started through npm (npm sets npm_package_version from package.json). */
const fallbackVersion = "0.30.0";

export type VersionStatus = {
  ai: AiProviderStatus;
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
    `${bold("Google Calendar")} ${status.calendarConfigured ? "configured" : "not configured"}`,
    "",
    bold("Reminders"),
    `${bold("Last run")} ${h(status.reminders.lastFinishedAt ?? status.reminders.lastStartedAt ?? "never")}`,
    `${bold("Run source")} ${h(status.reminders.source ?? "none")}`,
    `${bold("Due tasks found")} ${status.reminders.dueTasksFound}`,
    `${bold("Sent")} ${status.reminders.remindersSent}`,
    `${bold("Deferred")} ${status.reminders.deferredForQuietHours}`,
    `${bold("Capped")} ${status.reminders.cappedByDailyLimit}`,
    `${bold("Failures")} ${status.reminders.failedDeliveries}`,
    `${bold("Private assignee nudges sent")} ${status.reminders.directNudgesSent}`,
    `${bold("Private nudges skipped")} ${status.reminders.directNudgesSkipped}`,
    `${bold("Private nudge failures")} ${status.reminders.directNudgeFailures}`,
    status.reminders.lastError ? `${bold("Last error")} ${h(status.reminders.lastError)}` : undefined
  ].filter(Boolean).join("\n");
}
