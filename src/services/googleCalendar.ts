import crypto from "crypto";
import { RecurrenceRule, TaskStatus } from "@prisma/client";
import { InlineKeyboard, type Bot } from "grammy";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, h, HTML_REPLY } from "../utils/html";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email"
];

type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type CalendarTask = {
  id: string;
  title: string;
  description?: string | null;
  sourceText: string;
  dueAt?: Date | null;
  timezone?: string | null;
  calendarEventId?: string | null;
  calendarEventUrl?: string | null;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceDayOfMonth?: number | null;
  status?: TaskStatus;
};

type GoogleCalendarEventResponse = {
  id?: string;
  htmlLink?: string;
};

export type GoogleCalendarEventInput = {
  title: string;
  details?: string | null;
  dueAt: Date;
  timezone: string;
  recurrenceRule?: RecurrenceRule | null;
};

export type GoogleCalendarMeetingInput = {
  title: string;
  details?: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
};

export type CalendarConnectOptions = {
  taskId?: string;
  enableAutoSync?: boolean;
  returnTo?: string;
};

export type OAuthCallbackResult = {
  message: string;
  redirectUrl?: string;
};

export function calendarConfigured(): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    calendarRedirectUri() &&
    tokenEncryptionSecret()
  );
}

export async function createCalendarConnectUrl(userId: string, chatId: string, options: CalendarConnectOptions = {}): Promise<string> {
  if (!calendarConfigured()) {
    throw new Error("Google Calendar is not configured. Add the Google OAuth credentials, Calendar redirect URI, and token encryption key.");
  }

  const state = crypto.randomBytes(24).toString("hex");
  await prisma.pendingCalendarOAuth.deleteMany({ where: { userId } });
  await prisma.pendingCalendarOAuth.create({
    data: {
      userId,
      state,
      chatId,
      taskId: options.taskId,
      enableAutoSync: options.enableAutoSync ?? false,
      returnTo: options.returnTo,
      expiresAt: new Date(Date.now() + 15 * 60_000)
    }
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", calendarRedirectUri() ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleCalendarOAuthCallback(bot: Bot, query: { code?: string; state?: string; error?: string }): Promise<OAuthCallbackResult> {
  const pending = query.state
    ? await prisma.pendingCalendarOAuth.findFirst({ where: { state: query.state, expiresAt: { gt: new Date() } } })
    : undefined;
  const result = (message: string): OAuthCallbackResult => ({
    message,
    ...(pending?.returnTo ? { redirectUrl: withConnectionResult(pending.returnTo, "calendar", message.startsWith("Google Calendar connected") ? "connected" : "error") } : {})
  });

  if (query.error) return result(`Google Calendar connection failed: ${query.error}`);
  if (!query.code || !query.state) return result("Google Calendar connection failed because the authorization response was incomplete.");
  if (!pending) return { message: "This Google Calendar connection link expired. Open Connections and try again." };

  try {
    const tokens = await exchangeCodeForTokens(query.code);
    const existing = await prisma.calendarConnection.findUnique({ where: { userId: pending.userId } });
    const refreshToken = tokens.refresh_token ?? (existing ? unprotectToken(existing.refreshToken) : undefined);
    if (!tokens.access_token || !refreshToken) {
      return result("Google Calendar did not grant lasting access. Reconnect and approve Calendar access.");
    }

    const profile = await googleGet<{ email?: string }>(tokens.access_token, "https://openidconnect.googleapis.com/v1/userinfo");
    await prisma.$transaction([
      prisma.calendarConnection.upsert({
        where: { userId: pending.userId },
        update: {
          calendarEmail: profile.email,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(refreshToken),
          accessTokenExpiresAt: expiresAt(tokens.expires_in)
        },
        create: {
          userId: pending.userId,
          calendarEmail: profile.email,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(refreshToken),
          accessTokenExpiresAt: expiresAt(tokens.expires_in)
        }
      }),
      ...(pending.enableAutoSync
        ? [prisma.userSettings.update({ where: { userId: pending.userId }, data: { calendarAutoSync: true } })]
        : []),
      prisma.pendingCalendarOAuth.deleteMany({ where: { userId: pending.userId } })
    ]);

    let taskMessage = "";
    let taskKeyboard: InlineKeyboard | undefined;
    if (pending.taskId) {
      const task = await prisma.task.findFirst({ where: { id: pending.taskId, userId: pending.userId, archivedAt: null } });
      if (task?.dueAt) {
        try {
          const synced = await syncTaskToGoogleCalendar(pending.userId, task);
          if (synced) {
            taskMessage = `\n${h(task.title)} is now in Google Calendar.`;
            taskKeyboard = new InlineKeyboard().url("Open event", synced.eventUrl).text("‹ Tasks", "menu:tasks");
          }
        } catch (error) {
          logger.warn("Calendar connected but the pending task could not be synced.", { userId: pending.userId, taskId: task.id, error: String(error) });
          taskMessage = "\nThe account is connected, but that reminder did not sync. Open it and tap Calendar to retry.";
        }
      }
    }

    if (pending.enableAutoSync && !pending.taskId) {
      try {
        const backfill = await syncEligibleTasksToGoogleCalendar(pending.userId);
        taskMessage = backfill.synced > 0
          ? `\n${backfill.synced} existing dated task${backfill.synced === 1 ? " was" : "s were"} also synced.`
          : "";
      } catch (error) {
        logger.warn("Calendar connected but existing dated tasks could not be backfilled.", { userId: pending.userId, error: String(error) });
        taskMessage = "\nThe account is connected. Existing tasks can be synced from Connections.";
      }
    }

    const autoSyncMessage = pending.enableAutoSync
      ? "\nAutomatic sync is on for dated tasks."
      : "";
    const telegramMessage = `Google Calendar connected${profile.email ? ` for ${h(profile.email)}` : ""}.${taskMessage}${autoSyncMessage}`;
    try {
      await bot.api.sendMessage(pending.chatId, telegramMessage, {
        ...HTML_REPLY,
        ...(taskKeyboard ? { reply_markup: taskKeyboard } : {})
      });
    } catch (error) {
      logger.warn("Calendar connected but the Telegram confirmation could not be delivered.", { userId: pending.userId, error: String(error) });
    }
    return result(`Google Calendar connected${taskMessage ? " and the selected reminder was synced" : ""}.`);
  } catch (error) {
    logger.error("Google Calendar OAuth callback failed.", { error: String(error) });
    return result("Google Calendar connection failed. Open Connections and try again.");
  }
}

export async function disconnectCalendar(userId: string): Promise<string> {
  await prisma.$transaction([
    prisma.calendarConnection.deleteMany({ where: { userId } }),
    prisma.pendingCalendarOAuth.deleteMany({ where: { userId } }),
    prisma.userSettings.updateMany({ where: { userId }, data: { calendarAutoSync: false } })
  ]);
  return "Google Calendar disconnected. Existing calendar events are left in Google Calendar.";
}

export async function calendarConnectionStatus(userId: string) {
  const [connection, settings, syncedTasks] = await Promise.all([
    prisma.calendarConnection.findUnique({ where: { userId } }),
    prisma.userSettings.findUnique({ where: { userId }, select: { calendarAutoSync: true } }),
    prisma.task.count({ where: { userId, calendarEventId: { not: null }, archivedAt: null } })
  ]);
  return {
    connected: Boolean(connection),
    email: connection?.calendarEmail ?? undefined,
    autoSync: settings?.calendarAutoSync ?? false,
    syncedTasks
  };
}

export async function formatCalendarStatus(userId: string): Promise<string> {
  const status = await calendarConnectionStatus(userId);
  if (!status.connected) {
    return [
      bold("📅 Google Calendar"),
      calendarConfigured() ? "Not connected." : "Connection setup is not available on this deployment.",
      "Connect once, then use the Calendar button on any dated task."
    ].join("\n");
  }

  return [
    bold("📅 Google Calendar"),
    `${bold("Account")} ${h(status.email ?? "Connected")}`,
    `${bold("Automatic sync")} ${status.autoSync ? "On" : "Off"}`,
    `${bold("Synced tasks")} ${status.syncedTasks}`
  ].join("\n");
}

export async function syncTaskToGoogleCalendar(userId: string, task: CalendarTask): Promise<{ created: boolean; eventId: string; eventUrl: string } | undefined> {
  if (!task.dueAt) {
    throw new Error("This task needs a due date before it can be added to Google Calendar.");
  }

  const connection = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!connection) {
    return undefined;
  }

  const accessToken = await validAccessToken(connection);
  const payload = buildGoogleCalendarEvent({
    title: task.title,
    details: task.description ?? task.sourceText,
    dueAt: task.dueAt,
    timezone: task.timezone ?? "UTC",
    recurrenceRule: task.recurrenceRule
  });
  let created = !task.calendarEventId;
  const url = task.calendarEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(task.calendarEventId)}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  let response: GoogleCalendarEventResponse;
  try {
    response = await googleRequest<GoogleCalendarEventResponse>(accessToken, url, {
      method: created ? "POST" : "PATCH",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (!task.calendarEventId || !(error instanceof Error) || !error.message.endsWith(": 404")) {
      throw error;
    }
    created = true;
    response = await googleRequest<GoogleCalendarEventResponse>(
      accessToken,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      { method: "POST", body: JSON.stringify(payload) }
    );
  }
  if (!response.id || !response.htmlLink) {
    throw new Error("Google Calendar did not return an event link.");
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      calendarEventId: response.id,
      calendarEventUrl: response.htmlLink,
      calendarSyncedAt: new Date()
    }
  });

  return { created, eventId: response.id, eventUrl: response.htmlLink };
}

