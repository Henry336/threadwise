import crypto from "crypto";
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { formatDateTimeForUser } from "../utils/dates";
import { nextPublicId } from "./publicIds";
import { detectCurrency, normalizeCurrency } from "../utils/currencies";

export const EXPENSE_PAGE_SIZE = 10;
export const EXPENSE_COLUMNS = [
  "Expense ID",
  "Transaction Date",
  "Merchant",
  "Category",
  "Description",
  "Subtotal",
  "Tax",
  "Discount",
  "Total",
  "Currency",
  "Payment Method",
  "Source",
  "OCR Confidence",
  "Notes",
  "Added At"
] as const;

export type ParsedExpense = {
  merchant?: string;
  transactionAt: Date;
  category?: string;
  description?: string;
  subtotal?: number;
  tax?: number;
  discount?: number;
  total: number;
  currency: string;
  paymentMethod?: string;
  notes?: string;
};

export type ExpenseFilter = {
  kind: "all" | "day" | "month" | "year";
  value?: string;
  label: string;
};

type PendingExpenseInput = {
  sourceType: "manual" | "receipt";
  receiptFileUniqueId?: string;
  ocrConfidence?: number;
  defaultCurrency?: string;
};

export function parseExpenseText(text: string, timezone: string, now = new Date(), defaultCurrency = "SGD"): ParsedExpense | undefined {
  const normalized = normalizeExpenseDigits(text).replace(/\r/g, "").trim();
  if (!normalized) return undefined;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const total = findTotal(lines) ?? findManualAmount(normalized);
  if (total === undefined || !Number.isFinite(total) || total < 0) {
    return undefined;
  }

  const merchant = findManualMerchant(normalized) ?? findReceiptMerchant(lines);
  const description = findManualDescription(normalized);
  const transactionAt = findExpenseDate(normalized, timezone, now) ?? now;
  const category = inferExpenseCategory(`${merchant ?? ""} ${description ?? ""} ${normalized}`);

  return {
    merchant,
    transactionAt,
    category,
    description,
    subtotal: findLabeledAmount(lines, /\bsub\s*total\b/i),
    tax: findLabeledAmount(lines, /\b(?:gst|vat|tax)\b/i),
    discount: findLabeledAmount(lines, /\b(?:discount|savings?)\b/i),
    total,
    currency: detectCurrency(normalized, defaultCurrency),
    paymentMethod: detectPaymentMethod(normalized)
  };
}

export async function createPendingExpenseFromText(
  userId: string,
  sourceText: string,
  timezone: string,
  input: PendingExpenseInput
) {
  const parsed = parseExpenseText(sourceText, timezone, new Date(), input.defaultCurrency);
  if (!parsed) {
    throw new Error("I couldn't confidently find an expense total. Try something like: spent $18.40 on lunch at Toast Box today.");
  }

  await prisma.pendingExpense.deleteMany({ where: { userId } });
  return prisma.pendingExpense.create({
    data: {
      userId,
      sourceText,
      sourceType: input.sourceType,
      merchant: parsed.merchant,
      transactionAt: parsed.transactionAt,
      category: parsed.category,
      description: parsed.description,
      subtotal: decimal(parsed.subtotal),
      tax: decimal(parsed.tax),
      discount: decimal(parsed.discount),
      total: decimal(parsed.total) ?? new Prisma.Decimal(0),
      currency: parsed.currency,
      paymentMethod: parsed.paymentMethod,
      receiptFileUniqueId: input.receiptFileUniqueId,
      ocrConfidence: input.ocrConfidence,
      notes: parsed.notes,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    }
  });
}

export async function findPendingExpense(userId: string, pendingId: string) {
  return prisma.pendingExpense.findFirstOrThrow({
    where: { id: pendingId, userId, expiresAt: { gt: new Date() } }
  });
}

export async function beginExpenseEdit(userId: string, pendingId: string) {
  return prisma.pendingExpense.update({
    where: { id: (await findPendingExpense(userId, pendingId)).id },
    data: { awaitingEdit: true }
  });
}

export async function cancelPendingExpense(userId: string, pendingId: string): Promise<void> {
  await prisma.pendingExpense.deleteMany({ where: { id: pendingId, userId } });
}

