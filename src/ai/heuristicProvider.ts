import { parseDueDate } from "../utils/dates";
import { deterministicEmbedding } from "../utils/vector";
import type {
  AiProvider,
  Classification,
  IdeaScore,
  NoteAnalysis,
  NoteForAnalysis,
  ReflectionAdvice,
  StructuredIdea,
  StructuredNote,
  StructuredTask
} from "./types";

const TASK_WORDS = ["todo", "task", "remind", "finish", "submit", "pay", "call", "email", "buy", "send"];
const REFLECTION_WORDS = ["relationship", "argued", "fight", "conflict", "partner", "girlfriend", "boyfriend", "friend", "hurt"];
const IDEA_WORDS = ["idea", "app", "bot", "tool", "build", "product", "startup", "website", "platform"];
const NOTE_WORDS = ["note", "remember", "learned", "insight", "quote", "summary", "keep", "save this", "important"];

export class HeuristicAiProvider implements AiProvider {
  async classifyMessage(text: string): Promise<Classification> {
    const lower = text.toLowerCase();
    const taskScore = scoreWords(lower, TASK_WORDS);
    const reflectionScore = scoreWords(lower, REFLECTION_WORDS);
    const ideaScore = scoreWords(lower, IDEA_WORDS);
    const noteScore = scoreWords(lower, NOTE_WORDS);

    if (taskScore > 0 && taskScore >= ideaScore && taskScore >= reflectionScore) {
      return {
        kind: "task",
        confidence: Math.min(0.85, 0.55 + taskScore * 0.1),
        reason: "Contains action-oriented task language.",
        suggestedTitle: summarize(text),
        dueDateText: parseDueDate(text, "Asia/Singapore") ? text : undefined
      };
    }

    if (reflectionScore > 0 && reflectionScore >= ideaScore) {
      return {
        kind: "reflection",
        confidence: Math.min(0.82, 0.55 + reflectionScore * 0.1),
        reason: "Looks like a relationship or conflict reflection.",
        suggestedTitle: summarize(text)
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
      reason: "No strong idea, task, or reflection signal found."
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
    return {
      title: titleCase(summarize(text, 70)),
      body: text.trim().replace(/\s+/g, " "),
      summary: summarize(text, 160),
      tags: inferTags(text)
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

  async adviseOnReflection(text: string): Promise<ReflectionAdvice> {
    return {
      situation: text,
      balancedView:
        "There may be valid feelings on more than one side. Slow the conversation down and separate facts, interpretations, and needs.",
      immediateAction:
        "Name your own feeling plainly, ask one clarifying question, and avoid trying to win the moment.",
      keepInMind:
        "Prioritize repair, boundaries, and long-term trust over being perfectly understood immediately.",
      risks: ["Mind reading", "Escalating while emotional", "Treating one incident as the whole relationship"]
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
  return words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
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

  if (lower.includes("telegram") || lower.includes("bot")) tags.add("bot");
  if (lower.includes("task") || lower.includes("todo") || lower.includes("remind")) tags.add("tasks");
  if (lower.includes("relationship") || lower.includes("conflict")) tags.add("relationships");
  if (lower.includes("calendar")) tags.add("calendar");
  if (lower.includes("ai")) tags.add("ai");

  return [...tags].slice(0, 5);
}
