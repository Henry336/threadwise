import { describe, expect, it } from "vitest";
import { cosineSimilarity, deterministicEmbedding } from "./vector";

describe("vector utilities", () => {
  it("creates stable embeddings for identical text", () => {
    const first = deterministicEmbedding("telegram reminder bot");
    const second = deterministicEmbedding("telegram reminder bot");
    expect(cosineSimilarity(first, second)).toBeCloseTo(1);
  });

  it("returns zero for incompatible vectors", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

