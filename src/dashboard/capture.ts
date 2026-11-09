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
import { parseDueDate, splitReminderText } from "../utils/dates";
import { DashboardUserNotFoundError } from "./snapshot";
import type { CapturePreviewInput } from "./schemas";

const DASHBOARD_OWNER_ID = /^(?:[1-9]\d{0,19}|chat:-\d{1,20})$/;

// Expenses are a frozen feature: quick capture only previews tasks, notes and ideas.
export type DashboardCaptureKind = "task" | "note" | "idea";

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
  if (!DASHBOARD_OWNER_ID.test(telegramId)) throw new DashboardUserNotFoundError();
  const user = await database.user.findUnique({
    where: { telegramId },
    select: { settings: { select: { timezone: true } } }
  });
  if (!user?.settings) throw new DashboardUserNotFoundError();

  const text = normalizeNaturalCommandText(input.text);
  const timezone = user.settings.timezone || "UTC";
  const preferred = input.preferredKind;
  const explicitReminder = parseNaturalReminderBody(text);
  const explicitTask = parseNaturalTaskBody(text);
  const explicitNote = parseNaturalNoteBody(text);
  const explicitIdea = parseNaturalIdeaBody(text);

  let classification: Classification;
  let kind: DashboardCaptureKind;
  if (preferred !== "auto") {
    kind = preferred;
    classification = {
      kind: preferred,
      confidence: 1,
      reason: `You chose ${preferred}.`
    };
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
