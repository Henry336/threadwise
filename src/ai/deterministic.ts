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

export function structureTaskDeterministically(text: string): StructuredTask {
  const cleaned = cleanTaskTitle(stripTaskShell(text));
  const title = sentenceCase(summarize(cleaned || text, 120));

  return {
    title,
    description: text.trim(),
    dueDateText: parseDueDate(text, "UTC") ? text : undefined
  };
}

export function structureNoteDeterministically(text: string): StructuredNote {
  const body = cleanNoteText(stripLeadingCaptureWord(text));
  const title = titleCase(inferNoteTitle(body));
  const summary = summarize(body, 180);

  return {
    title: title || "Untitled Note",
    body: body || text.trim(),
    summary: summary || text.trim(),
    tags: inferTags(`${title} ${body}`)
  };
}

export function shouldUseAiForNoteStructure(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 700) {
    return true;
  }

  const sentenceCount = trimmed.split(/[.!?]\s+/).filter((part) => part.trim().length > 20).length;
  return sentenceCount >= 5 || /\b(clean up|polish|rewrite|summarize|summarise|organize|organise)\b/i.test(trimmed);
}

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

function stripLeadingCaptureWord(text: string): string {
  return text.replace(/^(idea|note|remember|save this|learned|insight|quote|build|app idea|tool idea|product idea|website idea)\s*:?\s*/i, "").trim();
}

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

function removeSchedulePhrases(text: string): string {
  return text
    .replace(/\bday\s+after\s+tomorrow(?:\s+at\s+\d{1,2}(?::(\d{2}))?\s*(?:am|pm)?)?\b/ig, "")
    .replace(/\b(?:today|tomorrow)(?:\s+at\s+\d{1,2}(?::(\d{2}))?\s*(?:am|pm)?)?\b/ig, "")
    .replace(/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::(\d{2}))?\s*(?:am|pm)?)?\b/ig, "")
    .replace(/\bon\s+\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+at\s+\d{1,2}(?::(\d{2}))?\s*(?:am|pm)?)?\b/ig, "")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\b/g, "")
    .replace(/\b(?:in|after)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half(?:\s+an?)?)\s*(?:minute|minutes|min|mins|m|hour|hours|hr|hrs|day|days)\b/ig, "")
    .replace(/\b(?:at\s+)?(?:noon|midnight)(?:\s+(?:today|tomorrow))?\b/ig, "")
    .replace(/\b(?:at|by|before|around|no\s+later\s+than)\s+\d{1,2}(?::(\d{2}))?\s*(?:am|pm)?\b/ig, "")
    .replace(/\b\d{1,2}(?::(\d{2}))?\s*(?:am|pm)\b/ig, "");
}

function cleanTaskTitle(text: string): string {
  return text
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\bsth\b/gi, "something")
    .replace(/\brly\b/gi, "really")
    .trim();
}

function cleanNoteText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bsth\b/gi, "something")
    .replace(/\brly\b/gi, "really")
    .replace(/\s*->\s*/g, " -> ");
}

function inferNoteTitle(text: string): string {
  const segment = text.split(/\s*->\s*|[.:;]/)[0]?.trim() || text;
  const words = segment.split(/\s+/).filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  return summarize(words.length ? words.join(" ") : segment, 70);
}

function inferTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags = new Set<string>();

  if (hasTerm(lower, "telegram") || hasTerm(lower, "bot")) tags.add("bot");
  if (hasTerm(lower, "task") || hasTerm(lower, "todo") || hasTerm(lower, "remind")) tags.add("tasks");
  if (hasTerm(lower, "calendar") || hasTerm(lower, "schedule") || hasTerm(lower, "meeting")) tags.add("calendar");
  if (hasTerm(lower, "ai") || hasTerm(lower, "model") || hasTerm(lower, "prompt")) tags.add("ai");
  if (hasTerm(lower, "product manager") || hasTerm(lower, "product") || hasTerm(lower, "software design")) tags.add("product");
  if (hasTerm(lower, "client") || hasTerm(lower, "customer")) tags.add("clients");
  if (hasTerm(lower, "selling") || hasTerm(lower, "sales") || hasTerm(lower, "closed deals")) tags.add("sales");
  if (hasTerm(lower, "api") || hasTerm(lower, "documentation") || hasTerm(lower, "documentations")) tags.add("technical");
  if (hasTerm(lower, "career") || hasTerm(lower, "role") || hasTerm(lower, "working with")) tags.add("career");
  if (hasTerm(lower, "school") || hasTerm(lower, "class") || hasTerm(lower, "exam")) tags.add("school");
  if (hasTerm(lower, "gift") || hasTerm(lower, "birthday")) tags.add("personal");

  return [...tags].slice(0, 5);
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

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