export async function applyPendingExpenseEdit(userId: string, text: string, timezone: string) {
  const pending = await prisma.pendingExpense.findFirst({
    where: { userId, awaitingEdit: true, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" }
  });
  if (!pending) return undefined;

  if (/^(?:cancel|stop|discard)(?:\s+(?:expense\s+)?edit)?$/i.test(text.trim())) {
    await prisma.pendingExpense.update({ where: { id: pending.id }, data: { awaitingEdit: false } });
    return { canceled: true as const, pending };
  }

  const updates = parseExpenseEdits(text, timezone);
  if (Object.keys(updates).length === 0) {
    return { canceled: false as const, pending, message: "I couldn't find a field to change. Try: total 12.50, merchant Toast Box, category food, date today." };
  }

  const updated = await prisma.pendingExpense.update({
    where: { id: pending.id },
    data: { ...updates, awaitingEdit: false }
  });
  return { canceled: false as const, pending: updated };
}

export async function confirmPendingExpense(userId: string, pendingId: string) {
  const pending = await findPendingExpense(userId, pendingId);
  const contentHash = pending.sourceType === "receipt"
    ? crypto.createHash("sha256").update(`${pending.receiptFileUniqueId ?? ""}\n${normalizeHashText(pending.sourceText)}`).digest("hex")
    : undefined;
  const publicId = await nextPublicId(userId, "EXP");

  try {
    return await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          userId,
          publicId,
          merchant: pending.merchant,
          transactionAt: pending.transactionAt,
          category: pending.category,
          description: pending.description,
          subtotal: pending.subtotal,
          tax: pending.tax,
          discount: pending.discount,
          total: pending.total,
          currency: pending.currency,
          paymentMethod: pending.paymentMethod,
          sourceType: pending.sourceType,
          receiptFileUniqueId: pending.receiptFileUniqueId,
          receiptContentHash: contentHash,
          rawText: pending.sourceText,
          ocrConfidence: pending.ocrConfidence,
          notes: pending.notes
        }
      });
      await tx.pendingExpense.delete({ where: { id: pending.id } });
      return expense;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("That receipt appears to have been saved already. I left the existing expense unchanged.");
    }
    throw error;
  }
}

export async function updateSavedExpense(userId: string, reference: string, text: string, timezone: string) {
  const normalized = reference.trim().toUpperCase();
  const expense = await prisma.expense.findFirstOrThrow({
    where: { userId, OR: [{ id: reference.trim() }, { publicId: normalized }] }
  });
  const updates = parseExpenseEdits(text, timezone);
  if (Object.keys(updates).length === 0) {
    throw new Error("I couldn't find a field to change. Try: currency MMK, total 12000, merchant City Mart, category groceries, or date yesterday.");
  }
  return prisma.expense.update({
    where: { id: expense.id },
    data: updates
  });
}

export async function listExpenses(userId: string, filter: ExpenseFilter, page: number, timezone: string) {
  const where = { userId, ...expenseDateWhere(filter, timezone) };
  const total = await prisma.expense.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / EXPENSE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const expenses = await prisma.expense.findMany({
    where,
    orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }],
    skip: (safePage - 1) * EXPENSE_PAGE_SIZE,
    take: EXPENSE_PAGE_SIZE
  });
  return { expenses, page: safePage, total, totalPages, filter };
}

