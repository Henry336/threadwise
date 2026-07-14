import crypto from "crypto";
import type { Bot } from "grammy";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, code, h, HTML_REPLY } from "../utils/html";

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
};

export function calendarConfigured(): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    calendarRedirectUri() &&
    tokenEncryptionSecret()
  );
}

export async function createCalendarConnectUrl(userId: string, chatId: string): Promise<string> {
  if (!calendarConfigured()) {
    throw new Error("Google Calendar is not configured. Add the Google OAuth credentials, Calendar redirect URI, and token encryption key.");
  }

  const state = crypto.randomBytes(24).toString("hex");
  await prisma.pendingCalendarOAuth.create({
    data: {
      userId,
      state,
      chatId,
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

export async function handleCalendarOAuthCallback(bot: Bot, query: { code?: string; state?: string; error?: string }): Promise<string> {
  if (query.error) {
    return `Google Calendar connection failed: ${query.error}`;
  }
  if (!query.code || !query.state) {
    return "Google Calendar connection failed: missing code or state.";
  }

  const pending = await prisma.pendingCalendarOAuth.findFirst({
    where: { state: query.state, expiresAt: { gt: new Date() } }
  });
  if (!pending) {
    return "Google Calendar connection expired. Return to Telegram and run /calendar connect again.";
  }

  try {
    const tokens = await exchangeCodeForTokens(query.code);
    const existing = await prisma.calendarConnection.findUnique({ where: { userId: pending.userId } });
    const refreshToken = tokens.refresh_token ?? (existing ? unprotectToken(existing.refreshToken) : undefined);
    if (!tokens.access_token || !refreshToken) {
      return "Google Calendar did not return offline access. Run /calendar connect again and approve Calendar access.";
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
      prisma.pendingCalendarOAuth.deleteMany({ where: { userId: pending.userId } })
    ]);

    await bot.api.sendMessage(
      pending.chatId,
      `Google Calendar connected${profile.email ? ` for ${profile.email}` : ""}.\n\nUse /calendar 1 to add or update a dated task in your primary calendar.`,
      HTML_REPLY
    );
    return "Google Calendar connected. You can close this page and return to Telegram.";
  } catch (error) {
    logger.error("Google Calendar OAuth callback failed.", { error: String(error) });
    return "Google Calendar connection failed. Return to Telegram and try /calendar connect again.";
  }
}

export async function disconnectCalendar(userId: string): Promise<string> {
  await prisma.$transaction([
    prisma.calendarConnection.deleteMany({ where: { userId } }),
    prisma.pendingCalendarOAuth.deleteMany({ where: { userId } })
  ]);
  return "Google Calendar disconnected. Existing calendar events are left in Google Calendar.";
}

export async function formatCalendarStatus(userId: string): Promise<string> {
  const connection = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!connection) {
    return [
      bold("📅 Google Calendar"),
      calendarConfigured()
        ? `${code("/calendar connect")} to add dated tasks directly to your primary calendar.`
        : "Google Calendar connection setup is not available on this deployment yet.",
      "",
      `${code("/calendar connect")} - connect Google Calendar`,
      `${code("/calendar 1")} - add or update a dated task`,
      `${code("/calendar disconnect")} - remove the connection`,
      `${code("/googlecal 1")} - get a no-login template link`
    ].join("\n");
  }

  return [
    bold("📅 Google Calendar"),
    `${bold("Account")} ${h(connection.calendarEmail ?? "connected")}`,
    `${bold("Target")} primary calendar`,
    "",
    `${code("/calendar 1")} - add or update a dated task`,
    `${code("/calendar disconnect")} - remove the connection`
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
    timezone: task.timezone ?? "UTC"
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

export function buildGoogleCalendarEvent(input: GoogleCalendarEventInput) {
  const start = DateTime.fromJSDate(input.dueAt).setZone(input.timezone);
  const end = start.plus({ minutes: 30 });
  return {
    summary: input.title,
    description: input.details ?? "",
    start: { dateTime: start.toISO(), timeZone: input.timezone },
    end: { dateTime: end.toISO(), timeZone: input.timezone },
    extendedProperties: { private: { threadwise: "true" } }
  };
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
  return response.json() as Promise<T>;
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
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY or GMAIL_TOKEN_ENCRYPTION_KEY is required for Google Calendar.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function tokenEncryptionSecret(): string | undefined {
  return env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? env.GMAIL_TOKEN_ENCRYPTION_KEY;
}
