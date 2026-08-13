import OpenAI from "openai";
import { env } from "../config/env";

const MAX_PROVIDER_RESPONSE_CHARS = 200_000;
type StudyOpenAiClient = Pick<OpenAI, "chat">;

export type OpenAiStudyApiResult = { text: string; model: string };
export type OpenAiStudyFailureMetadata = { status?: number; code?: string; type?: string };

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
      throw safeOpenAiError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastModelError ? "No configured OpenAI Study model is currently available." : "No OpenAI Study model is configured.");
}

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

function isModelAvailabilityError(error: unknown): boolean {
  const value = providerErrorMetadata(error);
  const message = error instanceof Error ? error.message.toLowerCase() : String((error as { message?: unknown }).message ?? "").toLowerCase();
  if (value.status === 404 || value.code === "model_not_found" || value.type === "model_not_found") return true;
  return value.status === 400
    && message.includes("model")
    && (message.includes("not found") || message.includes("does not exist") || message.includes("unsupported"));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
}