export async function syncMeetingToGoogleCalendar(
  userId: string,
  input: GoogleCalendarMeetingInput,
  existingEventId?: string | null,
): Promise<{ created: boolean; eventId: string; eventUrl: string } | undefined> {
  const connection = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!connection) return undefined;
  const accessToken = await validAccessToken(connection);
  const payload = buildGoogleCalendarMeeting(input);
  let created = !existingEventId;
  const target = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingEventId)}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  let response: GoogleCalendarEventResponse;
  try {
    response = await googleRequest<GoogleCalendarEventResponse>(accessToken, target, {
      method: created ? "POST" : "PATCH",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!existingEventId || !(error instanceof Error) || !error.message.endsWith(": 404")) throw error;
    created = true;
    response = await googleRequest<GoogleCalendarEventResponse>(
      accessToken,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      { method: "POST", body: JSON.stringify(payload) },
    );
  }
  if (!response.id || !response.htmlLink) throw new Error("Google Calendar did not return an event link.");
  return { created, eventId: response.id, eventUrl: response.htmlLink };
}

export async function removeMeetingFromGoogleCalendar(userId: string, eventId: string): Promise<void> {
  const connection = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Reconnect Google Calendar before removing this event.");
  const accessToken = await validAccessToken(connection);
  try {
    await googleRequest<void>(
      accessToken,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.endsWith(": 404")) throw error;
  }
}

