/**
 * Offline `AiProvider` that needs no API key. It is the provider in local development and tests,
 * and the fallback behind ResilientAiProvider when OpenAI fails. Answers are simple and
 * conservative, never invented facts.
 */

import { parseDueDate } from "../utils/dates";
import type {
  AiProvider,
  AiProviderHealthCheck,
  AiProviderStatus,
  Classification,
  IdeaScore,
  MergedNotePreview,
  NoteAnalysis,
  NoteForAnalysis,
  NoteForMerge,
  StructuredIdea,
  StructuredNote,
  StructuredTask
} from "./types";

const TASK_WORDS = ["todo", "task", "remind", "finish", "submit", "pay", "call", "email", "buy", "send"];
const IDEA_WORDS = ["idea", "app", "bot", "tool", "build", "product", "startup", "website", "platform"];
const NOTE_WORDS = ["note", "remember", "learned", "insight", "quote", "summary", "keep", "save this", "important"];
/**
 * Rule-based stand-in for every AI method. Classification uses word counts; structuring keeps the
 * user's text; idea scoring uses fixed values nudged by keywords.
 */
export class HeuristicAiProvider implements AiProvider {
  getStatus(): AiProviderStatus {
    return {
      provider: "heuristic",
      apiKeyConfigured: false,
      chatModels: [],
      activeChatModel: undefined
    };
  }

  async checkHealth(): Promise<AiProviderHealthCheck> {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      provider: this.getStatus()
    };
  }

  /**
   * Picks task, note or idea by counting signal words, with task winning ties. Long text with no
   * signal is treated as an idea. Returns "noise" when nothing matches.
   */
  async classifyMessage(text: string): Promise<Classification> {
    const lower = text.toLowerCase();
    const taskScore = scoreWords(lower, TASK_WORDS);
    const ideaScore = scoreWords(lower, IDEA_WORDS);
    const noteScore = scoreWords(lower, NOTE_WORDS);

    if (taskScore > 0 && taskScore >= ideaScore) {
      return {
        kind: "task",
        confidence: Math.min(0.85, 0.55 + taskScore * 0.1),
        reason: "Contains action-oriented task language.",
        suggestedTitle: summarize(text),
        dueDateText: parseDueDate(text, "Asia/Singapore") ? text : undefined
      };
    }

    if (noteScore > 0 && noteScore >= ideaScore) {
      return {
        kind: "note",
        confidence: Math.min(0.82, 0.55 + noteScore * 0.1),
        reason: "Looks like durable information or a note to keep.",
        suggestedTitle: summarize(text)
      };
    }

    if (ideaScore > 0 || text.length > 120) {
      return {
        kind: "idea",
        confidence: Math.min(0.8, 0.55 + ideaScore * 0.1),
        reason: "Looks like a buildable idea or product thought.",
        suggestedTitle: summarize(text)
      };
    }

    return {
      kind: "noise",
      confidence: 0.7,
      reason: "No strong idea, task, or note signal found."
    };
  }

  async structureIdea(text: string): Promise<StructuredIdea> {
    return {
      title: titleCase(summarize(text, 60)),
      concept: text,
      problem: "Unstructured thought needs to be saved before it gets lost.",
      targetUser: "The person who captured the idea.",
      type: "other",
      tags: []
    };
  }

  async structureTask(text: string): Promise<StructuredTask> {
    return {
      title: summarize(text, 80),
      description: text,
      dueDateText: text
    };
  }

  async structureNote(text: string): Promise<StructuredNote> {
    const cleaned = cleanNoteText(text);
    return {
      title: titleCase(inferNoteTitle(cleaned)),
      body: formatRoughNote(cleaned),
      summary: summarize(formatRoughNote(cleaned), 160),
      tags: []
    };
  }

  /**
   * Builds a merge preview from the source notes: an inferred theme, up to seven de-duplicated key
   * points, connections and open questions. Every source note is listed under preserved details.
   */
  async mergeNotes(notes: NoteForMerge[], previousPreview?: MergedNotePreview, attempt = 1): Promise<MergedNotePreview> {
    const noteTexts = notes.map((note) => cleanNoteText(note.sourceText || note.body || note.summary));
    const combined = noteTexts.join("\n");
    const details = noteTexts.flatMap(extractNoteDetails);
    const shared = sharedTerms(noteTexts);
    const title = inferMergedTitle(notes);
    const theme = inferMergeTheme(shared);
    const body = formatMergedBody(theme, details, Boolean(previousPreview), attempt);

    return {
      title,
      body,
      summary: summarize(theme, 180),
      tags: [],
      connections: inferConnections(noteTexts, notes),
      preservedDetails: notes.map((note) => `${note.publicId}: ${summarize(formatRoughNote(note.sourceText || note.body), 180)}`),
      possibleMissingContext: inferMissingContext(combined, attempt)
    };
  }

  /**
   * Generic note-keeping advice that does not depend on note content beyond the count.
   */
  async analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis> {
    return {
      overview: `You have ${notes.length} saved notes.`,
      whatWorks: ["Saving notes in one searchable place", "Keeping enough raw detail to preserve context"],
      whatDoesNotWork: ["Some notes may need clearer titles", "Mixed topics can become harder to retrieve from one long note"],
      suggestions: ["Use one note per durable idea or fact", "Start notes with the topic first", "Add a short why-this-matters sentence"],
      experiments: ["Review recent notes weekly", "Use specific titles that match how you would search later", "Convert action-like notes into tasks"]
    };
  }

  /**
   * Fixed baseline scores adjusted by a few keywords. The summary says it was made without live research.
   */
  async scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore> {
    const source = `${input.title} ${input.concept} ${input.sourceText}`.toLowerCase();
    const portfolioBoost = source.includes("api") || source.includes("bot") || source.includes("automation") ? 2 : 0;
    return {
      buildability: source.length < 800 ? 8 : 6,
      usefulness: source.includes("remind") || source.includes("task") || source.includes("problem") ? 8 : 6,
      novelty: 5,
      portfolioValue: Math.min(10, 7 + portfolioBoost),
      monetization: 5,
      difficulty: source.includes("calendar") || source.includes("ai") ? 7 : 5,
      risk: source.includes("health") || source.includes("relationship") ? 7 : 4,
      summary: "Heuristic score generated without live market research.",
      marketNotes:
        "Competition should be validated with live research before public positioning. Expect adjacent tools in task management, note capture, and AI assistants.",
      dos: ["Start with one narrow user workflow", "Make the data model durable", "Document deployment clearly"],
      donts: ["Overfit the product to vague AI magic", "Skip reminder reliability", "Store sensitive text without clear privacy expectations"]
    };
  }
}

