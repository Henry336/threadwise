import OpenAI from "openai";
import { env } from "../config/env";

const MAX_PROVIDER_RESPONSE_CHARS = 200_000;
type StudyOpenAiClient = Pick<OpenAI, "chat">;

export type OpenAiStudyApiResult = { text: string; model: string };

export function openAiStudyApiConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

export function configuredOpenAiStudyModel(): string {
  return env.OPENAI_MODEL;
}

export function configuredOpenAiStudyModels(): string[] {
  return [...new Set([
    env.OPENAI_MODEL,
    ...env.OPENAI_MODEL_FALLBACKS.split(",").map((value) => value.trim()).filter(Boolean),
  ])];
}

export async function generateOpenAiStudyAnalysis(
  prompt: string,
  options: {
    apiKey?: string;
    client?: StudyOpenAiClient;
    models?: string[];
    timeoutMs?: number;
    maxOutputTokens?: number;
  } = {},
): Promise<OpenAiStudyApiResult> {
  const apiKey = options.apiKey ?? env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Study analysis is not configured.");
  const client = options.client ?? new OpenAI({ apiKey });
  const models = options.models?.length ? options.models : configuredOpenAiStudyModels();
  let lastModelError: unknown;

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? env.STUDY_ANALYSIS_TIMEOUT_MS);
    try {
      const response = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        max_completion_tokens: options.maxOutputTokens ?? env.STUDY_ANALYSIS_MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: "system",
            content: "You are Threadwise's private Study analysis adapter. Follow the evidence and JSON constraints in the user prompt exactly. Return JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }, { signal: controller.signal });
      const text = response.choices[0]?.message.content?.trim() ?? "";
      if (!text) throw new Error("The analysis service returned no usable result.");
      if (text.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("The analysis service returned too much data.");
      return { text, model };
    } catch (error) {
      if (isAbortError(error)) throw new Error("The analysis service timed out. Try again.");
      if (isModelAvailabilityError(error)) {
        lastModelError = error;
        continue;
      }
      throw new Error(safeOpenAiError(error));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastModelError ? "No configured OpenAI Study model is currently available." : "No OpenAI Study model is configured.");
}

function safeOpenAiError(error: unknown): string {
  const status = (error as { status?: unknown }).status;
  if (status === 401 || status === 403) return "Study analysis is not authorized with the configured provider.";
  if (status === 429) return "The analysis service is busy. Try again shortly.";
  if (typeof status === "number" && status >= 500) return "The analysis service is temporarily unavailable. Try again.";
  return "The analysis service could not complete this review. Try again.";
}

function isModelAvailabilityError(error: unknown): boolean {
  const value = error as { status?: unknown; code?: unknown; type?: unknown; message?: unknown };
  const message = error instanceof Error ? error.message.toLowerCase() : String(value.message ?? "").toLowerCase();
  if (value.status === 404 || value.code === "model_not_found" || value.type === "model_not_found") return true;
  return value.status === 400
    && message.includes("model")
    && (message.includes("not found") || message.includes("does not exist") || message.includes("unsupported"));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
}
