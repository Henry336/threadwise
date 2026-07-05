import OpenAI from "openai";
import { env } from "../config/env";
import { safeJsonParse, clampScore } from "./json";
import type {
  AiProvider,
  Classification,
  IdeaScore,
  MergedNotePreview,
  NoteAnalysis,
  NoteForAnalysis,
  NoteForMerge,
  ReflectionAdvice,
  StructuredIdea,
  StructuredNote,
  StructuredTask
} from "./types";

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async classifyMessage(text: string): Promise<Classification> {
    const content = await this.jsonCompletion(
      "Classify a Telegram message for a private productivity and notekeeping bot. Return JSON only.",
      `Message:\n${text}\n\nReturn: { "kind": "idea" | "task" | "reflection" | "note" | "noise", "confidence": 0-1, "reason": string, "suggestedTitle"?: string, "dueDateText"?: string }`
    );

    return safeJsonParse<Classification>(content, {
      kind: "noise",
      confidence: 0.5,
      reason: "Could not confidently classify message."
    });
  }

  async structureIdea(text: string): Promise<StructuredIdea> {
    const content = await this.jsonCompletion(
      "Structure rough software, product, or workflow ideas into concise portfolio-ready records. Return JSON only.",
      `Idea text:\n${text}\n\nReturn: { "title": string, "concept": string, "problem"?: string, "targetUser"?: string, "type"?: string, "tags": string[] }`
    );

    return safeJsonParse<StructuredIdea>(content, {
      title: "Untitled Idea",
      concept: text,
      tags: []
    });
  }

  async structureTask(text: string): Promise<StructuredTask> {
    const content = await this.jsonCompletion(
      "Extract a task from a rough Telegram message. Return JSON only.",
      `Task text:\n${text}\n\nReturn: { "title": string, "description"?: string, "dueDateText"?: string }`
    );

    return safeJsonParse<StructuredTask>(content, {
      title: text,
      description: text
    });
  }

  async structureNote(text: string): Promise<StructuredNote> {
    const content = await this.jsonCompletion(
      "Clean a rough personal note into a readable, recallable note without losing important details. Preserve specifics, names, numbers, dates, caveats, and source wording when useful. Return JSON only.",
      `Raw note:\n${text}\n\nReturn: { "title": string, "body": string, "summary": string, "tags": string[] }\n\nGuidelines:\n- title should be short and searchable\n- body should be clear, complete, and human-readable\n- summary should be one sentence\n- tags should be sparse and useful`
    );

    return safeJsonParse<StructuredNote>(content, {
      title: "Untitled Note",
      body: text,
      summary: text.slice(0, 180),
      tags: []
    });
  }

  async mergeNotes(notes: NoteForMerge[], previousPreview?: MergedNotePreview, attempt = 1): Promise<MergedNotePreview> {
    const content = await this.jsonCompletion(
      "Merge rough personal notes into one clearer, more useful note. Return JSON only. Preserve facts, names, dates, caveats, and useful wording. Do not invent details.",
      [
        `Attempt: ${attempt}`,
        "",
        "Source notes:",
        JSON.stringify(notes, null, 2),
        previousPreview ? ["", "Previous preview to improve:", JSON.stringify(previousPreview, null, 2)].join("\n") : "",
        "",
        "Return: { \"title\": string, \"body\": string, \"summary\": string, \"tags\": string[], \"connections\": string[], \"preservedDetails\": string[], \"possibleMissingContext\": string[] }",
        "",
        "Guidelines:",
        "- Make the merged note easier to reread later than the originals.",
        "- Strongly connect related ideas across notes, but label uncertainty instead of pretending.",
        "- Preserve important details even if they are messy.",
        "- If this is a retry, improve the connections and check whether the previous preview left out important details.",
        "- Keep tags sparse and useful."
      ].join("\n")
    );

    return safeJsonParse<MergedNotePreview>(content, fallbackMergedNotePreview(notes));
  }

  async analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis> {
    const content = await this.jsonCompletion(
      "Analyze a user's notekeeping style from their saved notes. Be direct, practical, and specific. Return JSON only.",
      `Notes:\n${JSON.stringify(notes, null, 2)}\n\nReturn: { "overview": string, "whatWorks": string[], "whatDoesNotWork": string[], "suggestions": string[], "experiments": string[] }\n\nFocus on retrieval quality, clarity, consistency, missing context, tagging habits, note granularity, and ways to make future notes more useful.`
    );

    return safeJsonParse<NoteAnalysis>(content, {
      overview: "Not enough note data to analyze deeply yet.",
      whatWorks: [],
      whatDoesNotWork: [],
      suggestions: ["Save more notes, then run this again."],
      experiments: []
    });
  }

  async adviseOnReflection(text: string): Promise<ReflectionAdvice> {
    const content = await this.jsonCompletion(
      "Give balanced, non-clinical relationship reflection guidance. Avoid therapy, diagnosis, legal advice, or unsafe certainty. Return JSON only.",
      `Situation:\n${text}\n\nReturn: { "situation": string, "balancedView": string, "immediateAction": string, "keepInMind": string, "risks": string[] }`
    );

    return safeJsonParse<ReflectionAdvice>(content, {
      situation: text,
      balancedView: "There may be more than one valid perspective.",
      immediateAction: "Pause, clarify, and choose a repair-oriented next step.",
      keepInMind: "Prioritize long-term trust and safety.",
      risks: []
    });
  }

  async scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore> {
    const content = await this.jsonCompletion(
      "Score a product idea for a solo builder portfolio. Use heuristic market knowledge only; do not claim live research. Return JSON only.",
      `Idea:\n${JSON.stringify(input, null, 2)}\n\nReturn: { "buildability": 1-10, "usefulness": 1-10, "novelty": 1-10, "portfolioValue": 1-10, "monetization": 1-10, "difficulty": 1-10, "risk": 1-10, "summary": string, "marketNotes": string, "dos": string[], "donts": string[] }`
    );

    const parsed = safeJsonParse<Partial<IdeaScore>>(content, {});
    return {
      buildability: clampScore(parsed.buildability),
      usefulness: clampScore(parsed.usefulness),
      novelty: clampScore(parsed.novelty),
      portfolioValue: clampScore(parsed.portfolioValue),
      monetization: clampScore(parsed.monetization),
      difficulty: clampScore(parsed.difficulty),
      risk: clampScore(parsed.risk),
      summary: parsed.summary ?? "Idea scored.",
      marketNotes: parsed.marketNotes ?? "No market notes returned.",
      dos: parsed.dos ?? [],
      donts: parsed.donts ?? []
    };
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: text
    });

    return response.data[0]?.embedding ?? [];
  }

  private async jsonCompletion(system: string, user: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    return response.choices[0]?.message.content ?? "{}";
  }
}

function fallbackMergedNotePreview(notes: NoteForMerge[]): MergedNotePreview {
  const title = notes.length === 1 ? notes[0]?.title ?? "Merged Note" : `Merged Notes: ${notes.map((note) => note.publicId).join(", ")}`;
  const body = notes.map((note) => `${note.title}\n${note.body}`).join("\n\n");
  const tags = [...new Set(notes.flatMap((note) => note.tags))].slice(0, 6);
  return {
    title,
    body,
    summary: notes.map((note) => note.summary).join(" "),
    tags,
    connections: ["These notes were grouped together by the user for later consolidation."],
    preservedDetails: notes.map((note) => `${note.publicId}: ${note.summary}`),
    possibleMissingContext: []
  };
}
