import crypto from "crypto";
import type { Bot } from "grammy";
import { DateTime } from "luxon";
import { TaskStatus } from "@prisma/client";
import type { AiProvider, EmailForSummary, EmailSummaryItem } from "../ai/types";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { formatDateTimeForUser, startOfUserDay } from "../utils/dates";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { nextPublicId } from "./publicIds";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email"
];
const IMPORTANT_EMAIL_WORDS = [
  "action required",
  "approval",
  "bank",
  "contract",
  "deadline",
  "document",
  "due",
  "follow up",
  "important",
  "interview",
  "invoice",
  "meeting",
  "password",
  "payment",
  "reply",
  "security",
  "urgent",
  "verify"
];

type GmailTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId?: string }>;
};

type GmailMessageResponse = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
};

type GmailScanResult = {
  scanned: number;
  newItems: number;
  important: number;
  message: string;
};

export function gmailConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && gmailRedirectUri() && env.GMAIL_TOKEN_ENCRYPTION_KEY);
}

export async function createGmailConnectUrl(userId: string, chatId: string): Promise<string> {
  if (!gmailConfigured()) {
    throw new Error("Gmail integration is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and GMAIL_TOKEN_ENCRYPTION_KEY.");
  }

  const state = crypto.randomBytes(24).toString("hex");
  await prisma.pendingGmailOAuth.create({
    data: {
      userId,
      state,
      chatId,
      expiresAt: new Date(Date.now() + 15 * 60_000)
    }
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", gmailRedirectUri() ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleGmailOAuthCallback(bot: Bot, query: { code?: string; state?: string; error?: string }): Promise<string> {
  if (query.error) {
    return `Gmail connection failed: ${query.error}`;
  }

  if (!query.code || !query.state) {
    return "Gmail connection failed: missing code or state.";
  }

  const pending = await prisma.pendingGmailOAuth.findFirst({
    where: {
      state: query.state,
      expiresAt: { gt: new Date() }
    },
    include: { user: { include: { settings: true } } }
  });

  if (!pending) {
    return "Gmail connection expired. Go back to Telegram and run /gmail connect again.";
  }

  try {
    const tokens = await exchangeCodeForTokens(query.code);
    if (!tokens.refresh_token || !tokens.access_token) {
      return "Gmail did not return the required access. Run /gmail connect again and approve offline access.";
    }

    const profile = await gmailGet<{ emailAddress?: string }>(tokens.access_token, "/gmail/v1/users/me/profile");
    await prisma.$transaction([
      prisma.gmailConnection.upsert({
        where: { userId: pending.userId },
        update: {
          gmailEmail: profile.emailAddress,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(tokens.refresh_token),
          accessTokenExpiresAt: expiresAt(tokens.expires_in),
          scanEnabled: true,
          scanHourLocal: env.GMAIL_DAILY_SCAN_HOUR,
          summaryChatId: pending.chatId
        },
        create: {
          userId: pending.userId,
          gmailEmail: profile.emailAddress,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(tokens.refresh_token),
          accessTokenExpiresAt: expiresAt(tokens.expires_in),
          scanHourLocal: env.GMAIL_DAILY_SCAN_HOUR,
          summaryChatId: pending.chatId
        }
      }),
      prisma.pendingGmailOAuth.deleteMany({ where: { userId: pending.userId } })
    ]);

    await bot.api.sendMessage(
      pending.chatId,
      `Gmail connected${profile.emailAddress ? ` for ${profile.emailAddress}` : ""}.\n\nUse /gmail scan to scan unread mail now.`,
      HTML_REPLY
    );
    return "Gmail connected. You can close this page and return to Telegram.";
  } catch (error) {
    logger.error("Gmail OAuth callback failed.", { error: String(error) });
    return "Gmail connection failed. Return to Telegram and try /gmail connect again.";
  }
}

export async function disconnectGmail(userId: string): Promise<string> {
  await prisma.$transaction([
    prisma.gmailConnection.deleteMany({ where: { userId } }),
    prisma.pendingGmailOAuth.deleteMany({ where: { userId } })
  ]);
  return "Gmail disconnected. Existing email summaries and reminder tasks are left alone.";
}

export async function formatGmailStatus(userId: string): Promise<string> {
  const connection = await prisma.gmailConnection.findUnique({ where: { userId } });
  if (!connection) {
    return [
      bold("Gmail"),
      gmailConfigured()
        ? `${code("/gmail connect")} to scan unread Gmail summaries each day.`
        : "Gmail is not configured on the server yet.",
      "",
      bold("Commands"),
      `${code("/gmail connect")} - connect Gmail with Google OAuth`,
      `${code("/gmail scan")} - scan unread mail now`,
      `${code("/gmail disconnect")} - remove the Gmail connection`
    ].join("\n");
  }

  return [
    bold("Gmail"),
    `${bold("Account")} ${h(connection.gmailEmail ?? "connected")}`,
    `${bold("Daily scan")} ${connection.scanEnabled ? `around ${connection.scanHourLocal}:00` : "off"}`,
    `${bold("Last scan")} ${connection.lastScanAt ? h(formatDateTimeForUser(connection.lastScanAt, "UTC")) : "never"}`,
    "",
    `${code("/gmail scan")} - scan unread mail now`,
    `${code("/gmail disconnect")} - remove the connection`
  ].join("\n");
}

export async function scanGmailNow(userId: string, ai: AiProvider, bot?: Bot): Promise<GmailScanResult> {
  const connection = await prisma.gmailConnection.findUnique({
    where: { userId },
    include: { user: { include: { settings: true } } }
  });
  if (!connection) {
    return { scanned: 0, newItems: 0, important: 0, message: "Gmail is not connected. Use /gmail connect first." };
  }

  const accessToken = await validAccessToken(connection);
  const messages = await fetchUnreadEmails(accessToken, env.GMAIL_MAX_UNREAD_PER_SCAN);
  const newMessages = [];
  for (const message of messages) {
    const existing = await prisma.gmailMessageSummary.findUnique({
      where: { userId_gmailMessageId: { userId, gmailMessageId: message.messageId } }
    });
    if (!existing) {
      newMessages.push(message);
    }
  }

  if (newMessages.length === 0) {
    await prisma.gmailConnection.update({ where: { userId }, data: { lastScanAt: new Date() } });
    return {
      scanned: messages.length,
      newItems: 0,
      important: 0,
      message: messages.length ? "No new unread Gmail messages since the last scan." : "No unread Gmail messages found."
    };
  }

  const digest = await summarizeEmailsWithDeterministicGate(newMessages, ai);
  const savedItems: EmailSummaryItem[] = [];
  for (const item of digest.items) {
    const source = newMessages.find((message) => message.messageId === item.messageId);
    if (!source) continue;

    const reminderTaskId = item.important
      ? await createImportantEmailTask(userId, item, source, connection.user.settings?.timezone ?? "UTC", connection.user.settings?.reminderIntervalMinutes ?? 180)
      : undefined;

    await prisma.gmailMessageSummary.upsert({
      where: { userId_gmailMessageId: { userId, gmailMessageId: item.messageId } },
      update: {},
      create: {
        userId,
        gmailMessageId: item.messageId,
        gmailThreadId: source.threadId,
        from: item.from,
        subject: item.subject,
        snippet: source.snippet,
        summary: item.summary,
        important: item.important,
        importanceReason: item.importanceReason,
        suggestedAction: item.suggestedAction,
        receivedAt: source.receivedAt ? new Date(source.receivedAt) : undefined,
        reminderTaskId
      }
    });
    savedItems.push(item);
  }

  await prisma.gmailConnection.update({ where: { userId }, data: { lastScanAt: new Date() } });
  const important = savedItems.filter((item) => item.important).length;
  const message = formatGmailDigest(digest.overview, savedItems);
  if (bot && connection.summaryChatId) {
    await bot.api.sendMessage(connection.summaryChatId, message, HTML_REPLY);
  }

  return { scanned: messages.length, newItems: savedItems.length, important, message };
}

export function startGmailScanLoop(bot: Bot, ai: AiProvider, pollMs: number): NodeJS.Timeout | undefined {
  if (!gmailConfigured()) {
    logger.info("Gmail scan loop disabled; Google OAuth env vars are not configured.");
    return undefined;
  }

  const interval = setInterval(() => {
    scanDueGmailConnections(bot, ai).catch((error) => logger.error("Gmail scan loop failed.", { error: String(error) }));
  }, pollMs);

  void scanDueGmailConnections(bot, ai).catch((error) => logger.error("Initial Gmail scan pass failed.", { error: String(error) }));
  return interval;
}

async function scanDueGmailConnections(bot: Bot, ai: AiProvider): Promise<number> {
  const connections = await prisma.gmailConnection.findMany({
    where: { scanEnabled: true },
    include: { user: { include: { settings: true } } },
    take: 25
  });

  let scanned = 0;
  const now = new Date();
  for (const connection of connections) {
    const timezone = connection.user.settings?.timezone ?? "UTC";
    const localNow = DateTime.fromJSDate(now).setZone(timezone);
    if (localNow.hour < connection.scanHourLocal) {
      continue;
    }

    if (connection.lastScanAt && connection.lastScanAt >= startOfUserDay(now, timezone)) {
      continue;
    }

    await scanGmailNow(connection.userId, ai, bot);
    scanned += 1;
  }

  return scanned;
}

async function createImportantEmailTask(
  userId: string,
  item: EmailSummaryItem,
  source: EmailForSummary,
  timezone: string,
  intervalMinutes: number
): Promise<string> {
  const publicId = await nextPublicId(userId, "TASK");
  const title = item.suggestedAction || `Review email: ${item.subject}`;
  const task = await prisma.task.create({
    data: {
      userId,
      publicId,
      title: title.slice(0, 160),
      description: [item.summary, item.importanceReason ? `Why important: ${item.importanceReason}` : undefined, `From: ${item.from}`].filter(Boolean).join("\n"),
      status: TaskStatus.OPEN,
      sourceText: `Gmail unread message ${source.messageId}: ${source.subject}\n${source.snippet}`,
      timezone,
      reminderIntervalMinutes: intervalMinutes,
      nextReminderAt: new Date()
    }
  });
  return task.id;
}

function formatGmailDigest(overview: string, items: EmailSummaryItem[]): string {
  if (items.length === 0) {
    return "No unread Gmail messages found.";
  }

  const important = items.filter((item) => item.important);
  const normal = items.filter((item) => !item.important);
  return [
    bold("Gmail scan"),
    h(overview),
    important.length ? ["", bold("Important"), ...important.map(formatEmailItem)].join("\n") : undefined,
    normal.length ? ["", bold("Other unread"), ...normal.slice(0, 5).map(formatEmailItem)].join("\n") : undefined,
    important.length ? ["", `${code("/tasks")} now includes follow-up reminders for important emails.`].join("\n") : undefined
  ].filter(Boolean).join("\n");
}

function formatEmailItem(item: EmailSummaryItem): string {
  return [
    `${bold(item.subject || "(no subject)")}`,
    `${h(item.from)}`,
    h(item.summary),
    item.important && item.importanceReason ? `${bold("Why")} ${h(item.importanceReason)}` : undefined
  ].filter(Boolean).join("\n");
}

export async function summarizeEmailsWithDeterministicGate(emails: EmailForSummary[], ai: AiProvider) {
  const localDigest = summarizeEmailsDeterministically(emails);
  const importantCandidates = emails.filter(hasImportantEmailSignal);
  if (importantCandidates.length === 0) {
    return localDigest;
  }

  const aiDigest = await ai.summarizeEmails(importantCandidates);
  const aiItems = new Map(aiDigest.items.map((item) => [item.messageId, item]));
  const items = localDigest.items.map((item) => {
    const aiItem = aiItems.get(item.messageId);
    if (!aiItem) {
      return item;
    }

    return {
      ...aiItem,
      important: aiItem.important || item.important,
      importanceReason: aiItem.importanceReason ?? item.importanceReason,
      suggestedAction: aiItem.suggestedAction ?? item.suggestedAction
    };
  });
  const importantCount = items.filter((item) => item.important).length;

  return {
    overview: `${emails.length} unread email${emails.length === 1 ? "" : "s"} scanned; ${importantCount} looked important.`,
    items
  };
}

export function summarizeEmailsDeterministically(emails: EmailForSummary[]) {
  const items = emails.map((email) => {
    const important = hasImportantEmailSignal(email);
    return {
      messageId: email.messageId,
      subject: email.subject || "(no subject)",
      from: email.from || "Unknown sender",
      summary: summarizeEmailText(email.snippet || email.body, 180),
      important,
      importanceReason: important ? "Contains action, deadline, account, payment, meeting, or reply language." : undefined,
      suggestedAction: important ? `Review: ${email.subject || "unread email"}` : undefined
    };
  });
  const importantCount = items.filter((item) => item.important).length;

  return {
    overview: `${emails.length} unread email${emails.length === 1 ? "" : "s"} scanned; ${importantCount} looked important.`,
    items
  };
}

function hasImportantEmailSignal(email: EmailForSummary): boolean {
  const text = `${email.from} ${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
  return IMPORTANT_EMAIL_WORDS.some((word) => hasTerm(text, word));
}

function summarizeEmailText(text: string, maxLength: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed || "(no preview available)";
  }

  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

async function fetchUnreadEmails(accessToken: string, maxResults: number): Promise<EmailForSummary[]> {
  const list = await gmailGet<GmailListResponse>(accessToken, `/gmail/v1/users/me/messages?q=${encodeURIComponent("is:unread")}&maxResults=${maxResults}`);
  const ids = list.messages ?? [];
  const messages: EmailForSummary[] = [];
  for (const item of ids) {
    const message = await gmailGet<GmailMessageResponse>(accessToken, `/gmail/v1/users/me/messages/${item.id}?format=full`);
    messages.push({
      messageId: message.id,
      threadId: message.threadId,
      from: headerValue(message.payload, "From") || "Unknown sender",
      subject: headerValue(message.payload, "Subject") || "(no subject)",
      snippet: message.snippet ?? "",
      body: extractTextBody(message.payload).slice(0, 4000),
      receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined
    });
  }

  return messages;
}

async function validAccessToken(connection: { id: string; accessToken?: string | null; refreshToken: string; accessTokenExpiresAt?: Date | null }): Promise<string> {
  if (connection.accessToken && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return unprotectToken(connection.accessToken);
  }

  const tokens = await refreshAccessToken(unprotectToken(connection.refreshToken));
  if (!tokens.access_token) {
    throw new Error(tokens.error_description ?? tokens.error ?? "Could not refresh Gmail access token.");
  }

  await prisma.gmailConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: protectToken(tokens.access_token),
      accessTokenExpiresAt: expiresAt(tokens.expires_in)
    }
  });

  return tokens.access_token;
}

async function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
  return tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: gmailRedirectUri() ?? "",
    grant_type: "authorization_code"
  });
}

async function refreshAccessToken(refreshToken: string): Promise<GmailTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    grant_type: "refresh_token"
  });
}

async function tokenRequest(params: Record<string, string>): Promise<GmailTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });

  return response.json() as Promise<GmailTokens>;
}

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Gmail API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function gmailRedirectUri(): string | undefined {
  if (env.GOOGLE_REDIRECT_URI) {
    return env.GOOGLE_REDIRECT_URI;
  }

  return env.WEBHOOK_URL ? `${env.WEBHOOK_URL.replace(/\/$/, "")}/gmail/oauth/callback` : undefined;
}

function expiresAt(expiresInSeconds?: number): Date | undefined {
  return expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : undefined;
}

function headerValue(payload: GmailPayload | undefined, name: string): string | undefined {
  return payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function extractTextBody(payload: GmailPayload | undefined): string {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const text = extractTextBody(part);
    if (text) return text;
  }

  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function protectToken(token: string): string {
  const key = gmailTokenKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
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
    throw new Error("Malformed encrypted Gmail token.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", gmailTokenKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

function gmailTokenKey(): Buffer {
  if (!env.GMAIL_TOKEN_ENCRYPTION_KEY) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is required for Gmail integration.");
  }

  return crypto.createHash("sha256").update(env.GMAIL_TOKEN_ENCRYPTION_KEY).digest();
}
