/**
 * Thin OpenAI adapter for Study module review. Sends one JSON-mode chat request, tries
 * fallback models in order, and turns provider errors into safe, user-readable messages.
 * Called by studyAnalysisRunner.ts (the queue worker); geminiStudyAnalysis.ts only asks
 * whether it is configured. The API key stays on the backend and is never logged.
 */
import OpenAI from "openai";
import { env } from "../config/env";

const MAX_PROVIDER_RESPONSE_CHARS = 200_000;
type StudyOpenAiClient = Pick<OpenAI, "chat">;

export type OpenAiStudyApiResult = { text: string; model: string };
export type OpenAiStudyFailureMetadata = { status?: number; code?: string; type?: string };

/**
 * Error with a friendly message plus only the provider's status/code/type. It exists so
 * failures can be told apart (bad key, quota, rate limit, outage) and logged safely,
 * without keeping the raw provider error text.
 */
export class OpenAiStudyApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly providerType?: string;

  constructor(message: string, metadata: OpenAiStudyFailureMetadata) {
    super(message);
    this.name = "OpenAiStudyApiError";
    this.status = metadata.status;
    this.code = metadata.code;
    this.providerType = metadata.type;
  }
}

/** Extracts the safe-to-log metadata from an OpenAiStudyApiError (empty for any other error). */
export function openAiStudyFailureMetadata(error: unknown): OpenAiStudyFailureMetadata {
  return error instanceof OpenAiStudyApiError
    ? { status: error.status, code: error.code, type: error.providerType }
    : {};
}

export function openAiStudyApiConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

export function configuredOpenAiStudyModel(): string {
  return env.OPENAI_MODEL;
}

/** OPENAI_MODEL first, then the comma-separated OPENAI_MODEL_FALLBACKS, without duplicates. */
export function configuredOpenAiStudyModels(): string[] {
  return [...new Set([
    env.OPENAI_MODEL,
    ...env.OPENAI_MODEL_FALLBACKS.split(",").map((value) => value.trim()).filter(Boolean),
  ])];
}

/**
 * Calls OpenAI with the prepared Study prompt and returns the raw JSON text and model used.
 * Each model attempt has its own timeout. A missing model, rate limit or 5xx moves on to
 * the next model; quota/billing, auth and other errors stop at once. The response size is
 * capped. Callers validate the JSON afterwards; this function does not parse it.
 */
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
      if (isModelAvailabilityError(error) || isRetryableModelError(error)) {
        lastModelError = error;
        continue;
      }
      throw safeOpenAiError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastModelError) throw safeOpenAiError(lastModelError);
  throw new Error("No OpenAI Study model is configured.");
}

/**
 * Maps a provider error to a fixed message by HTTP status, separating quota/billing 429s
 * from plain rate limits. Added after a live 429 was hard to tell apart from a bad key.
 */
function safeOpenAiError(error: unknown): OpenAiStudyApiError {
  const metadata = providerErrorMetadata(error);
  const rawMessage = error instanceof Error ? error.message.toLowerCase() : "";
  const quotaFailure = metadata.code === "insufficient_quota"
    || metadata.type === "insufficient_quota"
    || metadata.code === "billing_hard_limit_reached"
    || /quota|billing limit|billing status/.test(rawMessage);
  let message = "The analysis service could not complete this review. Try again.";
  if (metadata.status === 401) message = "OpenAI rejected the configured API key. Replace it in the backend deployment and try again.";
  else if (metadata.status === 403) message = "The configured OpenAI project does not have permission to run Study analysis.";
  else if (metadata.status === 429 && quotaFailure) message = "OpenAI API quota or billing is unavailable. Check the configured project's usage and billing, then try again.";
  else if (metadata.status === 429) message = "OpenAI rate limit reached. Wait a moment, then try again.";
  else if (typeof metadata.status === "number" && metadata.status >= 500) message = "OpenAI is temporarily unavailable. Try again.";
  return new OpenAiStudyApiError(message, metadata);
}

/** Reads status/code/type defensively, since the SDK may put code/type on the error or a nested `error`. */
function providerErrorMetadata(error: unknown): OpenAiStudyFailureMetadata {
  const value = error as { status?: unknown; code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } };
  const code = typeof value.code === "string" ? value.code : typeof value.error?.code === "string" ? value.error.code : undefined;
  const type = typeof value.type === "string" ? value.type : typeof value.error?.type === "string" ? value.error.type : undefined;
  return {
    status: typeof value.status === "number" ? value.status : undefined,
    code: code?.toLowerCase(),
    type: type?.toLowerCase(),
  };
}

/** True when this model name is unknown or unsupported, so the next fallback model is worth trying. */
function isModelAvailabilityError(error: unknown): boolean {
  const value = providerErrorMetadata(error);
  const message = error instanceof Error ? error.message.toLowerCase() : String((error as { message?: unknown }).message ?? "").toLowerCase();
  if (value.status === 404 || value.code === "model_not_found" || value.type === "model_not_found") return true;
  return value.status === 400
    && message.includes("model")
    && (message.includes("not found") || message.includes("does not exist") || message.includes("unsupported"));
}

/** Rate limits and 5xx may pass on another model; quota/billing failures never will, so they are excluded. */
function isRetryableModelError(error: unknown): boolean {
  const value = providerErrorMetadata(error);
  if (value.status !== 429 && !(typeof value.status === "number" && value.status >= 500)) return false;
  return value.code !== "insufficient_quota"
    && value.type !== "insufficient_quota"
    && value.code !== "billing_hard_limit_reached";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
}
