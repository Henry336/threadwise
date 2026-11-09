/**
 * Versioned JSON envelope for payloads that are stored in an encrypted column, such as Study
 * analysis evidence and results (used by src/services/geminiStudyAnalysis.ts).
 * The placeholders mark legacy plaintext columns whose content has moved into the protected
 * column; Study analysis and the privacy migration and retention scripts write them.
 */
import { z } from "zod";

export const PROTECTED_PAYLOAD_PLACEHOLDER = "[protected:v1]";
export const PROTECTED_JSON_PLACEHOLDER = { protected: true, version: 1 } as const;

const envelopeSchema = z.object({
  version: z.literal(1),
  payload: z.unknown(),
}).strict();

/** Wraps a value as `{ version: 1, payload }` so the format can change later without guessing. */
export function serializeProtectedPayload(value: unknown): string {
  return JSON.stringify({ version: 1, payload: value });
}

/**
 * Reads an envelope and validates the payload with the caller's schema. When the protected
 * column is empty (older rows), it validates the legacy fallback value instead. Throws on any
 * shape mismatch rather than returning partial data.
 */
export function parseProtectedPayload<T>(value: string | null | undefined, fallback: unknown, schema: z.ZodType<T>): T {
  if (value) {
    const envelope = envelopeSchema.parse(JSON.parse(value));
    return schema.parse(envelope.payload);
  }
  return schema.parse(fallback);
}
