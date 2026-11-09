/**
 * Local, deterministic text vectors for search (services/search.ts). Search compares the
 * query vector with each item's vector, so it works without calling OpenAI and costs no API quota.
 */

import { splitWords } from "./text";

/**
 * Cosine similarity of two equal-length vectors, between -1 and 1. Returns 0 for empty,
 * mismatched or all-zero vectors instead of NaN.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Turns text into a normalized bag-of-words vector by hashing each word into one of
 * `dimensions` buckets. The same text always gives the same vector, so no stored embeddings are needed.
 */
export function deterministicEmbedding(text: string, dimensions = 128): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of splitWords(text)) {
    const index = stableHash(word) % dimensions;
    vector[index] = (vector[index] ?? 0) + 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

/**
 * FNV-1a string hash, used to place a word in a vector bucket.
 */
function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash);
}
