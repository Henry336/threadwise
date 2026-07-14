import crypto from "crypto";
import ExcelJS from "exceljs";
import type { Bot } from "grammy";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, code, h, HTML_REPLY } from "../utils/html";
import { EXPENSE_COLUMNS, expenseRowValues } from "./expenses";

const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Files.ReadWrite"];
const DEFAULT_WORKBOOK_NAME = "Threadwise Expenses.xlsx";
const DEFAULT_TABLE_NAME = "Expenses";

type MicrosoftTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type DriveItem = {
  id: string;
  name?: string;
  webUrl?: string;
  file?: unknown;
  parentReference?: { driveId?: string };
};

type WorkbookTables = { value?: Array<{ name?: string }> };
type WorkbookColumns = { value?: Array<{ name?: string }> };

export function microsoftExcelConfigured(): boolean {
  return Boolean(
    env.MICROSOFT_CLIENT_ID &&
    env.MICROSOFT_CLIENT_SECRET &&
    microsoftRedirectUri() &&
    env.MICROSOFT_TOKEN_ENCRYPTION_KEY
  );
}

export async function createMicrosoftConnectUrl(userId: string, chatId: string): Promise<string> {
  if (!microsoftExcelConfigured()) {
    throw new Error("Excel integration is not configured on the server yet.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  await prisma.pendingMicrosoftOAuth.create({
    data: { userId, state, chatId, expiresAt: new Date(Date.now() + 15 * 60_000) }
  });
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", env.MICROSOFT_CLIENT_ID ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", microsoftRedirectUri() ?? "");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleMicrosoftOAuthCallback(bot: Bot, query: { code?: string; state?: string; error?: string; error_description?: string }): Promise<string> {
  if (query.error) return `Microsoft connection failed: ${query.error_description ?? query.error}`;
  if (!query.code || !query.state) return "Microsoft connection failed: missing code or state.";
  const pending = await prisma.pendingMicrosoftOAuth.findFirst({
    where: { state: query.state, expiresAt: { gt: new Date() } }
  });
  if (!pending) return "Microsoft connection expired. Return to Telegram and run /excel connect again.";

  try {
    const tokens = await exchangeCodeForTokens(query.code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return "Microsoft did not return offline access. Run /excel connect again and approve file access.";
    }
    const profile = await graphRequest<{ mail?: string; userPrincipalName?: string }>(tokens.access_token, "/me?$select=mail,userPrincipalName");
    await prisma.$transaction([
      prisma.microsoftConnection.upsert({
        where: { userId: pending.userId },
        update: {
          microsoftEmail: profile.mail ?? profile.userPrincipalName,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(tokens.refresh_token),
          accessTokenExpiresAt: expiresAt(tokens.expires_in)
        },
        create: {
          userId: pending.userId,
          microsoftEmail: profile.mail ?? profile.userPrincipalName,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(tokens.refresh_token),
          accessTokenExpiresAt: expiresAt(tokens.expires_in)
        }
      }),
      prisma.pendingMicrosoftOAuth.deleteMany({ where: { userId: pending.userId } })
    ]);
    await bot.api.sendMessage(
      pending.chatId,
      `Microsoft connected${profile.mail || profile.userPrincipalName ? ` for ${profile.mail ?? profile.userPrincipalName}` : ""}.\n\nUse /excel create and Threadwise will make the expense workbook for you.`,
      HTML_REPLY
    );
    return "Microsoft connected. You can close this page and return to Telegram.";
  } catch (error) {
    logger.error("Microsoft OAuth callback failed.", { error: String(error) });
    return "Microsoft connection failed. Return to Telegram and try /excel connect again.";
  }
}

export async function disconnectMicrosoft(userId: string): Promise<string> {
  await prisma.$transaction([
    prisma.microsoftConnection.deleteMany({ where: { userId } }),
    prisma.pendingMicrosoftOAuth.deleteMany({ where: { userId } })
  ]);
  return "Excel disconnected. Your Threadwise expenses and existing OneDrive workbook are unchanged.";
}

export async function formatExcelStatus(userId: string): Promise<string> {
  const connection = await prisma.microsoftConnection.findUnique({ where: { userId } });
  if (!connection) {
    return [
      bold("📊 Excel"),
      microsoftExcelConfigured()
        ? `${code("/excel connect")} to connect Microsoft, then ${code("/excel create")} to let Threadwise make your workbook.`
        : "Excel connection setup is not available on this deployment yet.",
      "",
      `${code("/expenses")} always works because Threadwise stores expenses itself.`,
      `${code("/excel export")} downloads a standalone workbook without Microsoft sign-in.`
    ].join("\n");
  }

  return [
    bold("📊 Excel"),
    `${bold("Microsoft account")} ${h(connection.microsoftEmail ?? "connected")}`,
    `${bold("Workbook")} ${connection.workbookName ? h(connection.workbookName) : "not selected"}`,
    connection.workbookWebUrl ? h(connection.workbookWebUrl) : undefined,
    "",
    connection.workbookDriveItemId
      ? `${code("/excel sync")} sends unsynced Threadwise expenses to this workbook.`
      : `${code("/excel create")} lets Threadwise create the recommended workbook.`
  ].filter(Boolean).join("\n");
}