export async function removeTaskFromGoogleCalendar(userId: string, task: CalendarTask): Promise<{ removed: boolean }> {
  if (!task.calendarEventId) return { removed: false };
  const connection = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Reconnect Google Calendar before removing this event.");
  const accessToken = await validAccessToken(connection);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(task.calendarEventId)}`;
  try {
    await googleRequest<void>(accessToken, url, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.endsWith(": 404")) throw error;
  }
  await prisma.task.update({
    where: { id: task.id },
    data: { calendarEventId: null, calendarEventUrl: null, calendarSyncedAt: null }
  });
  return { removed: true };
}

export async function syncTaskCalendarBestEffort(userId: string, task: CalendarTask): Promise<"synced" | "removed" | "skipped" | "failed"> {
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { calendarAutoSync: true } });
  if (!task.calendarEventId && !settings?.calendarAutoSync) return "skipped";
  try {
    if (!task.dueAt || task.status === TaskStatus.CANCELED) {
      if (task.calendarEventId) {
        await removeTaskFromGoogleCalendar(userId, task);
        return "removed";
      }
      return "skipped";
    }
    const synced = await syncTaskToGoogleCalendar(userId, task);
    return synced ? "synced" : "skipped";
  } catch (error) {
    logger.warn("Automatic Google Calendar sync failed without blocking the Threadwise task change.", {
      userId,
      taskId: task.id,
      error: String(error)
    });
    return "failed";
  }
}

export async function syncEligibleTasksToGoogleCalendar(userId: string, limit = 100): Promise<{ synced: number; failed: number }> {
  const connection = await prisma.calendarConnection.findUnique({ where: { userId }, select: { id: true } });
  if (!connection) throw new Error("Connect Google Calendar first.");
  const tasks = await prisma.task.findMany({
    where: { userId, status: TaskStatus.OPEN, archivedAt: null, dueAt: { not: null } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: limit
  });
  let synced = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      await syncTaskToGoogleCalendar(userId, task);
      synced += 1;
    } catch (error) {
      failed += 1;
      logger.warn("An existing task could not be synced to Google Calendar.", { userId, taskId: task.id, error: String(error) });
    }
  }
  return { synced, failed };
}

export function buildGoogleCalendarEvent(input: GoogleCalendarEventInput) {
  const start = DateTime.fromJSDate(input.dueAt).setZone(input.timezone);
  const end = start.plus({ minutes: 30 });
  return {
    summary: input.title,
    description: input.details ?? "",
    start: { dateTime: start.toISO(), timeZone: input.timezone },
    end: { dateTime: end.toISO(), timeZone: input.timezone },
    ...(input.recurrenceRule ? { recurrence: [googleRecurrenceRule(input.recurrenceRule, start)] } : {}),
    extendedProperties: { private: { threadwise: "true" } }
  };
}

export function buildGoogleCalendarMeeting(input: GoogleCalendarMeetingInput) {
  const start = DateTime.fromJSDate(input.startAt).setZone(input.timezone);
  const end = DateTime.fromJSDate(input.endAt).setZone(input.timezone);
  if (!start.isValid || !end.isValid || end <= start) throw new Error("The meeting time is invalid.");
  return {
    summary: input.title,
    description: input.details ?? "",
    start: { dateTime: start.toISO(), timeZone: input.timezone },
    end: { dateTime: end.toISO(), timeZone: input.timezone },
    extendedProperties: { private: { threadwise: "true", threadwiseKind: "group-meeting" } },
  };
}

function googleRecurrenceRule(rule: RecurrenceRule, dueAt: DateTime): string {
  if (rule === RecurrenceRule.DAILY) return "RRULE:FREQ=DAILY";
  if (rule === RecurrenceRule.WEEKLY) return `RRULE:FREQ=WEEKLY;BYDAY=${dueAt.toFormat("ccc").slice(0, 2).toUpperCase()}`;
  if (rule === RecurrenceRule.MONTHLY) return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dueAt.day}`;
  return `RRULE:FREQ=YEARLY;BYMONTH=${dueAt.month};BYMONTHDAY=${dueAt.day}`;
}