export function parseExpenseFilter(input: string, timezone: string, now = new Date()): ExpenseFilter | undefined {
  const normalized = input.toLowerCase().replace(/[?.!,]+$/g, "").trim();
  const localNow = DateTime.fromJSDate(now).setZone(timezone);
  if (!normalized || /^(?:all|everything|all expenses|my expenses|expenses)$/.test(normalized)) {
    return { kind: "all", label: "all expenses" };
  }
  if (/^(?:today|today's expenses|expenses today)$/.test(normalized)) {
    return { kind: "day", value: localNow.toISODate() ?? undefined, label: "today" };
  }
  if (/^(?:yesterday|yesterday's expenses|expenses yesterday)$/.test(normalized)) {
    const value = localNow.minus({ days: 1 }).toISODate() ?? undefined;
    return { kind: "day", value, label: "yesterday" };
  }
  const isoDay = normalized.match(/^(?:on\s+)?(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (isoDay && DateTime.fromISO(isoDay, { zone: timezone }).isValid) {
    return { kind: "day", value: isoDay, label: isoDay };
  }
  const naturalDay = parseNaturalDay(normalized.replace(/^(?:on|for)\s+/, ""), timezone, now);
  if (naturalDay) {
    return { kind: "day", value: naturalDay.toISODate() ?? undefined, label: naturalDay.toFormat("d LLLL yyyy") };
  }
  if (/^(?:this month|month|monthly|expenses this month)$/.test(normalized)) {
    return { kind: "month", value: localNow.toFormat("yyyy-LL"), label: localNow.toFormat("LLLL yyyy") };
  }
  if (/^(?:last month|expenses last month)$/.test(normalized)) {
    const value = localNow.minus({ months: 1 });
    return { kind: "month", value: value.toFormat("yyyy-LL"), label: value.toFormat("LLLL yyyy") };
  }
  const namedMonth = parseNamedMonth(normalized, timezone, now);
  if (namedMonth) return namedMonth;

  const year = normalized.match(/^(?:year\s+)?(20\d{2})$/)?.[1];
  if (year) return { kind: "year", value: year, label: year };
  if (/^(?:this year|expenses this year)$/.test(normalized)) {
    return { kind: "year", value: String(localNow.year), label: String(localNow.year) };
  }
  return undefined;
}

export function encodeExpenseFilter(filter: ExpenseFilter): string {
  return `${filter.kind}:${filter.value ?? "all"}`;
}

export function decodeExpenseFilter(value: string): ExpenseFilter | undefined {
  const [kind, filterValue] = value.split(":");
  if (kind === "all") return { kind: "all", label: "all expenses" };
  if (kind === "day" && filterValue) return { kind, value: filterValue, label: filterValue };
  if (kind === "month" && filterValue) return { kind, value: filterValue, label: filterValue };
  if (kind === "year" && filterValue) return { kind, value: filterValue, label: filterValue };
  return undefined;
}

export function formatPendingExpense(pending: {
  merchant?: string | null;
  transactionAt: Date;
  category?: string | null;
  description?: string | null;
  subtotal?: Prisma.Decimal | null;
  tax?: Prisma.Decimal | null;
  discount?: Prisma.Decimal | null;
  total: Prisma.Decimal;
  currency: string;
  paymentMethod?: string | null;
  sourceType: string;
  ocrConfidence?: number | null;
}, timezone: string): string {
  return [
    bold("Check this expense"),
    "Nothing is saved until you confirm.",
    "",
    `${bold("Merchant")} ${h(pending.merchant ?? "Not found")}`,
    `${bold("Date")} ${h(formatDateTimeForUser(pending.transactionAt, timezone))}`,
    `${bold("Category")} ${h(pending.category ?? "Uncategorized")}`,
    pending.description ? `${bold("Description")} ${h(pending.description)}` : undefined,
    pending.subtotal ? `${bold("Subtotal")} ${h(formatMoney(pending.subtotal, pending.currency))}` : undefined,
    pending.tax ? `${bold("Tax")} ${h(formatMoney(pending.tax, pending.currency))}` : undefined,
    pending.discount ? `${bold("Discount")} ${h(formatMoney(pending.discount, pending.currency))}` : undefined,
    `${bold("Total")} ${h(formatMoney(pending.total, pending.currency))}`,
    pending.paymentMethod ? `${bold("Payment")} ${h(pending.paymentMethod)}` : undefined,
    `${bold("Source")} ${h(pending.sourceType)}`,
    pending.ocrConfidence !== null && pending.ocrConfidence !== undefined
      ? `${bold("OCR confidence")} ${Math.round(pending.ocrConfidence)}%`
      : undefined
  ].filter(Boolean).join("\n");
}

export function formatExpenseCreated(expense: {
  publicId: string;
  merchant?: string | null;
  total: Prisma.Decimal;
  currency: string;
  transactionAt: Date;
}, timezone: string): string {
  return [
    bold("Expense saved in Threadwise"),
    `${code(expense.publicId)} ${h(expense.merchant ?? "Expense")}`,
    `${bold("Total")} ${h(formatMoney(expense.total, expense.currency))}`,
    `${bold("Date")} ${h(formatDateTimeForUser(expense.transactionAt, timezone))}`
  ].join("\n");
}

export function formatExpensePage(result: Awaited<ReturnType<typeof listExpenses>>, timezone: string): string {
  if (result.expenses.length === 0) {
    return `No ${result.filter.label} found.`;
  }
  return [
    bold(`Expenses: ${result.filter.label}`),
    `Page ${result.page}/${result.totalPages} · ${result.total} total`,
    "",
    ...result.expenses.map((expense) => [
      `${code(expense.publicId)} ${bold(expense.merchant ?? expense.description ?? "Expense")}`,
      `${h(formatMoney(expense.total, expense.currency))} · ${h(formatDateTimeForUser(expense.transactionAt, timezone))}`,
      expense.category ? h(expense.category) : undefined,
      expense.excelSyncedAt ? "Excel: synced" : "Excel: not synced"
    ].filter(Boolean).join("\n"))
  ].join("\n\n");
}

export function expenseRowValues(expense: {
  publicId: string;
  transactionAt: Date;
  merchant?: string | null;
  category?: string | null;
  description?: string | null;
  subtotal?: Prisma.Decimal | null;
  tax?: Prisma.Decimal | null;
  discount?: Prisma.Decimal | null;
  total: Prisma.Decimal;
  currency: string;
  paymentMethod?: string | null;
  sourceType: string;
  ocrConfidence?: number | null;
  notes?: string | null;
  createdAt: Date;
}, timezone: string): Array<string | number> {
  return [
    expense.publicId,
    DateTime.fromJSDate(expense.transactionAt).setZone(timezone).toISODate() ?? "",
    expense.merchant ?? "",
    expense.category ?? "",
    expense.description ?? "",
    decimalNumber(expense.subtotal),
    decimalNumber(expense.tax),
    decimalNumber(expense.discount),
    decimalNumber(expense.total),
    expense.currency,
    expense.paymentMethod ?? "",
    expense.sourceType,
    expense.ocrConfidence === null || expense.ocrConfidence === undefined ? "" : Math.round(expense.ocrConfidence),
    expense.notes ?? "",
    expense.createdAt.toISOString()
  ];
}

function parseExpenseEdits(text: string, timezone: string): Prisma.PendingExpenseUpdateInput {
  const normalized = text
    .replace(/^(?:change|update|set|edit)\s+/i, "")
    .replace(/\s+and\s+(?=(?:merchant|total|date|category|description|currency|payment|tax|subtotal|discount|notes?)\b)/ig, ", ");
  const parts = normalized.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
  const data: Prisma.PendingExpenseUpdateInput = {};
  for (const part of parts) {
    const match = part.match(/^(merchant|total|date|category|description|currency|payment(?: method)?|tax|subtotal|discount|notes?)\s*(?:=|:|to|is)?\s+(.+)$/i);
    if (!match?.[1] || !match[2]) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "merchant") data.merchant = value;
    else if (field === "category") data.category = value;
    else if (field === "description") data.description = value;
    else if (field === "currency") {
      const currency = normalizeCurrency(value);
      if (currency) data.currency = currency;
    }
    else if (field.startsWith("payment")) data.paymentMethod = value;
    else if (field.startsWith("note")) data.notes = value;
    else if (field === "date") {
      const parsed = findExpenseDate(value, timezone, new Date());
      if (parsed) data.transactionAt = parsed;
    } else {
      const amount = parseMoney(value);
      if (amount === undefined) continue;
      if (field === "total") data.total = decimal(amount);
      else if (field === "tax") data.tax = decimal(amount);
      else if (field === "subtotal") data.subtotal = decimal(amount);
      else if (field === "discount") data.discount = decimal(amount);
    }
  }
  return data;
}

function expenseDateWhere(filter: ExpenseFilter, timezone: string) {
  if (filter.kind === "all" || !filter.value) return {};
  let start: DateTime;
  let end: DateTime;
  if (filter.kind === "day") {
    start = DateTime.fromISO(filter.value, { zone: timezone }).startOf("day");
    end = start.plus({ days: 1 });
  } else if (filter.kind === "month") {
    start = DateTime.fromFormat(filter.value, "yyyy-LL", { zone: timezone }).startOf("month");
    end = start.plus({ months: 1 });
  } else {
    start = DateTime.fromFormat(filter.value, "yyyy", { zone: timezone }).startOf("year");
    end = start.plus({ years: 1 });
  }
  return { transactionAt: { gte: start.toJSDate(), lt: end.toJSDate() } };
}

function findTotal(lines: string[]): number | undefined {
  const candidates: Array<{ priority: number; amount: number }> = [];
  for (const line of lines) {
    if (/\b(?:sub\s*total|tax|gst|vat|discount|change|cash tendered)\b/i.test(line)) continue;
    const priority = /\bgrand\s+total\b/i.test(line) ? 4
      : /\b(?:amount\s+due|balance\s+due|net\s+total)\b/i.test(line) ? 3
        : /\btotal\b/i.test(line) ? 2
          : 0;
    if (!priority) continue;
    const amount = lastMoney(line);
    if (amount !== undefined) candidates.push({ priority, amount });
  }
  return candidates.sort((a, b) => b.priority - a.priority).at(0)?.amount;
}

function findLabeledAmount(lines: string[], pattern: RegExp): number | undefined {
  const line = lines.find((item) => pattern.test(item));
  return line ? lastMoney(line) : undefined;
}

function findManualAmount(text: string): number | undefined {
  const explicit = text.match(/\b(?:spent|paid|expense(?:\s+of)?|cost(?:s|ing)?)\s*(?:sgd|s\$|us\$|usd|mmk|kyats?|myr|rm|thb|baht|eur|gbp|jpy|cny|rmb|inr|php|idr|aud|cad|nzd|hkd|\$|€|£|฿|₹|₱)?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  return explicit ? parseMoney(explicit) : undefined;
}

function findManualMerchant(text: string): string | undefined {
  const match = text.match(/\bat\s+(.+?)(?=\s+(?:today|yesterday|on\s+\d|using|with|paid\s+(?:by|with))\b|[,.]|$)/i);
  return cleanText(match?.[1]);
}

function findManualDescription(text: string): string | undefined {
  const match = text.match(/\b(?:spent|paid)\b.+?\bon\s+(.+?)(?=\s+at\s+|\s+(?:today|yesterday|using|with)\b|[,.]|$)/i);
  return cleanText(match?.[1]);
}

function findReceiptMerchant(lines: string[]): string | undefined {
  return cleanText(lines.find((line) =>
    line.length >= 2 &&
    line.length <= 80 &&
    !/[\d]{4,}/.test(line) &&
    !/\b(?:receipt|invoice|tax|gst|tel|phone|address|date|time|cashier|total)\b/i.test(line)
  ));
}

function findExpenseDate(text: string, timezone: string, now: Date): Date | undefined {
  const base = DateTime.fromJSDate(now).setZone(timezone);
  if (/\byesterday\b/i.test(text)) return base.minus({ days: 1 }).startOf("day").toJSDate();
  if (/\btoday\b/i.test(text)) return base.startOf("day").toJSDate();
  const formats = ["yyyy-LL-dd", "dd/LL/yyyy", "dd-LL-yyyy", "dd/LL/yy", "dd-LL-yy", "dd LLL yyyy", "d LLL yyyy", "LLL d yyyy"];
  const candidates = text.match(/\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-](?:20)?\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2}\s+20\d{2})\b/g) ?? [];
  for (const candidate of candidates) {
    for (const format of formats) {
      const parsed = DateTime.fromFormat(candidate, format, { zone: timezone, locale: "en" });
      if (parsed.isValid) return parsed.startOf("day").toJSDate();
    }
    const iso = DateTime.fromISO(candidate, { zone: timezone });
    if (iso.isValid) return iso.startOf("day").toJSDate();
  }
  const withoutYear = text.match(/\b(?:\d{1,2}\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\s+\d{1,2})\b/)?.[0];
  if (withoutYear) return parseNaturalDay(withoutYear, timezone, now)?.startOf("day").toJSDate();
  return undefined;
}

function parseNaturalDay(text: string, timezone: string, now: Date): DateTime | undefined {
  const localNow = DateTime.fromJSDate(now).setZone(timezone);
  const candidates = [text, `${text} ${localNow.year}`];
  const formats = ["d LLLL yyyy", "d LLL yyyy", "LLLL d yyyy", "LLL d yyyy", "d/LL/yyyy", "d-LL-yyyy", "d/LL/yy", "d-LL-yy"];
  for (const candidate of candidates) {
    for (const format of formats) {
      const parsed = DateTime.fromFormat(candidate, format, { zone: timezone, locale: "en" });
      if (parsed.isValid) return parsed.startOf("day");
    }
  }
  return undefined;
}

function parseNamedMonth(text: string, timezone: string, now: Date): ExpenseFilter | undefined {
  const localNow = DateTime.fromJSDate(now).setZone(timezone);
  const match = text.match(/^(?:in\s+|for\s+)?([a-z]+)(?:\s+(20\d{2}))?$/i);
  if (!match?.[1]) return undefined;
  const year = Number(match[2] ?? localNow.year);
  const parsed = DateTime.fromFormat(`${match[1]} ${year}`, "LLLL yyyy", { zone: timezone, locale: "en" });
  if (!parsed.isValid) return undefined;
  return { kind: "month", value: parsed.toFormat("yyyy-LL"), label: parsed.toFormat("LLLL yyyy") };
}

function inferExpenseCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  const categories: Array<[string, string[]]> = [
    ["Food", ["food", "lunch", "dinner", "breakfast", "cafe", "restaurant", "toast box", "mcdonald", "coffee"]],
    ["Groceries", ["grocery", "groceries", "supermarket", "fairprice", "cold storage", "sheng siong"]],
    ["Transport", ["transport", "grab", "taxi", "bus", "train", "mrt", "petrol", "parking"]],
    ["Shopping", ["shopping", "clothes", "shoes", "amazon", "shopee", "lazada"]],
    ["Bills", ["bill", "utilities", "electricity", "water", "internet", "phone"]],
    ["Health", ["clinic", "doctor", "pharmacy", "medicine", "dental"]],
    ["Entertainment", ["movie", "cinema", "game", "spotify", "netflix"]],
    ["Education", ["book", "course", "tuition", "school", "university"]]
  ];
  return categories.find(([, words]) => words.some((word) => lower.includes(word)))?.[0];
}

