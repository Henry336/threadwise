import type { PrismaClient } from "@prisma/client";
import type { AiProvider, Classification } from "../ai/types";
import { classifyMessageDeterministically } from "../ai/deterministic";
import { prisma } from "../db/prisma";
import {
  normalizeNaturalCommandText,
  parseNaturalIdeaBody,
  parseNaturalNoteBody,
  parseNaturalReminderBody,
  parseNaturalTaskBody
} from "../bot/naturalCommandParsing";
import { parseExpenseText } from "../services/expenses";
import { parseDueDate, splitReminderText } from "../utils/dates";
import { DashboardUserNotFoundError } from "./snapshot";
import { DashboardValidationError } from "./data";
import type { CapturePreviewInput } from "./schemas";

const PERSONAL_TELEGRAM_ID = /^[1-9]\d{0,19}$/;

export type DashboardCaptureKind = "task" | "note" | "idea" | "expense";

export type DashboardCapturePreview = {
  kind: DashboardCaptureKind;
  confidence: number;
  reason: string;
  sourceText: string;
  payload: Record<string, unknown>;
};

export async function previewDashboardCapture(
  telegramId: string,
  input: CapturePreviewInput,
  ai: AiProvider,
  database: PrismaClient = prisma,
  now = new Date()
): Promise<DashboardCapturePreview> {
  if (!PERSONAL_TELEGRAM_ID.test(telegramId)) throw new DashboardUserNotFoundError();
  const user = await database.user.findUnique({
    where: { telegramId },
    select: { settings: { select: { timezone: true, expenseCurrency: true } } }
  });
  if (!user?.settings) throw new DashboardUserNotFoundError();

  const text = normalizeNaturalCommandText(input.text);
  const timezone = user.settings.timezone || "UTC";
  const preferred = input.preferredKind;
  const explicitExpense = naturalExpenseText(text);
  const explicitReminder = parseNaturalReminderBody(text);
  const explicitTask = parseNaturalTaskBody(text);
  const explicitNote = parseNaturalNoteBody(text);
  const explicitIdea = parseNaturalIdeaBody(text);

  let classification: Classification;
  let kind: DashboardCaptureKind;
  if (preferred !== "auto") {
    kind = preferred;
    classification = {
      kind: preferred === "expense" ? "note" : preferred,
      confidence: 1,
      reason: `You chose ${preferred}.`
    };
  } else if (explicitExpense) {
    kind = "expense";
    classification = { kind: "note", confidence: 0.99, reason: "Recognized explicit expense language." };
  } else if (explicitReminder || explicitTask) {
    kind = "task";
    classification = { kind: "task", confidence: 0.99, reason: explicitReminder ? "Recognized reminder language and a time expression." : "Recognized explicit task language." };
  } else if (explicitNote) {
    kind = "note";
    classification = { kind: "note", confidence: 0.99, reason: "Recognized explicit note language." };
  } else if (explicitIdea) {
    kind = "idea";
    classification = { kind: "idea", confidence: 0.99, reason: "Recognized explicit idea language." };
  } else {
    classification = classifyMessageDeterministically(text, timezone) ?? await ai.classifyMessage(text);
    kind = classification.kind === "noise" ? "note" : classification.kind;
  }

  if (kind === "expense") {
    const parsed = parseExpenseText(explicitExpense ?? text, timezone, now, user.settings.expenseCurrency);
    if (!parsed) {
      throw new DashboardValidationError("I couldn't find an expense amount. Try: spent $18.40 on lunch at Toast Box today.");
    }
    return {
      kind,
      confidence: preferred === "expense" ? 1 : classification.confidence,
      reason: classification.reason,
      sourceText: text,
      payload: {
        ...(parsed.merchant ? { merchant: parsed.merchant } : {}),
        ...(parsed.description ? { description: parsed.description } : {}),
        total: parsed.total,
        currency: parsed.currency,
        ...(parsed.category ? { category: parsed.category } : {}),
        transactionAt: parsed.transactionAt.toISOString(),
        ...(parsed.paymentMethod ? { paymentMethod: parsed.paymentMethod } : {}),
        ...(parsed.notes ? { notes: parsed.notes } : {})
      }
    };
  }

  if (kind === "task") {
    const reminderBody = explicitReminder;
    const split = reminderBody ? splitReminderText(reminderBody) : undefined;
    const source = split?.taskText ?? explicitTask ?? reminderBody ?? text;
    const structured = await ai.structureTask(source);
    const dueText = split?.whenText ?? structured.dueDateText ?? classification.dueDateText ?? text;
    const dueAt = parseDueDate(dueText, timezone, now);
    return {
      kind,
      confidence: classification.confidence,
      reason: classification.reason,
      sourceText: text,
      payload: {
        title: structured.title || classification.suggestedTitle || source,
        ...(structured.description ? { description: structured.description } : {}),
        ...(dueAt && dueAt.getTime() > now.getTime() ? { dueAt: dueAt.toISOString() } : {})
      }
    };
  }

  if (kind === "idea") {
    const source = explicitIdea ?? text;
    const structured = await ai.structureIdea(source);
    return {
      kind,
      confidence: classification.confidence,
      reason: classification.reason,
      sourceText: text,
      payload: {
        title: structured.title || classification.suggestedTitle || source,
        concept: structured.concept || source,
        tags: structured.tags ?? []
      }
    };
  }

  const source = explicitNote ?? text;
  const structured = await ai.structureNote(source);
  return {
    kind: "note",
    confidence: classification.kind === "noise" ? Math.min(classification.confidence, 0.44) : classification.confidence,
    reason: classification.kind === "noise"
      ? "This could be a note, but confidence is low. Review the preview or choose another type."
      : classification.reason,
    sourceText: text,
    payload: {
      title: structured.title || classification.suggestedTitle || "Untitled note",
      body: structured.body || source,
      tags: structured.tags ?? []
    }
  };
}

function naturalExpenseText(text: string): string | undefined {
  if (/^(?:i\s+)?(?:spent|paid)\s+.+/i.test(text)) return text;
  const explicit = text.match(/^(?:please\s+)?(?:log|record|add|save|track)\s+(?:this\s+)?(?:as\s+)?(?:an?\s+)?expense(?:\s+(?:of|for))?\s+(.+)$/i)
    ?? text.match(/^expense\s*[:,-]?\s+(.+)$/i);
  if (explicit?.[1]) return `expense ${explicit[1]}`;
  const bought = text.match(/^(?:i\s+)?bought\s+(.+?)\s+for\s+(.+\d.+|\d.+)$/i);
  if (bought?.[1] && bought[2]) return `spent ${bought[2]} on ${bought[1]}`;
  return undefined;
}
