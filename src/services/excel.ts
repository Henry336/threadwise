import crypto from "crypto";
import ExcelJS from "exceljs";
import { InlineKeyboard, type Bot } from "grammy";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { bold, h, HTML_REPLY } from "../utils/html";
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

export type MicrosoftConnectOptions = {
  enableAutoSync?: boolean;
  returnTo?: string;
};

export type MicrosoftOAuthCallbackResult = {
  message: string;
  redirectUrl?: string;
};

export function microsoftExcelConfigured(): boolean {
  return Boolean(
    env.MICROSOFT_CLIENT_ID &&
    env.MICROSOFT_CLIENT_SECRET &&
    microsoftRedirectUri() &&
    env.MICROSOFT_TOKEN_ENCRYPTION_KEY
  );
}

export async function createMicrosoftConnectUrl(userId: string, chatId: string, options: MicrosoftConnectOptions = {}): Promise<string> {
  if (!microsoftExcelConfigured()) {
    throw new Error("Excel integration is not configured on the server yet.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  await prisma.pendingMicrosoftOAuth.deleteMany({ where: { userId } });
  await prisma.pendingMicrosoftOAuth.create({
    data: {
      userId,
      state,
      chatId,
      enableAutoSync: options.enableAutoSync ?? true,
      returnTo: options.returnTo,
      expiresAt: new Date(Date.now() + 15 * 60_000)
    }
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

export async function handleMicrosoftOAuthCallback(bot: Bot, query: { code?: string; state?: string; error?: string; error_description?: string }): Promise<MicrosoftOAuthCallbackResult> {
  const pending = query.state
    ? await prisma.pendingMicrosoftOAuth.findFirst({ where: { state: query.state, expiresAt: { gt: new Date() } } })
    : undefined;
  const result = (message: string): MicrosoftOAuthCallbackResult => ({
    message,
    ...(pending?.returnTo ? { redirectUrl: withConnectionResult(pending.returnTo, "excel", message.startsWith("Microsoft Excel connected") ? "connected" : "error") } : {})
  });
  if (query.error) return result(`Microsoft connection failed: ${query.error_description ?? query.error}`);
  if (!query.code || !query.state) return result("Microsoft connection failed because the authorization response was incomplete.");
  if (!pending) return { message: "This Microsoft connection link expired. Open Connections and try again." };

  try {
    const tokens = await exchangeCodeForTokens(query.code);
    const existing = await prisma.microsoftConnection.findUnique({ where: { userId: pending.userId } });
    const refreshToken = tokens.refresh_token ?? (existing ? unprotectToken(existing.refreshToken) : undefined);
    if (!tokens.access_token || !refreshToken) {
      return result("Microsoft did not grant lasting file access. Reconnect and approve the requested permissions.");
    }
    const profile = await graphRequest<{ mail?: string; userPrincipalName?: string }>(tokens.access_token, "/me?$select=mail,userPrincipalName");
    await prisma.$transaction([
      prisma.microsoftConnection.upsert({
        where: { userId: pending.userId },
        update: {
          microsoftEmail: profile.mail ?? profile.userPrincipalName,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(refreshToken),
          accessTokenExpiresAt: expiresAt(tokens.expires_in)
        },
        create: {
          userId: pending.userId,
          microsoftEmail: profile.mail ?? profile.userPrincipalName,
          accessToken: protectToken(tokens.access_token),
          refreshToken: protectToken(refreshToken),
          accessTokenExpiresAt: expiresAt(tokens.expires_in)
        }
      }),
      ...(pending.enableAutoSync
        ? [prisma.userSettings.update({ where: { userId: pending.userId }, data: { excelAutoSync: true } })]
        : []),
      prisma.pendingMicrosoftOAuth.deleteMany({ where: { userId: pending.userId } })
    ]);

    let workbookMessage = "";
    let workbookReady = false;
    let keyboard: InlineKeyboard | undefined;
    try {
      const user = await prisma.user.findUnique({ where: { id: pending.userId }, include: { settings: true } });
      const workbook = await createExpenseWorkbook(pending.userId, user?.settings?.timezone ?? "UTC");
      workbookReady = true;
      workbookMessage = `\n${h(workbook.name ?? DEFAULT_WORKBOOK_NAME)} is ready and existing expenses were imported.`;
      if (workbook.webUrl) keyboard = new InlineKeyboard().url("Open workbook", workbook.webUrl).text("‹ Expenses", "menu:expenses");
    } catch (error) {
      logger.warn("Microsoft connected but workbook setup did not finish.", { userId: pending.userId, error: String(error) });
      workbookMessage = "\nThe account is connected, but the workbook could not be prepared. Open Excel in Connections and tap Create workbook.";
    }

    const email = profile.mail ?? profile.userPrincipalName;
    try {
      await bot.api.sendMessage(
        pending.chatId,
        `Microsoft Excel connected${email ? ` for ${h(email)}` : ""}.${workbookMessage}${pending.enableAutoSync ? "\nNew expenses will sync automatically." : ""}`,
        { ...HTML_REPLY, ...(keyboard ? { reply_markup: keyboard } : {}) }
      );
    } catch (error) {
      logger.warn("Microsoft connected but the Telegram confirmation could not be delivered.", { userId: pending.userId, error: String(error) });
    }
    return result(workbookReady
      ? "Microsoft Excel connected and the expense workbook is ready."
      : "Microsoft Excel connected. Open Connections to finish preparing the workbook.");
  } catch (error) {
    logger.error("Microsoft OAuth callback failed.", { error: String(error) });
    return result("Microsoft connection failed. Open Connections and try again.");
  }
}

export async function disconnectMicrosoft(userId: string): Promise<string> {
  await prisma.$transaction([
    prisma.microsoftConnection.deleteMany({ where: { userId } }),
    prisma.pendingMicrosoftOAuth.deleteMany({ where: { userId } }),
    prisma.userSettings.updateMany({ where: { userId }, data: { excelAutoSync: false } })
  ]);
  return "Excel disconnected. Your Threadwise expenses and existing OneDrive workbook are unchanged.";
}

export async function excelConnectionStatus(userId: string) {
  const [connection, settings, unsyncedExpenses] = await Promise.all([
    prisma.microsoftConnection.findUnique({ where: { userId } }),
    prisma.userSettings.findUnique({ where: { userId }, select: { excelAutoSync: true } }),
    prisma.expense.count({ where: { userId, excelSyncedAt: null } })
  ]);
  return {
    connected: Boolean(connection),
    email: connection?.microsoftEmail ?? undefined,
    autoSync: settings?.excelAutoSync ?? false,
    workbookName: connection?.workbookName ?? undefined,
    workbookUrl: connection?.workbookWebUrl ?? undefined,
    workbookReady: Boolean(connection?.workbookDriveItemId && connection.workbookDriveId),
    unsyncedExpenses
  };
}

export async function formatExcelStatus(userId: string): Promise<string> {
  const status = await excelConnectionStatus(userId);
  if (!status.connected) {
    return [
      bold("📊 Microsoft Excel"),
      microsoftExcelConfigured() ? "Not connected." : "Connection setup is not available on this deployment.",
      "Connect once; Threadwise will create the workbook and import existing expenses."
    ].join("\n");
  }
  return [
    bold("📊 Microsoft Excel"),
    `${bold("Account")} ${h(status.email ?? "Connected")}`,
    `${bold("Workbook")} ${h(status.workbookName ?? "Needs setup")}`,
    `${bold("Automatic sync")} ${status.autoSync ? "On" : "Off"}`,
    `${bold("Waiting to sync")} ${status.unsyncedExpenses}`
  ].join("\n");
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
    throw new Error(`That workbook needs an Excel table named ${DEFAULT_TABLE_NAME}. Use Create workbook in Connections for automatic setup.`);
  }
  const columns = await graphAbsolute<WorkbookColumns>(
    accessToken,
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}/workbook/tables/${DEFAULT_TABLE_NAME}/columns?$select=name`
  );
  const columnNames = (columns.value ?? []).map((column) => column.name ?? "");
  if (columnNames.length !== EXPENSE_COLUMNS.length || EXPENSE_COLUMNS.some((name, index) => columnNames[index] !== name)) {
    throw new Error(`The ${DEFAULT_TABLE_NAME} table columns do not match Threadwise's expense template. Use Create workbook in Connections for automatic setup.`);
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

export async function syncExpenseToExcelIfEnabled(userId: string, expenseId: string, timezone: string): Promise<"synced" | "skipped" | "failed"> {
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { excelAutoSync: true } });
  if (!settings?.excelAutoSync) return "skipped";
  const status = await excelConnectionStatus(userId);
  if (!status.connected || !status.workbookReady) return "skipped";
  try {
    await syncExpenseToExcel(userId, expenseId, timezone);
    return "synced";
  } catch (error) {
    logger.warn("Automatic Excel sync failed without blocking the Threadwise expense save.", {
      userId,
      expenseId,
      error: String(error)
    });
    return "failed";
  }
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
  if (!connection) throw new Error("Connect Microsoft Excel in Connections first.");
  return connection;
}

async function requireWorkbook(userId: string) {
  const connection = await requireConnection(userId);
  if (!connection.workbookDriveItemId || !connection.workbookDriveId) {
    throw new Error("No Excel workbook is selected. Create one from Connections first.");
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
