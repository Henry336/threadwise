import { StudyResourceKind, StudyTrafficLight } from "@prisma/client";
import { structureNoteDeterministically, structureTaskDeterministically } from "../ai/deterministic";
import { parseDueDate } from "../utils/dates";

export type StudyNaturalIntent =
  | { kind: "menu" }
  | { kind: "study_dashboard" }
  | { kind: "timetable" }
  | { kind: "onboarding" }
  | { kind: "canvas_sync" }
  | { kind: "canvas_status" }
  | { kind: "attention" }
  | { kind: "weekly_preview" }
  | { kind: "weekly_plan" }
  | { kind: "weekly_review" }
  | { kind: "record_mistake" }
  | { kind: "upcoming" }
  | { kind: "modules" }
  | { kind: "switch_module"; reference: string }
  | { kind: "create_task"; title: string; sourceText: string; moduleReference?: string; dueAt?: Date }
  | { kind: "complete_item"; reference: string }
  | { kind: "reschedule_item"; reference: string; dueAt: Date }
  | { kind: "set_mastery"; reference: string; mastery: StudyTrafficLight; reason?: string }
  | { kind: "start_session"; moduleReference?: string }
  | { kind: "stop_session" }
  | { kind: "note_session_start"; moduleReference?: string }
  | { kind: "note_session_save" }
  | { kind: "note_session_cancel" }
  | { kind: "create_resource"; resourceKind: StudyResourceKind; body: string; title?: string; url?: string; moduleReference?: string }
  | { kind: "list_resources"; resourceKind?: StudyResourceKind; moduleReference?: string; query?: string }
  | { kind: "search"; query: string }
  | { kind: "origins" }
  | { kind: "origin_help" }
  | { kind: "origin_add"; name: string; venue: string; makeDefault: boolean }
  | { kind: "origin_activate"; reference: string; hours?: number }
  | { kind: "origin_here"; venue: string; hours?: number }
  | { kind: "origin_rename"; reference: string; name: string }
  | { kind: "origin_delete"; reference: string }
  | { kind: "route"; destination: string; origin?: string }
  | { kind: "help" }
  | { kind: "ambiguous"; sourceText: string; moduleReference?: string };

