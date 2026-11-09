/**
 * Helpers for reading structured replies from a language model safely.
 */

import type { z } from "zod";
import { logger } from "../logger";

/**
 * Parses a model's JSON reply and checks it against the expected shape. Model
 * output is untrusted input, so malformed JSON and a wrong shape both return
 * the caller's fallback instead of being cast and trusted.
 */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>, fallback: T): T {
  let value: unknown;
  try {
    const trimmed = text.trim();
    const jsonText = trimmed.startsWith("```")
      ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
      : trimmed;
    value = JSON.parse(jsonText);
  } catch {
    return fallback;
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Log only the paths, never the content: replies can contain user text.
    logger.warn("AI reply did not match the expected shape; using the fallback.", {
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || "(root)")
    });
    return fallback;
  }
  return parsed.data;
}

/**
 * Turns any model value into a whole score from 1 to 10. Non-numbers become 5, the middle,
 * so a sloppy reply cannot produce an out-of-range or missing score.
 */
export function clampScore(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.round(numberValue)));
}