async function validAccessToken(connection: { id: string; accessToken?: string | null; refreshToken: string; accessTokenExpiresAt?: Date | null }): Promise<string> {
  if (connection.accessToken && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return unprotectToken(connection.accessToken);
  }

  const tokens = await refreshAccessToken(unprotectToken(connection.refreshToken));
  if (!tokens.access_token) {
    throw new Error(tokens.error_description ?? tokens.error ?? "Could not refresh Google Calendar access token.");
  }

  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: protectToken(tokens.access_token),
      accessTokenExpiresAt: expiresAt(tokens.expires_in)
    }
  });
  return tokens.access_token;
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  return tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: calendarRedirectUri() ?? "",
    grant_type: "authorization_code"
  });
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    grant_type: "refresh_token"
  });
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  return response.json() as Promise<GoogleTokens>;
}

async function googleGet<T>(accessToken: string, url: string): Promise<T> {
  return googleRequest<T>(accessToken, url);
}

async function googleRequest<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    throw new Error(`Google Calendar API request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function withConnectionResult(returnTo: string, provider: string, result: "connected" | "error"): string {
  try {
    const url = new URL(returnTo);
    if (url.protocol !== "https:") return returnTo;
    url.searchParams.set("connection", provider);
    url.searchParams.set("result", result);
    return url.toString();
  } catch {
    return returnTo;
  }
}

function calendarRedirectUri(): string | undefined {
  if (env.GOOGLE_CALENDAR_REDIRECT_URI) {
    return env.GOOGLE_CALENDAR_REDIRECT_URI;
  }
  return env.WEBHOOK_URL ? `${env.WEBHOOK_URL.replace(/\/$/, "")}/calendar/oauth/callback` : undefined;
}

function expiresAt(expiresInSeconds?: number): Date | undefined {
  return expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : undefined;
}

function protectToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["gcm1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function unprotectToken(value: string): string {
  if (!value.startsWith("gcm1:")) {
    return value;
  }
  const [, ivText, tagText, encryptedText] = value.split(":");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("Malformed encrypted Google Calendar token.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

function tokenKey(): Buffer {
  const secret = tokenEncryptionSecret();
  if (!secret) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is required for Google Calendar.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function tokenEncryptionSecret(): string | undefined {
  return env.GOOGLE_TOKEN_ENCRYPTION_KEY;
}
