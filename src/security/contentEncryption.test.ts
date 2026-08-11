import { describe, expect, it } from "vitest";
import {
  ContentCipher,
  contentMatchesQuery,
  decryptContentTree,
  isEncryptedContent,
  prepareContentWrite,
} from "./contentEncryption";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("content encryption", () => {
  it("leaves content untouched while rollout mode is off", () => {
    const cipher = new ContentCipher({ mode: "off", key: KEY });
    expect(cipher.encrypt("Note", "body", "hello")).toBe("hello");
    const args = prepareContentWrite("Note", "create", {
      data: { title: "A title", body: "A body", summary: "Summary", sourceText: "Source" },
    }, cipher) as { data: Record<string, unknown> };
    expect(args.data.body).toBe("A body");
    expect(args.data.searchTokens).toBeUndefined();
  });

  it("round-trips Unicode content with a fresh authenticated nonce", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const value = "မြန်မာစာ · personal note 🔐";
    const first = cipher.encrypt("Note", "body", value);
    const second = cipher.encrypt("Note", "body", value);

    expect(first).not.toBe(second);
    expect(isEncryptedContent(first)).toBe(true);
    expect(cipher.decrypt(first)).toBe(value);
    expect(cipher.decrypt(second)).toBe(value);
  });

  it("rejects tampering and a different master key", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const encrypted = cipher.encrypt("Task", "title", "private task");
    const replacement = encrypted.endsWith("A") ? "B" : "A";
    const tampered = `${encrypted.slice(0, -1)}${replacement}`;

    expect(() => cipher.decrypt(tampered)).toThrow();
    expect(() => new ContentCipher({ mode: "write", key: OTHER_KEY }).decrypt(encrypted)).toThrow();
  });

  it("does not mistake ordinary user text for ciphertext", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const value = "twenc:v1:this is just a note";
    expect(isEncryptedContent(value)).toBe(false);
    expect(cipher.decrypt(value)).toBe(value);
  });

  it("separates blind search tokens by field and supports substring queries", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const captionTokens = cipher.searchTokens("StoredImage", [{ field: "caption", value: "Lecture assessment guide" }]);
    const ocrTokens = cipher.searchTokens("StoredImage", [{ field: "ocrText", value: "Lecture assessment guide" }]);
    const queryTokens = cipher.queryTokens("StoredImage", "caption", "assessment");

    expect(captionTokens).not.toEqual(ocrTokens);
    expect(queryTokens.length).toBeGreaterThan(0);
    expect(queryTokens.every((token) => captionTokens.includes(token))).toBe(true);
    expect(queryTokens.some((token) => ocrTokens.includes(token))).toBe(false);
  });

  it("encrypts protected writes, adds blind indexes, and decrypts returned trees", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const args = prepareContentWrite("Note", "create", {
      data: { title: "A title", body: "A searchable body", summary: "Summary", sourceText: "Source" },
    }, cipher) as { data: Record<string, unknown> };

    expect(isEncryptedContent(args.data.body)).toBe(true);
    expect(args.data.searchTokens).toEqual(expect.any(Array));

    const result = decryptContentTree({ ...args.data, nested: [{ body: args.data.body }] }, cipher) as Record<string, unknown> & {
      body: string;
      nested: Array<{ body: string }>;
    };
    expect(result.body).toBe("A searchable body");
    expect(result.nested[0]?.body).toBe("A searchable body");
    expect(contentMatchesQuery("Note", result, "searchable")).toBe(true);
  });

  it("encrypts Prisma set operations without changing unrelated fields", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const args = prepareContentWrite("Task", "update", {
      data: { title: { set: "Updated title" }, status: { set: "OPEN" } },
    }, cipher) as { data: { title: { set: string }; status: { set: string }; searchTokens: { push: string[] } } };

    expect(isEncryptedContent(args.data.title.set)).toBe(true);
    expect(args.data.status.set).toBe("OPEN");
    expect(args.data.searchTokens.push.length).toBeGreaterThan(0);
  });
});