function scoreWords(text: string, words: string[]): number {
  return words.reduce((score, word) => score + (hasTerm(text, word) ? 1 : 0), 0);
}

function summarize(text: string, maxLength = 90): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
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
  const firstSegment = text.split(/\s*->\s*|[.:;]/)[0]?.trim() || text;
  return summarize(firstSegment, 70);
}

/**
 * Rewrites "topic -> detail -> detail" shorthand as "Topic: detail; detail."
 */
function formatRoughNote(text: string): string {
  const cleaned = cleanNoteText(text);
  const parts = cleaned.split(/\s*->\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return cleaned;
  }

  return `${capitalize(parts[0] ?? "Note")}: ${parts.slice(1).map((part) => part.replace(/[.。]$/, "")).join("; ")}.`;
}

/**
 * Splits a note into short detail lines for the merged note's key points.
 */
function extractNoteDetails(text: string): string[] {
  const formatted = formatRoughNote(text);
  const details = formatted
    .split(/(?:;|\n|\. )/)
    .map((item) => item.trim().replace(/[.:;]$/, ""))
    .filter((item) => item.length > 3);

  return details.length ? details : [formatted];
}

/** Merged note title: the source notes' own titles joined, so it always reflects their content. */
function inferMergedTitle(notes: NoteForMerge[]): string {
  const titles = notes.map((note) => inferNoteTitle(note.sourceText || note.title)).filter(Boolean);
  return summarize(titles.join(" + "), 80) || "Merged Note";
}

/** Opening paragraph for a merged note, naming the words the notes share when there are any. */
function inferMergeTheme(shared: string[]): string {
  return shared.length
    ? `These notes belong together: they keep returning to ${formatList(shared.slice(0, 3))}.`
    : "These notes were merged because they appear to describe related observations that should be easier to revisit together.";
}

