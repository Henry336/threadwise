/**
 * Local, rule-based message classification and structuring that runs before any AI call.
 * It keeps the bot fast and useful without an API key or quota. Used by bot/naturalLanguage.ts,
 * dashboard capture, services/notes.ts and Study natural language. The result is a suggestion
 * shown on a review card, never a direct save.
 */

import { parseDueDate } from "../utils/dates";
import type { Classification, StructuredNote, StructuredTask } from "./types";

type IntentKind = Exclude<Classification["kind"], "noise">;

type IntentScore = {
  kind: IntentKind;
  score: number;
  reasons: string[];
};

const TASK_ACTION_WORDS = [
  "add",
  "book",
  "bring",
  "buy",
  "call",
  "check",
  "complete",
  "email",
  "finish",
  "follow up",
  "leave",
  "pay",
  "prepare",
  "remind",
  "reply",
  "review",
  "schedule",
  "send",
  "set",
  "submit",
  "todo"
];
const TASK_STARTERS = ["add", "todo", "task", "reminder"];
const REMINDER_STARTERS = [
  "remind me",
  "please remind me",
  "set a reminder",
  "set reminder",
  "create a reminder",
  "create reminder"
];
const NOTE_STARTERS = ["note", "remember", "save this", "learned", "insight", "quote"];
const IDEA_STARTERS = ["idea", "build", "app idea", "tool idea", "product idea", "website idea"];
const NOTE_TERMS = ["remember", "learned", "insight", "quote", "summary", "important"];
const IDEA_TERMS = ["app", "bot", "build", "idea", "product", "startup", "tool", "website"];
const STOP_WORDS = new Set(["a", "an", "the", "to", "for", "about", "my", "me", "please"]);

/**
 * Scores a message as task, note or idea from fixed word lists and a parseable date. Returns
 * undefined (let the caller decide, usually the AI provider) when the best score is weak or less
 * than 2 points ahead of the runner-up, so close calls are not guessed.
 */
export function classifyMessageDeterministically(text: string, timezone: string): Classification | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  const dueAt = parseDueDate(trimmed, timezone);
  const scores: IntentScore[] = [
    scoreTaskIntent(trimmed, lower, Boolean(dueAt)),
    scoreNoteIntent(lower),
    scoreIdeaIntent(lower)
  ];
  const best = scores.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 5) {
    return undefined;
  }

  const runnerUp = scores[1];
  if (runnerUp && best.score - runnerUp.score < 2) {
    return undefined;
  }

  const confidence = Math.min(0.97, 0.48 + best.score / 14);
  if (best.kind === "task") {
    return {
      kind: "task",
      confidence,
      reason: best.reasons.join("; "),
      suggestedTitle: structureTaskDeterministically(trimmed).title,
      dueDateText: dueAt ? trimmed : undefined
    };
  }

  return {
    kind: best.kind,
    confidence,
    reason: best.reasons.join("; "),
    suggestedTitle: summarize(stripLeadingCaptureWord(trimmed), 70)
  };
}

/**
 * Builds a task title by removing reminder wording ("remind me to", "add") and date phrases from
 * the text. The full original text is kept as the description.
 */
export function structureTaskDeterministically(text: string): StructuredTask {
  const cleaned = cleanTaskTitle(stripTaskShell(text));
  const title = sentenceCase(summarize(cleaned || text, 120));

  return {
    title,
    description: text.trim(),
    dueDateText: parseDueDate(text, "UTC") ? text : undefined
  };
}

/**
 * Builds a note title, body and summary locally. The title comes from the first clause minus
 * filler words.
 */
export function structureNoteDeterministically(text: string): StructuredNote {
  const body = cleanNoteText(stripLeadingCaptureWord(text));
  const title = titleCase(inferNoteTitle(body));
  const summary = summarize(body, 180);

  return {
    title: title || "Untitled Note",
    body: body || text.trim(),
    summary: summary || text.trim(),
    tags: []
  };
}

/**
 * True for notes worth sending to the AI for cleanup: very long, five or more real sentences, or
 * an explicit ask like "clean up" or "summarize". Short notes stay local and free.
 */
export function shouldUseAiForNoteStructure(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 700) {
    return true;
  }

  const sentenceCount = trimmed.split(/[.!?]\s+/).filter((part) => part.trim().length > 20).length;
  return sentenceCount >= 5 || /\b(clean up|polish|rewrite|summarize|summarise|organize|organise)\b/i.test(trimmed);
}

/**
 * Task score: explicit reminder or task wording, action verbs, and a parseable time each add points.
 */
function scoreTaskIntent(text: string, lower: string, hasDueDate: boolean): IntentScore {
  const reasons: string[] = [];
  let score = 0;

  if (startsWithAny(lower, REMINDER_STARTERS)) {
    score += 6;
    reasons.push("explicit reminder wording");
  }

  if (startsWithAny(lower, TASK_STARTERS)) {
    score += 4;
    reasons.push("task command-style wording");
  }

  const actions = TASK_ACTION_WORDS.filter((word) => hasTerm(lower, word));
  if (actions.length) {
    score += Math.min(4, actions.length + 1);
    reasons.push(`action verb: ${actions[0]}`);
  }

  if (hasDueDate) {
    score += 5;
    reasons.push("parseable reminder time");
  }

  if (/^(please\s+)?(?:can you|could you)\s+remind\s+me\b/i.test(text)) {
    score += 4;
    reasons.push("polite reminder request");
  }

  return { kind: "task", score, reasons };
}

