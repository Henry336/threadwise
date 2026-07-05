import OpenAI from "openai";
import { env } from "../config/env";
import { safeJsonParse, clampScore } from "./json";
import type {
  AiProvider,
  Classification,
  IdeaScore,
  ReflectionAdvice,
  StructuredIdea,
  StructuredTask
} from "./types";

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async classifyMessage(text: string): Promise<Classification> {
    const content = await this.jsonCompletion(
      "Classify a Telegram message for a private productivity bot. Return JSON only.",
      `Message:\n${text}\n\nReturn: { "kind": "idea" | "task" | "reflection" | "noise", "confidence": 0-1, "reason": string, "suggestedTitle"?: string, "dueDateText"?: string }`
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