export async function createExpenseWorkbook(userId: string, timezone: string) {
  const connection = await requireConnection(userId);
  if (connection.workbookDriveItemId) {
    return {
      id: connection.workbookDriveItemId,
      name: connection.workbookName ?? DEFAULT_WORKBOOK_NAME,
      webUrl: connection.workbookWebUrl ?? undefined,
      parentReference: { driveId: connection.workbookDriveId ?? undefined }
    } satisfies DriveItem;
  }
  const accessToken = await validAccessToken(connection);
  const expenses = await prisma.expense.findMany({ where: { userId }, orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }] });
  const workbook = await buildExpenseWorkbook(expenses, timezone);
  // A timestamped name keeps /excel create from silently replacing a file the
  // user may already have called "Threadwise Expenses.xlsx" in OneDrive.
  const workbookName = `Threadwise Expenses ${workbookTimestamp(new Date())}.xlsx`;
  const item = await graphAbsolute<DriveItem>(
    accessToken,
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(workbookName)}:/content`,
    { method: "PUT", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: workbook }
  );
  await prisma.microsoftConnection.update({
    where: { userId },
    data: {
      workbookDriveItemId: item.id,
      workbookDriveId: item.parentReference?.driveId,
      workbookWebUrl: item.webUrl,
      workbookName: item.name ?? workbookName,
      tableName: DEFAULT_TABLE_NAME
    }
  });
  if (expenses.length) {
    await prisma.expense.updateMany({ where: { userId }, data: { excelSyncedAt: new Date() } });
  }
  return item;
}

export async function linkExpenseWorkbook(userId: string, sharingUrl: string) {
  const connection = await requireConnection(userId);
  const accessToken = await validAccessToken(connection);
  const shareId = `u!${Buffer.from(sharingUrl, "utf8").toString("base64url")}`;
  const item = await graphRequest<DriveItem>(accessToken, `/shares/${shareId}/driveItem?$select=id,name,webUrl,file,parentReference`);
  if (!item.name?.toLowerCase().endsWith(".xlsx") || !item.parentReference?.driveId) {
    throw new Error("That link does not point to a supported .xlsx workbook in OneDrive or SharePoint.");
  }
  const tables = await graphAbsolute<WorkbookTables>(
    accessToken,
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}/workbook/tables`
  );
  if (!(tables.value ?? []).some((table) => table.name?.toLowerCase() === DEFAULT_TABLE_NAME.toLowerCase())) {
    throw new Error(`That workbook needs an Excel table named ${DEFAULT_TABLE_NAME}. The easiest option is /excel create, which sets everything up automatically.`);
  }
  const columns = await graphAbsolute<WorkbookColumns>(
    accessToken,
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}/workbook/tables/${DEFAULT_TABLE_NAME}/columns?$select=name`
  );
  const columnNames = (columns.value ?? []).map((column) => column.name ?? "");
  if (columnNames.length !== EXPENSE_COLUMNS.length || EXPENSE_COLUMNS.some((name, index) => columnNames[index] !== name)) {
    throw new Error(`The ${DEFAULT_TABLE_NAME} table columns do not match Threadwise's expense template. Use /excel create for the simplest setup.`);
  }
  await prisma.microsoftConnection.update({
    where: { userId },
    data: {
      workbookDriveItemId: item.id,
      workbookDriveId: item.parentReference.driveId,
      workbookWebUrl: item.webUrl,
      workbookName: item.name,
      tableName: DEFAULT_TABLE_NAME
    }
  });
  return item;
}

export async function syncExpenseToExcel(userId: string, expenseId: string, timezone: string) {
  const connection = await requireWorkbook(userId);
  const expense = await prisma.expense.findFirstOrThrow({ where: { id: expenseId, userId } });
  const accessToken = await validAccessToken(connection);
  await addRows(accessToken, connection, [expenseRowValues(expense, timezone)]);
  return prisma.expense.update({ where: { id: expense.id }, data: { excelSyncedAt: new Date() } });
}

export async function syncUnsyncedExpenses(userId: string, timezone: string): Promise<number> {
  const connection = await requireWorkbook(userId);
  const expenses = await prisma.expense.findMany({
    where: { userId, excelSyncedAt: null },
    orderBy: [{ transactionAt: "asc" }, { createdAt: "asc" }],
    take: 200
  });
  if (!expenses.length) return 0;
  const accessToken = await validAccessToken(connection);
  await addRows(accessToken, connection, expenses.map((expense) => expenseRowValues(expense, timezone)));
  await prisma.expense.updateMany({ where: { id: { in: expenses.map((expense) => expense.id) } }, data: { excelSyncedAt: new Date() } });
  return expenses.length;
}

