/**
 * Copy and suggestion logic for the "Review before saving" card shown for ordinary prose.
 * The classifier only suggests a type; nothing is saved until the sender taps Save or picks
 * another type (see docs/ARCHITECTURE.md, natural-language handling).
 */
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

/**
 * Picks the type to suggest from a fresh classification. Low-confidence or noise results get no
 * suggestion, so the card asks the user to choose. A task with a future time becomes a reminder.
 */
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

/** Same suggestion, rebuilt from a stored PendingCapture row (for example when the card is redrawn). */
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

/** The review card text. It always says nothing is saved yet, so the user knows a tap is needed. */
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

/** Prompt shown when the user picks Reminder but the text had no future time to use. */
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