/**
 * Note score from note-style openers ("note", "remember") and note words.
 */
function scoreNoteIntent(lower: string): IntentScore {
  const reasons: string[] = [];
  let score = 0;

  if (startsWithAny(lower, NOTE_STARTERS)) {
    score += 6;
    reasons.push("explicit note wording");
  }

  const terms = NOTE_TERMS.filter((word) => hasTerm(lower, word));
  if (terms.length) {
    score += Math.min(3, terms.length);
    reasons.push(`note signal: ${terms[0]}`);
  }

  return { kind: "note", score, reasons };
}

/**
 * Idea score from idea-style openers and product words ("app", "bot", "build").
 */
function scoreIdeaIntent(lower: string): IntentScore {
  const reasons: string[] = [];
  let score = 0;

  if (startsWithAny(lower, IDEA_STARTERS)) {
    score += 6;
    reasons.push("explicit idea wording");
  }

  const terms = IDEA_TERMS.filter((word) => hasTerm(lower, word));
  if (terms.length) {
    score += Math.min(4, terms.length + 1);
    reasons.push(`idea signal: ${terms[0]}`);
  }

  return { kind: "idea", score, reasons };
}

/**
 * Removes a leading "idea:", "note:" and similar label so it does not become the title.
 */
function stripLeadingCaptureWord(text: string): string {
  return text.replace(/^(idea|note|remember|save this|learned|insight|quote|build|app idea|tool idea|product idea|website idea)\s*:?\s*/i, "").trim();
}

/**
 * Removes request wrappers ("can you remind me to", "add task:") and all schedule phrases,
 * leaving just what needs doing.
 */
function stripTaskShell(text: string): string {
  return removeSchedulePhrases(
    text
      .trim()
      .replace(/^(please\s+)?(?:can you|could you)\s+/i, "")
      .replace(/^(please\s+)?remind\s+(me\s+)?(?:(to|about|for)\s+)?/i, "")
      .replace(/^set\s+(?:a\s+)?reminder\s+(?:for|to|about)?\s*/i, "")
      .replace(/^create\s+(?:a\s+)?reminder\s+(?:for|to|about)?\s*/i, "")
      .replace(/^(add|todo|task|reminder)\s*:?\s*/i, "")
      .replace(/\s*\|\s*/g, " ")
  )
    .replace(/\s+/g, " ")
    .replace(/[.,;:| -]+$/g, "")
    .trim();
}

/**
 * Deletes date and time wording so the task title does not repeat the due time.
 */
function removeSchedulePhrases(text: string): string {
  return text
    .replace(/\bday\s+after\s+tomorrow(?:\s+at\s+\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?)?\b/ig, "")
    .replace(/\b(?:today|tomorrow)(?:\s+(?:morning|afternoon|evening|night))?(?:\s+(?:at|by|before|around)?\s*\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?)?\b/ig, "")
    .replace(/\b(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)(?:\s+(?:at|by|before|around)?\s*\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?)?\b/ig, "")
    .replace(/\b(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:at|by|before|around)?\s*\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?)?\b/ig, "")
    .replace(/\bon\s+\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(?:at|by|before|around)?\s*\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?)?\b/ig, "")
    .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?(?:\s+(?:at|by|before|around)?\s*\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?)?\b/ig, "")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\b/g, "")
    .replace(/\b(?:in|after)\s+(?:(?:about|around|roughly|approximately|approx\.?)\s+)?(?:(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|sixty|half|quarter|couple(?:\s+of)?)\s*(?:minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*(?:and\s+)?)+/ig, "")
    .replace(/\b(?:at\s+)?(?:noon|midnight)(?:\s+(?:today|tomorrow))?\b/ig, "")
    .replace(/\b(?:at|by|before|around|no\s+later\s+than)\s+\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)?\b/ig, "")
    .replace(/\b\d{1,2}(?:[:.](\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)\b/ig, "")
    .replace(/\b(?:tonight|this\s+(?:morning|afternoon|evening|night)|end\s+of\s+(?:the\s+)?day|eod)\b/ig, "");
}

/**
 * Expands a few chat abbreviations (sth, asw, rly) and drops a leading article.
 */
function cleanTaskTitle(text: string): string {
  return text
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\bsth\b/gi, "something")
    .replace(/\basw\b/gi, "as well")
    .replace(/\brly\b/gi, "really")
    .trim();
}

function cleanNoteText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bsth\b/gi, "something")
    .replace(/\basw\b/gi, "as well")
    .replace(/\brly\b/gi, "really")
    .replace(/\s*->\s*/g, " -> ");
}

/**
 * Note title from the first clause, without filler words, capped at 70 characters.
 */
function inferNoteTitle(text: string): string {
  const segment = text.split(/\s*->\s*|[.:;]/)[0]?.trim() || text;
  const words = segment.split(/\s+/).filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  return summarize(words.length ? words.join(" ") : segment, 70);
}

function startsWithAny(lower: string, starters: string[]): boolean {
  return starters.some((starter) => lower === starter || lower.startsWith(`${starter} `));
}

function summarize(text: string, maxLength: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function sentenceCase(text: string): string {
  if (!text) return text;
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Whole-word, case-insensitive match, so "app" does not match "apple".
 */
function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
