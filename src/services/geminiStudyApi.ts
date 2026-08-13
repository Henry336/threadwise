import { z } from "zod";
import { env } from "../config/env";

const MAX_PROVIDER_RESPONSE_CHARS = 200_000;
const GEMINI_API_ORIGIN = "https://generativelanguage.googleapis.com";

const responseEnvelopeSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() }).passthrough()).max(20),
    }).passthrough().optional(),
    finishReason: z.string().optional(),
  }).passthrough()).min(1).max(4),
}).passthrough();

const findingJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    detail: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
  },
  required: ["title", "detail", "evidenceIds"],
} as const;

const studyAnalysisJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    patterns: { type: "array", items: findingJsonSchema, maxItems: 6 },
    strengths: { type: "array", items: findingJsonSchema, maxItems: 6 },
    gaps: { type: "array", items: findingJsonSchema, maxItems: 6 },
    nextSteps: { type: "array", items: findingJsonSchema, maxItems: 6 },
    uncertainty: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["summary", "patterns", "strengths", "gaps", "nextSteps", "uncertainty"],
} as const;

export type GeminiStudyApiResult = { text: string; model: string };

export function geminiStudyApiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

export function configuredGeminiStudyModel(): string {
  return env.GEMINI_STUDY_MODEL;
}

export function configuredGeminiStudyModels(): string[] {
  return [...new Set([
    env.GEMINI_STUDY_MODEL,
    ...env.GEMINI_STUDY_FALLBACK_MODELS.split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9._-]+$/.test(value)),
  ])];
}

export async function generateGeminiStudyAnalysis(
  prompt: string,
  options: { apiKey?: string; fetch?: typeof fetch; models?: string[]; timeoutMs?: number; maxOutputTokens?: number } = {},
): Promise<GeminiStudyApiResult> {
  const apiKey = options.apiKey ?? env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Study analysis is not configured.");
  const request = options.fetch ?? fetch;
  const models = options.models?.length ? options.models : configuredGeminiStudyModels();
  let lastModelError = false;

  for (const model of models) {
    if (!/^[A-Za-z0-9._-]+$/.test(model)) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? env.GEMINI_STUDY_TIMEOUT_MS);
    try {
      const response = await request(`${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: options.maxOutputTokens ?? env.GEMINI_STUDY_MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            responseSchema: studyAnalysisJsonSchema,
          },
        }),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("The analysis service returned too much data.");
      const raw = await response.text();
      if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("The analysis service returned too much data.");
      if (!response.ok) {
        lastModelError = response.status === 404
          || (response.status === 400 && /model.{0,80}(not found|not supported|not available)/i.test(raw));
        if (lastModelError) continue;
        throw new Error(safeGeminiHttpError(response.status));
      }
      const envelope = responseEnvelopeSchema.parse(JSON.parse(raw));
      const text = envelope.candidates
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("The analysis service returned no usable result.");
      return { text, model };
    } catch (error) {
      if (isAbortError(error)) throw new Error("The analysis service timed out. Try again.");
      if (lastModelError) continue;
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new Error("The analysis service returned an invalid response. Try again.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("No configured Gemini Study model is currently available.");
}

function safeGeminiHttpError(status: number): string {
  if (status === 401 || status === 403) return "Study analysis is not authorized with the configured provider.";
  if (status === 429) return "The analysis service is busy. Try again shortly.";
  if (status >= 500) return "The analysis service is temporarily unavailable. Try again.";
  return "The analysis service could not complete this review. Try again.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
}
