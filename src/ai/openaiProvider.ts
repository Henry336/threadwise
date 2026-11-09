import OpenAI from "openai";
import { env } from "../config/env";
import { z } from "zod";
import { parseModelJson, clampScore } from "./json";
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

type OpenAiClient = Pick<OpenAI, "chat">;

// Optional model fields: models often send null for "absent", which callers treat as undefined.
const optionalText = z.string().nullish().transform((value) => value ?? undefined);
const textList = z.array(z.string()).default([]);

const classificationSchema = z.object({
  kind: z.enum(["idea", "task", "note", "noise"]),
  confidence: z.number(),
  reason: z.string(),
  suggestedTitle: optionalText,
  dueDateText: optionalText
});
const ideaSchema = z.object({
  title: z.string(),
  concept: z.string(),
  problem: optionalText,
  targetUser: optionalText,
  type: optionalText
});
const taskSchema = z.object({ title: z.string(), description: optionalText, dueDateText: optionalText });
const noteSchema = z.object({ title: z.string(), body: z.string(), summary: z.string() });
const mergedNoteSchema = z.object({
  title: z.string(),
  body: z.string(),
  summary: z.string(),
  connections: textList,
  preservedDetails: textList,
  possibleMissingContext: textList
});
const noteAnalysisSchema = z.object({
  overview: z.string(),
  whatWorks: textList,
  whatDoesNotWork: textList,
  suggestions: textList,
  experiments: textList
});
// Scores stay unknown here because clampScore already turns any value into 1-10.
const ideaScoreSchema = z.object({
  buildability: z.unknown(),
  usefulness: z.unknown(),
  novelty: z.unknown(),
  portfolioValue: z.unknown(),
  monetization: z.unknown(),
  difficulty: z.unknown(),
  risk: z.unknown(),
  summary: optionalText,
  marketNotes: optionalText,
  dos: textList,
  donts: textList
});

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAiClient;
  private readonly model = env.OPENAI_MODEL;
  private lastSuccessfulChatAt?: string;
  private lastError?: { model?: string; at: string; message: string };

  constructor(apiKey: string, client: OpenAiClient = new OpenAI({ apiKey })) {
    this.client = client;
  }

  getStatus(): AiProviderStatus {
    return {
      provider: "openai",
      apiKeyConfigured: true,
      chatModels: [this.model],
      activeChatModel: this.model,
      lastSuccessfulChatAt: this.lastSuccessfulChatAt,
      lastError: this.lastError
    };
  }

  async checkHealth(): Promise<AiProviderHealthCheck> {
    const checkedAt = new Date().toISOString();
    try {
      const model = await this.jsonCompletion(
        "Return JSON only.",
        'Return exactly: { "ok": true }'
      );
      return {
        ok: Boolean(model),
        checkedAt,
        provider: this.getStatus(),
        model: this.model
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt,
        provider: this.getStatus(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async classifyMessage(text: string): Promise<Classification> {
    const content = await this.jsonCompletion(
      "Classify a Telegram message for a private productivity and notekeeping bot. Return JSON only.",
      `Message:\n${text}\n\nReturn: { "kind": "idea" | "task" | "note" | "noise", "confidence": 0-1, "reason": string, "suggestedTitle"?: string, "dueDateText"?: string }`
    );

    return parseModelJson<Classification>(content, classificationSchema, {
      kind: "noise",
      confidence: 0.5,
      reason: "Could not confidently classify message."
    });
  }

  async structureIdea(text: string): Promise<StructuredIdea> {
    const content = await this.jsonCompletion(
      "Structure rough software, product, or workflow ideas into concise portfolio-ready records. Return JSON only.",
      `Idea text:\n${text}\n\nReturn: { "title": string, "concept": string, "problem"?: string, "targetUser"?: string, "type"?: string }`
    );

    const structured = parseModelJson<Omit<StructuredIdea, "tags">>(content, ideaSchema, {
      title: "Untitled Idea",
      concept: text,
    });
    return { ...structured, tags: [] };
  }

  async structureTask(text: string): Promise<StructuredTask> {
    const content = await this.jsonCompletion(
      "Extract a task from a rough Telegram message. Return JSON only.",
      `Task text:\n${text}\n\nReturn: { "title": string, "description"?: string, "dueDateText"?: string }`
    );

    return parseModelJson<StructuredTask>(content, taskSchema, {
      title: text,
      description: text
    });
  }

  async structureNote(text: string): Promise<StructuredNote> {
    const content = await this.jsonCompletion(
      "Clean a rough personal note into a readable, recallable note without losing important details. Preserve specifics, names, numbers, dates, caveats, and source wording when useful. Return JSON only.",
      `Raw note:\n${text}\n\nReturn: { "title": string, "body": string, "summary": string }\n\nGuidelines:\n- title should be short and searchable\n- body should be clear, complete, and human-readable\n- summary should be one sentence`
    );

    const structured = parseModelJson<Omit<StructuredNote, "tags">>(content, noteSchema, {
      title: "Untitled Note",
      body: text,
      summary: text.slice(0, 180),
    });
    return { ...structured, tags: [] };
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
        "Return: { \"title\": string, \"body\": string, \"summary\": string, \"connections\": string[], \"preservedDetails\": string[], \"possibleMissingContext\": string[] }",
        "",
        "Guidelines:",
        "- Make the merged note easier to reread later than the originals.",
        "- Strongly connect related ideas across notes, but label uncertainty instead of pretending.",
        "- Preserve important details even if they are messy.",
        "- If this is a retry, improve the connections and check whether the previous preview left out important details.",
        "- Keep the title specific enough to retrieve later."
      ].join("\n")
    );

    const preview = parseModelJson<Omit<MergedNotePreview, "tags">>(content, mergedNoteSchema, fallbackMergedNotePreview(notes));
    return { ...preview, tags: [] };
  }

  async analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis> {
    const content = await this.jsonCompletion(
      "Analyze a user's notekeeping style from their saved notes. Be direct, practical, and specific. Return JSON only.",
      `Notes:\n${JSON.stringify(notes, null, 2)}\n\nReturn: { "overview": string, "whatWorks": string[], "whatDoesNotWork": string[], "suggestions": string[], "experiments": string[] }\n\nFocus on retrieval quality, clarity, consistency, missing context, note granularity, and ways to make future notes more useful.`
    );

    return parseModelJson<NoteAnalysis>(content, noteAnalysisSchema, {
      overview: "Not enough note data to analyze deeply yet.",
      whatWorks: [],
      whatDoesNotWork: [],
      suggestions: ["Save more notes, then run this again."],
      experiments: []
    });
  }

  async scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore> {
    const content = await this.jsonCompletion(
      "Score a product idea for a solo builder portfolio. Use heuristic market knowledge only; do not claim live research. Return JSON only.",
      `Idea:\n${JSON.stringify(input, null, 2)}\n\nReturn: { "buildability": 1-10, "usefulness": 1-10, "novelty": 1-10, "portfolioValue": 1-10, "monetization": 1-10, "difficulty": 1-10, "risk": 1-10, "summary": string, "marketNotes": string, "dos": string[], "donts": string[] }`
    );

    const parsed = parseModelJson(content, ideaScoreSchema, {
      buildability: undefined,
      usefulness: undefined,
      novelty: undefined,
      portfolioValue: undefined,
      monetization: undefined,
      difficulty: undefined,
      risk: undefined,
      summary: undefined,
      marketNotes: undefined,
      dos: [],
      donts: []
    });
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
      dos: parsed.dos,
      donts: parsed.donts
    };
  }

  /**
   * Sends one JSON-mode request to the configured model. A failure is recorded
   * for /status and rethrown, so ResilientAiProvider answers with the heuristic
   * provider instead; retrying other models cannot fix a quota error on the key.
   */
  private async jsonCompletion(system: string, user: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      this.lastSuccessfulChatAt = new Date().toISOString();
      this.lastError = undefined;
      return response.choices[0]?.message.content ?? "{}";
    } catch (error) {
      this.lastError = { model: this.model, at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }
}

function fallbackMergedNotePreview(notes: NoteForMerge[]): MergedNotePreview {
  const title = notes.length === 1 ? notes[0]?.title ?? "Merged Note" : `Merged Notes: ${notes.map((note) => note.publicId).join(", ")}`;
  const body = notes.map((note) => `${note.title}\n${note.body}`).join("\n\n");
  return {
    title,
    body,
    summary: notes.map((note) => note.summary).join(" "),
    tags: [],
    connections: ["These notes were grouped together by the user for later consolidation."],
    preservedDetails: notes.map((note) => `${note.publicId}: ${note.summary}`),
    possibleMissingContext: []
  };
}
