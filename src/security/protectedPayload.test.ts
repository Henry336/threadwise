import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseProtectedPayload, serializeProtectedPayload } from "./protectedPayload";

const payloadSchema = z.object({ private: z.string() }).strict();

describe("protected payload envelope", () => {
  it("round-trips a versioned payload", () => {
    const serialized = serializeProtectedPayload({ private: "study evidence" });
    expect(parseProtectedPayload(serialized, null, payloadSchema)).toEqual({ private: "study evidence" });
  });

  it("supports legacy fallback and rejects malformed envelopes", () => {
    expect(parseProtectedPayload(null, { private: "legacy" }, payloadSchema)).toEqual({ private: "legacy" });
    expect(() => parseProtectedPayload('{"version":2,"payload":{}}', null, payloadSchema)).toThrow();
  });
});