export async function exportExpensesWorkbook(userId: string, timezone: string): Promise<Buffer> {
  const expenses = await prisma.expense.findMany({
    where: { userId },
    orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }]
  });
  return buildExpenseWorkbook(expenses, timezone);
}

export async function buildExpenseWorkbook(expenses: Array<Parameters<typeof expenseRowValues>[0]>, timezone: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Threadwise";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Expenses", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addTable({
    name: DEFAULT_TABLE_NAME,
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: EXPENSE_COLUMNS.map((name) => ({ name })),
    rows: expenses.map((expense) => expenseRowValues(expense, timezone))
  });
  const widths = [14, 18, 24, 16, 28, 12, 12, 12, 12, 10, 18, 12, 16, 24, 26];
  sheet.columns.forEach((column, index) => { column.width = widths[index] ?? 16; });
  sheet.getColumn(6).numFmt = "0.00";
  sheet.getColumn(7).numFmt = "0.00";
  sheet.getColumn(8).numFmt = "0.00";
  sheet.getColumn(9).numFmt = "0.00";
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function workbookTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

async function addRows(accessToken: string, connection: { workbookDriveId?: string | null; workbookDriveItemId?: string | null; tableName: string }, rows: Array<Array<string | number>>) {
  await graphAbsolute(
    accessToken,
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(connection.workbookDriveId ?? "")}/items/${encodeURIComponent(connection.workbookDriveItemId ?? "")}/workbook/tables/${encodeURIComponent(connection.tableName)}/rows/add`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: null, values: rows }) }
  );
}

async function requireConnection(userId: string) {
  const connection = await prisma.microsoftConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Microsoft is not connected. Use /excel connect first.");
  return connection;
}

async function requireWorkbook(userId: string) {
  const connection = await requireConnection(userId);
  if (!connection.workbookDriveItemId || !connection.workbookDriveId) {
    throw new Error("No Excel workbook is selected. Use /excel create first, or /excel use <OneDrive link>.");
  }
  return connection;
}

async function validAccessToken(connection: { id: string; accessToken?: string | null; refreshToken: string; accessTokenExpiresAt?: Date | null }) {
  if (connection.accessToken && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return unprotectToken(connection.accessToken);
  }
  const tokens = await tokenRequest({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
    refresh_token: unprotectToken(connection.refreshToken),
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES.join(" ")
  });
  if (!tokens.access_token) throw new Error(tokens.error_description ?? tokens.error ?? "Could not refresh Microsoft access.");
  await prisma.microsoftConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: protectToken(tokens.access_token),
      refreshToken: tokens.refresh_token ? protectToken(tokens.refresh_token) : undefined,
      accessTokenExpiresAt: expiresAt(tokens.expires_in)
    }
  });
  return tokens.access_token;
}

async function exchangeCodeForTokens(code: string): Promise<MicrosoftTokens> {
  return tokenRequest({
    client_id: env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
    code,
    redirect_uri: microsoftRedirectUri() ?? "",
    grant_type: "authorization_code"
  });
}

async function tokenRequest(params: Record<string, string>): Promise<MicrosoftTokens> {
  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  return response.json() as Promise<MicrosoftTokens>;
}

async function graphRequest<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  return graphAbsolute(accessToken, `https://graph.microsoft.com/v1.0${path}`, init);
}

async function graphAbsolute<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers }
  });
  if (!response.ok) {
    const detail = await response.text();
    logger.error("Microsoft Graph request failed.", { status: response.status, detail: detail.slice(0, 500) });
    throw new Error(`Microsoft Excel request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function microsoftRedirectUri(): string | undefined {
  if (env.MICROSOFT_REDIRECT_URI) return env.MICROSOFT_REDIRECT_URI;
  return env.WEBHOOK_URL ? `${env.WEBHOOK_URL.replace(/\/$/, "")}/excel/oauth/callback` : undefined;
}

function expiresAt(seconds?: number): Date | undefined {
  return seconds ? new Date(Date.now() + seconds * 1000) : undefined;
}

function protectToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["gcm1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function unprotectToken(value: string): string {
  if (!value.startsWith("gcm1:")) return value;
  const [, ivText, tagText, encryptedText] = value.split(":");
  if (!ivText || !tagText || !encryptedText) throw new Error("Malformed encrypted Microsoft token.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

function tokenKey(): Buffer {
  if (!env.MICROSOFT_TOKEN_ENCRYPTION_KEY) throw new Error("MICROSOFT_TOKEN_ENCRYPTION_KEY is required for Excel.");
  return crypto.createHash("sha256").update(env.MICROSOFT_TOKEN_ENCRYPTION_KEY).digest();
}