export function parseStudyNaturalLanguage(text: string, timezone: string): StudyNaturalIntent | undefined {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();

  if (/^(?:(?:open|show|visit)\s+)?(?:the\s+)?(?:study\s+)?dashboard$/i.test(trimmed)) return { kind: "study_dashboard" };
  if (/^(?:(?:open|show|view)\s+)?(?:my\s+)?(?:study\s+)?(?:timetable|class schedule)$/i.test(trimmed)
    || /^what (?:classes|lessons) do i have(?: today| this week)?\??$/i.test(trimmed)) return { kind: "timetable" };
  if (/^(?:study\s+)?(?:menu|home)$/i.test(trimmed)) return { kind: "menu" };
  if (/^(?:start|show|open|continue)\s+(?:study\s+)?(?:setup|onboarding)$/i.test(trimmed)) return { kind: "onboarding" };
  if (/^(?:study\s+)?help$/i.test(trimmed) || /^(?:what can (?:study mode|you) do|how do i use study mode)\??$/i.test(trimmed)) return { kind: "help" };
  if (/^(?:sync|refresh|update)(?:\s+my)?\s+canvas(?:\s+(?:assignments?|tasks?))?$/i.test(trimmed)) return { kind: "canvas_sync" };
  if (/^(?:show|check|what(?:'s| is))\s+(?:the\s+)?canvas\s+(?:status|connection)|^canvas\s+status$/i.test(trimmed)) return { kind: "canvas_status" };
  if (/^(?:what|which)\s+(?:needs?|need)\s+(?:my\s+)?attention\??$/i.test(trimmed)
    || /^(?:show|open)\s+(?:my\s+)?(?:attention|priorities)$/i.test(trimmed)
    || /^what should i (?:do|study|work on)(?: next| now)?\??$/i.test(trimmed)) return { kind: "attention" };
  if (/^(?:(?:show|give me|open)\s+(?:my\s+)?)?(?:weekly preview|week ahead)$|^what(?:'s| is) coming up this week\??$/i.test(trimmed)) return { kind: "weekly_preview" };
  if (/^(?:plan|set up|organise|organize)\s+(?:my\s+)?(?:week|weekly priorities)$/i.test(trimmed)) return { kind: "weekly_plan" };
  if (/^(?:start|begin|do|open)?\s*(?:my\s+)?weekly review$|^review\s+(?:my\s+)?week$/i.test(trimmed)) return { kind: "weekly_review" };
  if (/^(?:record|log|add)\s+(?:a\s+)?(?:study\s+)?mistake$/i.test(trimmed)) return { kind: "record_mistake" };
  if (/^(?:show|open|list)\s+(?:my\s+)?(?:upcoming|assignments?|tasks?|deadlines?)$/i.test(trimmed)) return { kind: "upcoming" };
  if (/^(?:show|open|list)\s+(?:my\s+)?modules$/i.test(trimmed) || /^modules$/i.test(trimmed)) return { kind: "modules" };
  if (/^(?:save|finish)(?:\s+the)?\s+note(?:taking)?\s+(?:session|mode)$/i.test(trimmed) || /^save note$/i.test(trimmed)) return { kind: "note_session_save" };
  if (/^(?:cancel|discard|stop)(?:\s+the)?\s+note(?:taking)?\s+(?:session|mode)$/i.test(trimmed) || /^cancel note$/i.test(trimmed)) return { kind: "note_session_cancel" };
  if (/^(?:stop|finish|end)(?:\s+my|\s+the)?\s+(?:study\s+)?session$/i.test(trimmed)) return { kind: "stop_session" };

  const moduleSwitch = trimmed.match(/^(?:open|switch|change|go|move)\s+(?:to\s+)?(?:module\s+)?([a-z]{2,6}\s*\d{3,5}[a-z]?)$/i)
    ?? trimmed.match(/^(?:study|module)\s+([a-z]{2,6}\s*\d{3,5}[a-z]?)$/i);
  if (moduleSwitch?.[1]) return { kind: "switch_module", reference: normalizeModule(moduleSwitch[1]) };

  const startNote = trimmed.match(/^(?:start|begin|enter)(?:\s+a)?\s+(?:silent\s+)?note(?:taking)?\s+(?:session|mode)(?:\s+(?:for|in)\s+([a-z]{2,6}\s*\d{3,5}[a-z]?))?$/i);
  if (startNote) return { kind: "note_session_start", moduleReference: startNote[1] ? normalizeModule(startNote[1]) : undefined };
  const startSession = trimmed.match(/^(?:start|begin)(?:\s+a)?\s+(?:study|focus|deep work)\s+session(?:\s+(?:for|in|on)\s+([a-z]{2,6}\s*\d{3,5}[a-z]?))?$/i);
  if (startSession) return { kind: "start_session", moduleReference: startSession[1] ? normalizeModule(startSession[1]) : undefined };

  const completion = trimmed.match(/^(?:mark\s+)?(study[-\s]?\d+)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i)
    ?? trimmed.match(/^(?:done|complete|finish)\s+(study[-\s]?\d+)$/i);
  if (completion?.[1]) return { kind: "complete_item", reference: normalizeStudyId(completion[1]) };
  const reschedule = trimmed.match(/^(?:reschedule|move|change)\s+(study[-\s]?\d+)\s+(?:to|for|until|by)\s+(.+)$/i);
  if (reschedule?.[1] && reschedule[2]) {
    const dueAt = parseDueDate(reschedule[2], timezone);
    if (dueAt) return { kind: "reschedule_item", reference: normalizeStudyId(reschedule[1]), dueAt };
  }

  const mastery = trimmed.match(/^(?:set\s+)?([a-z]{2,6}\s*\d{3,5}[a-z]?|study[-\s]?\d+)\s+(?:mastery\s+)?(?:to\s+)?(green|amber|red)(?:\s+(?:because|since|-)\s+(.+))?$/i);
  if (mastery?.[1] && mastery[2]) {
    return {
      kind: "set_mastery",
      reference: /^study/i.test(mastery[1]) ? normalizeStudyId(mastery[1]) : normalizeModule(mastery[1]),
      mastery: mastery[2].toUpperCase() as StudyTrafficLight,
      reason: mastery[3]?.trim(),
    };
  }

  if (/^(?:(?:how|where)\s+(?:do|can)\s+i\s+|please\s+)?(?:add|save|create|set\s*up)\s+(?:a\s+|my\s+)?(?:travel\s+)?origin\??$/i.test(trimmed)
    || /^(?:how|where)\s+(?:do|can)\s+i\s+(?:manage|configure)\s+(?:my\s+)?(?:travel\s+)?origins?\??$/i.test(trimmed)) return { kind: "origin_help" };
  if (/^(?:show|list|manage)(?:\s+my)?\s+(?:travel\s+)?origins$/i.test(trimmed) || /^(?:travel\s+)?origins$/i.test(trimmed)) return { kind: "origins" };
  const addOrigin = trimmed.match(/^(?:add|save|create)(?:\s+(?:a|my))?\s+(?:travel\s+)?origin\s+(.+?)\s+(?:at|for|near)\s+(.+?)(?:\s+as\s+(?:the\s+)?default)?$/i);
  if (addOrigin?.[1] && addOrigin[2]) return {
    kind: "origin_add",
    name: addOrigin[1].trim(),
    venue: addOrigin[2].replace(/\s+as\s+(?:the\s+)?default$/i, "").trim(),
    makeDefault: /\s+as\s+(?:the\s+)?default$/i.test(trimmed),
  };
  const activateOrigin = trimmed.match(/^(?:use|switch to)\s+origin\s+(.+?)(?:\s+for\s+(\d+)\s*hours?)?$/i)
    ?? trimmed.match(/^switch\s+(?:my\s+)?origin\s+to\s+(.+?)(?:\s+for\s+(\d+)\s*hours?)?$/i)
    ?? trimmed.match(/^use\s+(.+?)\s+as\s+(?:my\s+)?(?:current\s+)?origin(?:\s+for\s+(\d+)\s*hours?)?$/i)
    ?? trimmed.match(/^set\s+(?:my\s+)?(?:current\s+)?origin\s+(?:to\s+)?(.+?)(?:\s+for\s+(\d+)\s*hours?)?$/i);
  if (activateOrigin?.[1]) return {
    kind: "origin_activate",
    reference: activateOrigin[1].trim(),
    hours: activateOrigin[2] ? Number(activateOrigin[2]) : undefined,
  };
  const here = trimmed.match(/^i(?:'m| am)\s+(?:currently\s+)?at\s+(.+?)(?:\s+for\s+(\d+)\s*hours?)?$/i);
  if (here?.[1]) return { kind: "origin_here", venue: here[1].trim(), hours: here[2] ? Number(here[2]) : undefined };
  const renameOrigin = trimmed.match(/^rename\s+(?:travel\s+)?origin\s+(.+?)\s+to\s+(.+)$/i);
  if (renameOrigin?.[1] && renameOrigin[2]) return { kind: "origin_rename", reference: renameOrigin[1].trim(), name: renameOrigin[2].trim() };
  const deleteOrigin = trimmed.match(/^(?:delete|remove)\s+(?:travel\s+)?origin\s+(.+)$/i);
  if (deleteOrigin?.[1]) return { kind: "origin_delete", reference: deleteOrigin[1].trim() };
  const routeFrom = trimmed.match(/^(?:how do i get|route|directions|navigate)\s+from\s+(.+?)\s+to\s+(.+?)\??$/i);
  if (routeFrom?.[1] && routeFrom[2]) return {
    kind: "route",
    destination: routeFrom[2].trim().replace(/[?]+$/, ""),
    origin: routeFrom[1].trim().replace(/[?]+$/, ""),
  };
  const route = trimmed.match(/^(?:how do i get|route|directions|when should i leave|take me|navigate|guide me)\s+(?:to|for)\s+(.+?)(?:\s+from\s+(.+))?\??$/i);
  if (route?.[1]) return {
    kind: "route",
    destination: route[1].trim().replace(/[?]+$/, ""),
    origin: route[2]?.trim().replace(/[?]+$/, ""),
  };

  const search = trimmed.match(/^(?:search|find|look for)\s+(?:study\s+)?(?:for\s+)?(.+)$/i);
  if (search?.[1]) return { kind: "search", query: search[1].trim() };
  const list = parseListResources(trimmed);
  if (list) return list;

  const explicit = parseExplicitResource(trimmed);
  if (explicit) return explicit;

  const task = taskIntent(trimmed, timezone);
  if (task) return task;

  const extracted = extractModuleReference(trimmed);
  return { kind: "ambiguous", sourceText: extracted.text, moduleReference: extracted.moduleReference };
}

function taskIntent(text: string, timezone: string): Extract<StudyNaturalIntent, { kind: "create_task" }> | undefined {
  const explicit = /^(?:todo|to-do|task|assignment|deadline)\s*[:\-]/i.test(text)
    || /^(?:add|create|save)\s+(?:a\s+)?(?:task|assignment|deadline)\b/i.test(text);
  if (!explicit) return undefined;
  const extracted = extractModuleReference(text);
  const source = extracted.text
    .replace(/^(?:todo|to-do|task|assignment|deadline)\s*[:\-]\s*/i, "")
    .replace(/^(?:add|create|save)\s+(?:a\s+)?(?:task|assignment|deadline)\s*(?:to\s+)?/i, "")
    .trim();
  const structured = structureTaskDeterministically(source || text);
  return {
    kind: "create_task",
    title: structured.title,
    sourceText: source || text,
    moduleReference: extracted.moduleReference,
    dueAt: parseDueDate(source || text, timezone),
  };
}

function parseExplicitResource(text: string): Extract<StudyNaturalIntent, { kind: "create_resource" }> | undefined {
  const extracted = extractModuleReference(text);
  const patterns: Array<[StudyResourceKind, RegExp]> = [
    [StudyResourceKind.NOTE, /^(?:note|study note|remember this)\s*[:\-]\s*(.+)$/i],
    [StudyResourceKind.QUESTION, /^(?:question|doubt|ask later)\s*[:\-]\s*(.+)$/i],
    [StudyResourceKind.LINK, /^(?:link|resource|reference)\s*[:\-]\s*(.+)$/i],
  ];
  for (const [resourceKind, pattern] of patterns) {
    const match = extracted.text.match(pattern);
    if (!match?.[1]) continue;
    const body = match[1].trim();
    const url = firstUrl(body);
    const note = structureNoteDeterministically(body);
    return { kind: "create_resource", resourceKind, body, title: note.title, url, moduleReference: extracted.moduleReference };
  }
  const saveAs = extracted.text.match(/^save\s+(.+?)\s+as\s+(?:a\s+)?(note|question|resource|link)$/i);
  if (saveAs?.[1] && saveAs[2]) {
    const resourceKind = /question/i.test(saveAs[2]) ? StudyResourceKind.QUESTION : /(?:resource|link)/i.test(saveAs[2]) ? StudyResourceKind.LINK : StudyResourceKind.NOTE;
    const body = saveAs[1].trim();
    return { kind: "create_resource", resourceKind, body, title: structureNoteDeterministically(body).title, url: firstUrl(body), moduleReference: extracted.moduleReference };
  }
  const url = firstUrl(extracted.text);
  if (url && extracted.text.replace(url, "").trim().length <= 160) {
    return { kind: "create_resource", resourceKind: StudyResourceKind.LINK, body: extracted.text, url, moduleReference: extracted.moduleReference };
  }
  return undefined;
}

function parseListResources(text: string): Extract<StudyNaturalIntent, { kind: "list_resources" }> | undefined {
  const match = text.match(/^(?:show|list|open|recent)(?:\s+my)?\s+(?:study\s+)?(notes?|questions?|resources?|links?|images?|files?)(?:\s+(?:for|in)\s+([a-z]{2,6}\s*\d{3,5}[a-z]?))?$/i);
  if (!match?.[1]) return undefined;
  const noun = match[1].toLowerCase();
  const resourceKind = noun.startsWith("note") ? StudyResourceKind.NOTE
    : noun.startsWith("question") ? StudyResourceKind.QUESTION
      : noun.startsWith("image") ? StudyResourceKind.IMAGE
        : noun.startsWith("file") ? StudyResourceKind.FILE
          : noun.startsWith("link") ? StudyResourceKind.LINK
            : undefined;
  return { kind: "list_resources", resourceKind, moduleReference: match[2] ? normalizeModule(match[2]) : undefined };
}

function extractModuleReference(text: string): { text: string; moduleReference?: string } {
  const leading = text.match(/^\[?([a-z]{2,6}\s*\d{3,5}[a-z]?)\]?\s*[:\-]\s*(.+)$/i);
  if (leading?.[1] && leading[2]) return { text: leading[2].trim(), moduleReference: normalizeModule(leading[1]) };
  const leadingIntent = text.match(/^\[?([a-z]{2,6}\s*\d{3,5}[a-z]?)\]?\s+((?:todo|to-do|task|assignment|deadline|note|question|resource|link)\b.*)$/i);
  if (leadingIntent?.[1] && leadingIntent[2]) return { text: leadingIntent[2].trim(), moduleReference: normalizeModule(leadingIntent[1]) };
  const trailing = text.match(/\s+(?:for|in|under)\s+([a-z]{2,6}\s*\d{3,5}[a-z]?)\s*$/i);
  if (trailing?.[1]) return {
    text: text.slice(0, trailing.index).trim(),
    moduleReference: normalizeModule(trailing[1]),
  };
  const contextual = text.match(/\b(?:for|in|under)\s+([a-z]{2,6}\s*\d{3,5}[a-z]?)\b/i);
  if (contextual?.[1] && contextual.index !== undefined) {
    const end = contextual.index + contextual[0].length;
    return {
      text: `${text.slice(0, contextual.index)} ${text.slice(end)}`.replace(/\s+/g, " ").trim(),
      moduleReference: normalizeModule(contextual[1]),
    };
  }
  return { text };
}

function firstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s<>()]+/i)?.[0]?.replace(/[.,;!?]+$/, "");
}

function normalizeModule(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function normalizeStudyId(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "-");
}
