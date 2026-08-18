import { z } from "zod";

export const PROTECTED_PAYLOAD_PLACEHOLDER = "[protected:v1]";
export const PROTECTED_JSON_PLACEHOLDER = { protected: true, version: 1 } as const;

const envelopeSchema = z.object({
  version: z.literal(1),
  payload: z.unknown(),
}).strict();

export function serializeProtectedPayload(value: unknown): string {
  return JSON.stringify({ version: 1, payload: value });
}

export function parseProtectedPayload<T>(value: string | null | undefined, fallback: unknown, schema: z.ZodType<T>): T {
  if (value) {
    const envelope = envelopeSchema.parse(JSON.parse(value));
    return schema.parse(envelope.payload);
  }
  return schema.parse(fallback);
}
