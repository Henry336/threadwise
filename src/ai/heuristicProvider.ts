import { parseDueDate } from "../utils/dates";
import { deterministicEmbedding } from "../utils/vector";
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
export class HeuristicAiProvider implements AiProvider {
  getStatus(): AiProviderStatus {
    return {
      provider: "heuristic",
      apiKeyConfigured: false,
      chatModels: [],
      activeChatModel: undefined,
      embeddingModel: "local-deterministic"
    };
  }

  async checkHealth(): Promise<AiProviderHealthCheck> {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      provider: this.getStatus()
    };
  }

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
      tags: inferTags(text)
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
      tags: inferTags(cleaned)
    };
  }

  async mergeNotes(notes: NoteForMerge[], previousPreview?: MergedNotePreview, attempt = 1): Promise<MergedNotePreview> {
    const noteTexts = notes.map((note) => cleanNoteText(note.sourceText || note.body || note.summary));
    const combined = noteTexts.join("\n");
    const details = noteTexts.flatMap(extractNoteDetails);
    const tags = [...new Set([...notes.flatMap((note) => note.tags), ...inferTags(combined)])].slice(0, 6);
    const title = inferMergedTitle(combined, notes);
    const theme = inferMergeTheme(combined);
    const body = formatMergedBody(theme, details, combined, Boolean(previousPreview), attempt);

    return {
      title,
      body,
      summary: summarize(theme, 180),
      tags,
      connections: inferConnections(combined, notes),
      preservedDetails: notes.map((note) => `${note.publicId}: ${summarize(formatRoughNote(note.sourceText || note.body), 180)}`),
      possibleMissingContext: inferMissingContext(combined, attempt)
    };
  }

  async analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis> {
    const tagCounts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const commonTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    return {
      overview: `You have ${notes.length} saved notes${commonTags.length ? `, often around ${commonTags.join(", ")}` : ""}.`,
      whatWorks: ["Saving notes in one searchable place", "Keeping enough raw detail to preserve context"],
      whatDoesNotWork: ["Some notes may need clearer titles", "Mixed topics can become harder to retrieve without tags"],
      suggestions: ["Use one note per durable idea or fact", "Start notes with the topic first", "Add a short why-this-matters sentence"],
      experiments: ["Review recent notes weekly", "Try tags for people, projects, and concepts", "Convert action-like notes into tasks"]
    };
  }

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

  async embed(text: string): Promise<number[]> {
    return deterministicEmbedding(text);
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

function inferTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags = new Set<string>();

  if (hasTerm(lower, "telegram") || hasTerm(lower, "bot")) tags.add("bot");
  if (hasTerm(lower, "task") || hasTerm(lower, "todo") || hasTerm(lower, "remind")) tags.add("tasks");
  if (hasTerm(lower, "relationship") || hasTerm(lower, "conflict")) tags.add("relationships");
  if (hasTerm(lower, "calendar")) tags.add("calendar");
  if (hasTerm(lower, "ai")) tags.add("ai");
  if (hasTerm(lower, "product manager") || hasTerm(lower, "product") || hasTerm(lower, "software design")) tags.add("product");
  if (hasTerm(lower, "client") || hasTerm(lower, "customer")) tags.add("clients");
  if (hasTerm(lower, "selling") || hasTerm(lower, "sales") || hasTerm(lower, "closed deals")) tags.add("sales");
  if (hasTerm(lower, "api") || hasTerm(lower, "documentation") || hasTerm(lower, "documentations")) tags.add("technical");
  if (hasTerm(lower, "career") || hasTerm(lower, "role") || hasTerm(lower, "working with")) tags.add("career");

  return [...tags].slice(0, 5);
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

function formatRoughNote(text: string): string {
  const cleaned = cleanNoteText(text);
  const parts = cleaned.split(/\s*->\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return cleaned;
  }

  return `${capitalize(parts[0] ?? "Note")}: ${parts.slice(1).map((part) => part.replace(/[.。]$/, "")).join("; ")}.`;
}

function extractNoteDetails(text: string): string[] {
  const formatted = formatRoughNote(text);
  const details = formatted
    .split(/(?:;|\n|\. )/)
    .map((item) => item.trim().replace(/[.:;]$/, ""))
    .filter((item) => item.length > 3);

  return details.length ? details : [formatted];
}

function inferMergedTitle(text: string, notes: NoteForMerge[]): string {
  const lower = text.toLowerCase();
  const hasProduct = hasTerm(lower, "product manager") || hasTerm(lower, "software design") || hasTerm(lower, "product");
  const hasClient = hasTerm(lower, "client") || hasTerm(lower, "closed deals") || hasTerm(lower, "needs");
  const hasSales = hasTerm(lower, "selling") || hasTerm(lower, "closed deals") || hasTerm(lower, "sales");
  const hasTechnical = hasTerm(lower, "api") || hasTerm(lower, "documentation") || hasTerm(lower, "documentations");

  if (hasProduct && hasClient && hasSales) {
    return hasTechnical ? "Client-Facing Product And Sales Lessons" : "Client-Facing Product Lessons";
  }

  if (hasProduct && hasTechnical) {
    return "Product Work And Technical Translation";
  }

  if (hasSales && hasClient) {
    return "Sales Calls And Client Discovery Lessons";
  }

  const titles = notes.map((note) => inferNoteTitle(note.sourceText || note.title)).filter(Boolean);
  return summarize(titles.join(" + "), 80) || "Merged Note";
}

function inferMergeTheme(text: string): string {
  const lower = text.toLowerCase();
  const hasProduct = hasTerm(lower, "product manager") || hasTerm(lower, "software design") || hasTerm(lower, "product");
  const hasClient = hasTerm(lower, "client") || hasTerm(lower, "closed deals") || hasTerm(lower, "needs");
  const hasSales = hasTerm(lower, "selling") || hasTerm(lower, "closed deals") || hasTerm(lower, "sales");
  const hasTechnical = hasTerm(lower, "api") || hasTerm(lower, "documentation") || hasTerm(lower, "documentations");

  if (hasProduct && hasClient && hasSales) {
    return [
      "These notes point toward a client-facing product path:",
      "learning from closed-deal calls, understanding client needs, shaping software around those needs, and communicating personal value well.",
      hasTechnical ? "The technical side is less about isolated coding and more about translating needs into documentation, API decisions, and implementation direction." : undefined
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (hasProduct && hasTechnical) {
    return "These notes connect product thinking with technical translation: understanding what people need, then turning that into documentation, system design, and implementation choices.";
  }

  if (hasSales && hasClient) {
    return "These notes connect sales learning with client understanding: observe how needs are surfaced, how value is communicated, and how closed deals are discussed.";
  }

  return "These notes were merged because they appear to describe related observations that should be easier to revisit together.";
}

function formatMergedBody(theme: string, details: string[], text: string, isRetry: boolean, attempt: number): string {
  const bullets = [...new Set(details.map(cleanDetail))]
    .filter((detail) => detail.length > 0)
    .slice(0, 7);
  const whyItMatters = inferWhyItMatters(text);

  return [
    theme,
    "",
    "Key points:",
    ...bullets.map((detail) => `- ${detail}`),
    "",
    "Why this matters:",
    whyItMatters,
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

function inferWhyItMatters(text: string): string {
  const lower = text.toLowerCase();
  if (hasTerm(lower, "product manager") || hasTerm(lower, "software design")) {
    return "This gives a clearer picture of the kind of work to learn from: a blend of product discovery, solution design, technical coordination, and self-presentation.";
  }

  if (hasTerm(lower, "selling") || hasTerm(lower, "closed deals")) {
    return "This is worth revisiting because it turns scattered advice into a practical learning focus: watch how value is communicated and how trust is built.";
  }

  return "This is worth keeping as one note because the separate observations are more useful when the relationship between them is visible.";
}

function inferConnections(text: string, notes: NoteForMerge[]): string[] {
  const lower = text.toLowerCase();
  const connections: string[] = [];

  if (hasTerm(lower, "closed deals") && (hasTerm(lower, "client") || hasTerm(lower, "clients"))) {
    connections.push("Joining closed-deal calls is a way to learn client discovery in practice, not just sales technique.");
  }

  if ((hasTerm(lower, "product manager") || hasTerm(lower, "software design")) && hasTerm(lower, "api")) {
    connections.push("The product-manager-like role bridges non-technical client conversations with technical artifacts such as documentation and API decisions.");
  }

  if (hasTerm(lower, "selling yourself") && (hasTerm(lower, "mentioned by both") || mentionedByMultiplePeople(text))) {
    connections.push("Selling yourself appears as a repeated signal from more than one person, so it is probably a career skill to practice deliberately.");
  }

  if (connections.length === 0 && notes.length > 1) {
    connections.push("The notes seem to belong together because they describe related lessons or observations that should be reviewed in one place.");
  }

  return connections;
}

function inferMissingContext(text: string, attempt: number): string[] {
  const missing: string[] = [];
  const lower = text.toLowerCase();

  if (hasTerm(lower, "matthias")) {
    missing.push("What specific behaviors or questions from Matthias's calls should be copied?");
  }

  if (hasTerm(lower, "ma brenda") || hasTerm(lower, "selling yourself")) {
    missing.push("What exactly did Matthias or Ma Brenda say about selling yourself?");
  }

  if (attempt > 1) {
    missing.push("Check whether the refined version overemphasizes one note compared with the others.");
  }

  return missing.slice(0, 4);
}

function mentionedByMultiplePeople(text: string): boolean {
  const names = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) ?? [];
  const uniqueNames = new Set(names.filter((name) => !["Product Manager", "Learn These", "Selling Yourself"].includes(name)));
  return uniqueNames.size >= 2;
}

function capitalize(text: string): string {
  if (!text) return text;
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}