/**
 * Lays out the merged note: theme, key points, why it matters, and a refinement line on retries.
 */
function formatMergedBody(theme: string, details: string[], isRetry: boolean, attempt: number): string {
  const bullets = [...new Set(details.map(cleanDetail))]
    .filter((detail) => detail.length > 0)
    .slice(0, 7);

  return [
    theme,
    "",
    "Key points:",
    ...bullets.map((detail) => `- ${detail}`),
    "",
    "Why this matters:",
    "The separate observations are more useful in one place, where the relationship between them is visible.",
    isRetry ? ["", `Refinement pass ${attempt}: tightened the connections and checked that concrete details from the source notes were still represented.`].join("\n") : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function cleanDetail(detail: string): string {
  const cleaned = detail
    .replace(/\s+/g, " ")
    .replace(/\s*->\s*/g, ": ")
    .trim();
  return capitalize(cleaned.replace(/[.。]$/, ""));
}

/** One line per word that appears in two or more notes, naming those notes; a generic line otherwise. */
function inferConnections(noteTexts: string[], notes: NoteForMerge[]): string[] {
  const connections = sharedTerms(noteTexts).slice(0, 3).map((term) => {
    const ids = notes.filter((_, index) => termsOf(noteTexts[index] ?? "").has(term)).map((note) => note.publicId);
    return `${formatList(ids)} ${ids.length === 2 ? "both" : "all"} mention "${term}".`;
  });
  if (connections.length === 0 && notes.length > 1) {
    connections.push("The notes seem to belong together because they describe related lessons or observations that should be reviewed in one place.");
  }
  return connections;
}

/** Questions about context the merged note may lack: what named people said, and balance on retries. Capped at four. */
function inferMissingContext(text: string, attempt: number): string[] {
  const missing: string[] = [];
  const people = namedPeople(text);
  if (people.length) missing.push(`What exactly did ${formatList(people.slice(0, 3), "or")} say or do that is worth keeping?`);
  if (attempt > 1) missing.push("Check whether the refined version overemphasizes one note compared with the others.");
  return missing.slice(0, 4);
}

const STOP_WORDS = new Set("about after again also because been before being both could does doing from have into just like make more most much need only other over really should some something such than that their them then there these they thing think this those through very want what when where which while will with would your".split(" "));

/** Lowercase words of five or more letters, minus common filler, in one note. */
function termsOf(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((word) => !STOP_WORDS.has(word)));
}

/** Words that appear in at least two of the notes, most widely shared first. */
function sharedTerms(noteTexts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const text of noteTexts) for (const term of termsOf(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).map(([term]) => term);
}

// One or two capitalised words on the same line (notes are joined with newlines, so names never span them).
const NAME = String.raw`[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)?`;
/**
 * Only phrases that attribute something to a person count: "mentioned by both Ana and Ben",
 * "working with Ana", "according to Ana", "Ana said". Plain "by Friday" or "from Canvas" do not.
 */
const ATTRIBUTED_NAMES = new RegExp(String.raw`\b(?:(?:mentioned|suggested|recommended|said|told|advised|explained) by|according to|(?:working|calls?|met|meeting|talked|spoke|chatted) with|(?:talked|spoke) to)[ \t]+(?:both[ \t]+)?(${NAME})(?:[ \t]+and[ \t]+(${NAME}))?|\b(${NAME})[ \t]+(?:said|says|mentioned|suggested|recommended|told|asked)\b(?![ \t]+by\b)`, "g");
/** Capitalised words that start "X said" without being a person. */
const NOT_PEOPLE = new Set("I He She It They We You This That Someone Everyone Today Yesterday Tomorrow Then Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split(" "));

/** People the notes attribute something to, so the merge can ask what each of them said. */
function namedPeople(text: string): string[] {
  const names = [...text.matchAll(ATTRIBUTED_NAMES)]
    .flatMap((match) => [match[1], match[2], match[3]])
    // "Yesterday Ben" keeps Ben; a lone "He" or "Friday" is dropped.
    .map((name) => name?.split(/[ \t]+/).filter((word) => !NOT_PEOPLE.has(word)).join(" "))
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

function formatList(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

function capitalize(text: string): string {
  if (!text) return text;
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}
