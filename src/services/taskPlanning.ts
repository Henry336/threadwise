import { DateTime } from "luxon";
import { structureTaskDeterministically } from "../ai/deterministic";
import { parseDueDate } from "../utils/dates";

export const TASK_CAPTURE_DRAFT_LIMIT = 25;
export const TASK_CAPTURE_DRAFT_TTL_MS = 10 * 60_000;

export type TaskTimingWarning = "AMBIGUOUS_BARE_DATE" | "REMINDER_REQUIRES_CONFIRMATION";

export type TaskTimingIntent = {
  sourceText: string;
  title: string;
  plannedFor?: Date;
  dueAt?: Date;
  reminderAt?: Date;
  explicitlyUnscheduled: boolean;
  warnings: TaskTimingWarning[];
};

const UNSCHEDULED = /\b(?:no\s+(?:day|date)|without\s+(?:a\s+)?(?:day|date)|unscheduled|someday|no\s+day\s+yet)\b/i;
const DEADLINE_MARKER = /\b(?:due(?:\s+(?:on|by))?|by|before|no\s+later\s+than)\b/i;
const REMINDER_MARKER = /\bremind\s+me\b/i;
const RELATIVE_PLAN_DAY = /\b(?:today|tomorrow|day\s+after\s+tomorrow|tonight|this\s+(?:morning|afternoon|evening|night))\b/i;
const EXPLICIT_PLAN_DAY = /\b(?:on|for)\s+(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/i;
const BARE_TRAILING_DAY = /\b(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*$/i;
const TASK_ACTION_START = /^(?:(?:[-*•□☐]|\[(?: |x|X)\]|\d+[.)])\s*)?(?:["“'‘]\s*)?(?:add|apply|book|buy|call|cancel|check|clean|collect|complete|cook|create|do|draft|email|finish|fix|get|make|meet|order|organize|pack|pay|plan|prepare|read|replace|reply|research|return|review|revise|schedule|send|shop|start|study|submit|update|wash|write)\b/i;
const TASK_LIST_PREFIX = /^(?:(?:[-*•□☐]|\[(?: |x|X)\]|\d+[.)])\s*)/u;
const TASK_CONTINUATION_START = /^(?:reason|why|context|details?|notes?|background|purpose|constraints?|requirements?|references?|links?)\s*:/i;

export function calendarDate(value: Date, timezone: string): Date {
  const local = DateTime.fromJSDate(value).setZone(timezone);
  if (!local.isValid) throw new Error(`Invalid timezone: ${timezone}`);
  return new Date(`${local.toISODate()}T00:00:00.000Z`);
}

export function todayCalendarDate(timezone: string, now: Date = new Date()): Date {
  return calendarDate(now, timezone);
}

export function calendarDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function splitTaskDraftText(sourceText: string): string[] {
  const source = sourceText.trim();
  if (!source) return [];
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  let depth = 0;

  const flush = () => {
    const value = current.trim().replace(TASK_LIST_PREFIX, "");
    current = "";
    if (value) parts.push(value);
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "“" || character === "‘") {
      quote = character === "“" ? "”" : character === "‘" ? "’" : character;
      current += character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth = Math.max(0, depth - 1);
    const nextLine = character === "\n" ? nextMeaningfulLine(source.slice(index + 1)) : "";
    const hardSeparator = character === ";" || (character === "\n" && !isTaskContinuationLine(nextLine));
    const commaStartsAnotherTask = character === "," && startsWithTaskAction(source.slice(index + 1));
    if (depth === 0 && (hardSeparator || commaStartsAnotherTask)) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  if (parts.length > TASK_CAPTURE_DRAFT_LIMIT) {
    throw new Error(`Add at most ${TASK_CAPTURE_DRAFT_LIMIT} tasks at once.`);
  }
  return parts;
}

export function startsWithTaskAction(text: string): boolean {
  return TASK_ACTION_START.test(text.trimStart());
}

function nextMeaningfulLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim()) ?? "";
}

export function isTaskContinuationLine(text: string): boolean {
  return TASK_CONTINUATION_START.test(text.trimStart());
}

export function taskContinuationDescription(sourceText: string): string | undefined {
  const [, ...continuationLines] = sourceText.trim().split(/\r?\n/);
  const description = continuationLines.join("\n").trim();
  return description || undefined;
}

export function parseTaskTimingIntent(
  sourceText: string,
  timezone: string,
  now: Date = new Date(),
  defaultToToday = true,
): TaskTimingIntent {
  const source = sourceText.trim();
  if (!source) throw new Error("Give the task a title.");
  const titleSource = source.split(/\r?\n/, 1)[0]?.trim() || source;
  const warnings: TaskTimingWarning[] = [];
  const explicitlyUnscheduled = UNSCHEDULED.test(titleSource);
  const reminderRequested = REMINDER_MARKER.test(titleSource);
  const deadlineMatch = DEADLINE_MARKER.exec(titleSource);
  const deadlineClause = deadlineMatch ? titleSource.slice(deadlineMatch.index) : "";
  const beforeDeadline = deadlineMatch ? titleSource.slice(0, deadlineMatch.index).trim() : titleSource;
  const dueAt = deadlineMatch ? parseDueDate(deadlineClause, timezone, now) : undefined;
  const reminderAt = reminderRequested ? parseDueDate(titleSource, timezone, now) : undefined;
  if (reminderRequested) warnings.push("REMINDER_REQUIRES_CONFIRMATION");

  let plannedFor: Date | undefined;
  if (!explicitlyUnscheduled) {
    const relative = RELATIVE_PLAN_DAY.test(beforeDeadline);
    const explicit = EXPLICIT_PLAN_DAY.test(beforeDeadline);
    const bareTrailing = BARE_TRAILING_DAY.test(beforeDeadline) && !explicit;
    if (bareTrailing) warnings.push("AMBIGUOUS_BARE_DATE");
    if (!reminderRequested && (relative || explicit) && !bareTrailing) {
      const parsed = parseDueDate(beforeDeadline, timezone, now);
      if (parsed) plannedFor = calendarDate(parsed, timezone);
    } else if (defaultToToday && !reminderRequested && !bareTrailing) {
      plannedFor = todayCalendarDate(timezone, now);
    }
  }

  const structured = structureTaskDeterministically(titleSource);
  const title = (structured.title || titleSource)
    .replace(UNSCHEDULED, "")
    .replace(/^\s*(?:todo|task)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!title) throw new Error("Give the task a title.");

  return {
    sourceText: source,
    title,
    ...(plannedFor ? { plannedFor } : {}),
    ...(dueAt ? { dueAt } : {}),
    ...(reminderAt ? { reminderAt } : {}),
    explicitlyUnscheduled,
    warnings,
  };
}
