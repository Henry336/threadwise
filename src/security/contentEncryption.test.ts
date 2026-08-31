import { describe, expect, it } from "vitest";
import {
  ContentCipher,
  completeSearchableContentUpdate,
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

  it("replaces the complete blind index for full Prisma set updates", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const args = prepareContentWrite("Task", "update", {
      data: {
        title: { set: "Updated title" },
        description: { set: null },
        sourceText: { set: "Original capture" },
        status: { set: "OPEN" },
      },
    }, cipher) as { data: { title: { set: string }; status: { set: string }; searchTokens: { set: string[] } } };

    expect(isEncryptedContent(args.data.title.set)).toBe(true);
    expect(args.data.status.set).toBe("OPEN");
    expect(args.data.searchTokens.set.length).toBeGreaterThan(0);
  });

  it("rejects partial searchable updates instead of leaving stale or incomplete tokens", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    expect(() => prepareContentWrite("Task", "update", {
      data: { title: "Updated title" },
    }, cipher)).toThrow(/supply every protected searchable field/u);
  });

  it("completes partial content changes from the current decrypted record", () => {
    const completed = completeSearchableContentUpdate("Task", {
      title: "Old", description: "Details", sourceText: "Original capture",
    }, { title: "New", status: "OPEN" });
    expect(completed).toEqual({
      title: "New", description: "Details", sourceText: "Original capture", status: "OPEN",
    });
  });

  it("encrypts note revision snapshots without creating a searchable plaintext index", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const args = prepareContentWrite("StudyResourceRevision", "create", {
      data: { title: "Private revision", body: "A previous Markdown body", source: "DASHBOARD" },
    }, cipher) as { data: Record<string, unknown> };

    expect(isEncryptedContent(args.data.title)).toBe(true);
    expect(isEncryptedContent(args.data.body)).toBe(true);
    expect(args.data.source).toBe("DASHBOARD");
    expect(args.data.searchTokens).toBeUndefined();
  });

  it("encrypts cross-device Personal writing drafts without indexing unfinished text", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const args = prepareContentWrite("PersonalNoteDraft", "create", {
      data: { title: "Unfiled personal note", body: "Private unfinished Markdown", revision: 1 },
    }, cipher) as { data: Record<string, unknown> };

    expect(isEncryptedContent(args.data.title)).toBe(true);
    expect(isEncryptedContent(args.data.body)).toBe(true);
    expect(args.data.revision).toBe(1);
    expect(args.data.searchTokens).toBeUndefined();
  });

  it("encrypts cross-device Study writing drafts without indexing unfinished text", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const args = prepareContentWrite("StudyNoteDraft", "create", {
      data: { title: "Unfiled lecture note", body: "Private unfinished Markdown", revision: 1 },
    }, cipher) as { data: Record<string, unknown> };

    expect(isEncryptedContent(args.data.title)).toBe(true);
    expect(isEncryptedContent(args.data.body)).toBe(true);
    expect(args.data.revision).toBe(1);
    expect(args.data.searchTokens).toBeUndefined();
  });

  it("encrypts AI payloads and suggestions without creating blind indexes", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const job = prepareContentWrite("GeminiStudyAnalysisJob", "create", {
      data: { evidenceCiphertext: "{\"version\":1}", promptCiphertext: "private prompt", resultCiphertext: null },
    }, cipher) as { data: Record<string, unknown> };
    const suggestion = prepareContentWrite("StudyNoteEditSuggestion", "create", {
      data: { originalBody: "before", suggestedBody: "after", rationale: "course evidence", appliedBody: null },
    }, cipher) as { data: Record<string, unknown> };

    expect(isEncryptedContent(job.data.evidenceCiphertext)).toBe(true);
    expect(isEncryptedContent(job.data.promptCiphertext)).toBe(true);
    expect(isEncryptedContent(suggestion.data.originalBody)).toBe(true);
    expect(isEncryptedContent(suggestion.data.suggestedBody)).toBe(true);
    expect(job.data.searchTokens).toBeUndefined();
    expect(suggestion.data.searchTokens).toBeUndefined();
  });

  it("encrypts bounded Study excerpts without adding them to search tokens", () => {
    const cipher = new ContentCipher({ mode: "write", key: KEY });
    const resource = prepareContentWrite("StudyResource", "create", {
      data: {
        title: "Note", body: "Full body", analysisExcerpt: "Bounded private excerpt",
        captionPreview: "Bounded caption", ocrPreview: "Bounded OCR",
      },
    }, cipher) as { data: Record<string, unknown> };
    const material = prepareContentWrite("StudyCanvasMaterial", "create", {
      data: { extractedText: "Full Canvas text", analysisExcerpt: "Bounded Canvas excerpt" },
    }, cipher) as { data: Record<string, unknown> };

    expect(isEncryptedContent(resource.data.analysisExcerpt)).toBe(true);
    expect(isEncryptedContent(resource.data.captionPreview)).toBe(true);
    expect(isEncryptedContent(resource.data.ocrPreview)).toBe(true);
    expect(isEncryptedContent(material.data.analysisExcerpt)).toBe(true);
    expect(resource.data.searchTokens).toEqual(expect.arrayContaining(cipher.searchTokens("StudyResource", [
      { field: "title", value: "Note" },
      { field: "body", value: "Full body" },
    ])));
    expect(JSON.stringify(resource.data.searchTokens)).not.toContain("Bounded private excerpt");
    expect(JSON.stringify(resource.data.searchTokens)).not.toContain("Bounded OCR");
  });
});
