import { CaptureKind, type PendingCapture } from "@prisma/client";
import type { Classification } from "../ai/types";
import { parseDueDate } from "../utils/dates";
import { bold, h } from "../utils/html";
import type { CaptureSaveKind } from "./keyboards";

const CAPTURE_KIND_COPY: Record<CaptureSaveKind, string> = {
  task: "a task",
  reminder: "a reminder",
  note: "a note",
  idea: "an idea",
};

export function suggestedCaptureKind(
  classification: Classification | undefined,
  sourceText: string,
  timezone: string,
  now = new Date(),
): CaptureSaveKind | undefined {
  if (!classification || classification.kind === "noise" || classification.confidence < 0.45) return undefined;
  if (classification.kind === "task") {
    const dueAt = parseDueDate(classification.dueDateText ?? sourceText, timezone);
    return dueAt && dueAt > now ? "reminder" : "task";
  }
  return classification.kind;
}

export function suggestedPendingCaptureKind(
  pending: Pick<PendingCapture, "kind" | "sourceText">,
  timezone: string,
  now = new Date(),
): CaptureSaveKind | undefined {
  if (pending.kind === CaptureKind.NOISE || pending.kind === CaptureKind.REFLECTION) return undefined;
  if (pending.kind === CaptureKind.TASK) {
    const dueAt = parseDueDate(pending.sourceText, timezone);
    return dueAt && dueAt > now ? "reminder" : "task";
  }
  if (pending.kind === CaptureKind.IDEA) return "idea";
  return "note";
}

export function formatCaptureReview(sourceText: string, suggestedKind?: CaptureSaveKind): string {
  return [
    bold("Review before saving"),
    h(truncate(sourceText, 320)),
    "",
    suggestedKind
      ? `I’d file this as ${bold(CAPTURE_KIND_COPY[suggestedKind])}. Nothing is saved yet.`
      : "Choose what this should become. Nothing is saved yet.",
  ].join("\n");
}

export function formatCaptureTypeChoice(sourceText: string): string {
  return [
    bold("Choose a type"),
    h(truncate(sourceText, 320)),
    "",
    "Task · something to finish",
    "Reminder · an alert at a specific time",
    "Note · information to keep",
    "Idea · something to develop later",
    "",
    "You can also reply: Save that as a note instead.",
  ].join("\n");
}

export function formatReminderTimePrompt(sourceText: string): string {
  return [
    bold("When should I remind you?"),
    h(truncate(sourceText, 240)),
    "",
    "Reply with a future time, such as tomorrow at 9am or Friday at noon. Send cancel to discard it.",
  ].join("\n");
}

function truncate(value: string, max: number): string {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