function detectPaymentMethod(text: string): string | undefined {
  const methods: Array<[RegExp, string]> = [
    [/\bvisa\b/i, "Visa"],
    [/\bmaster\s*card\b/i, "Mastercard"],
    [/\bamex|american express\b/i, "American Express"],
    [/\bpaynow\b/i, "PayNow"],
    [/\bapple pay\b/i, "Apple Pay"],
    [/\bgoogle pay\b/i, "Google Pay"],
    [/\bcash\b/i, "Cash"]
  ];
  return methods.find(([pattern]) => pattern.test(text))?.[1];
}

function lastMoney(text: string): number | undefined {
  const matches = [...text.matchAll(/(?:sgd|s\$|us\$|usd|eur|gbp|\$|€|£)?\s*([\d,]+(?:\.\d{1,2})?)/gi)];
  return matches.length ? parseMoney(matches.at(-1)?.[1] ?? "") : undefined;
}

function parseMoney(text: string): number | undefined {
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? Math.abs(value) : undefined;
}

function decimal(value?: number): Prisma.Decimal | undefined {
  return value === undefined ? undefined : new Prisma.Decimal(value.toFixed(2));
}

function decimalNumber(value?: Prisma.Decimal | null): number | string {
  return value === null || value === undefined ? "" : Number(value.toString());
}

function formatMoney(value: Prisma.Decimal | number, currency: string): string {
  return `${currency} ${Number(value.toString()).toFixed(2)}`;
}

function cleanText(value?: string): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").replace(/[|:;,-]+$/g, "").trim();
  return cleaned || undefined;
}

function normalizeHashText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeExpenseDigits(text: string): string {
  const myanmarDigits = "၀၁၂၃၄၅၆၇၈၉";
  return text.replace(/[၀-၉]/g, (digit) => String(myanmarDigits.indexOf(digit)));
}
