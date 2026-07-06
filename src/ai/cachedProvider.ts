import crypto from "crypto";
import type {
  AiProvider,
  AiProviderHealthCheck,
  AiProviderStatus,
  Classification,
  EmailDigestSummary,
  EmailForSummary,
  IdeaScore,
  MergedNotePreview,
  NoteAnalysis,
  NoteForAnalysis,
  NoteForMerge,
  StructuredIdea,
  StructuredNote,
  StructuredTask
} from "./types";

const DEFAULT_MAX_ENTRIES = 250;

export class CachedAiProvider implements AiProvider {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly inner: AiProvider, private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  getStatus(): AiProviderStatus {
    return this.inner.getStatus();
  }

  checkHealth(): Promise<AiProviderHealthCheck> {
    return this.inner.checkHealth();
  }

  classifyMessage(text: string): Promise<Classification> {
    return this.cached("classifyMessage", text, () => this.inner.classifyMessage(text));
  }

  structureIdea(text: string): Promise<StructuredIdea> {
    return this.cached("structureIdea", text, () => this.inner.structureIdea(text));
  }

  structureTask(text: string): Promise<StructuredTask> {
    return this.inner.structureTask(text);
  }

  structureNote(text: string): Promise<StructuredNote> {
    return this.cached("structureNote", text, () => this.inner.structureNote(text));
  }

  mergeNotes(notes: NoteForMerge[], previousPreview?: MergedNotePreview, attempt?: number): Promise<MergedNotePreview> {
    return this.cached("mergeNotes", { notes, previousPreview, attempt }, () => this.inner.mergeNotes(notes, previousPreview, attempt));
  }

  analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis> {
    return this.cached("analyzeNotes", notes, () => this.inner.analyzeNotes(notes));
  }

  scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore> {
    return this.cached("scoreIdea", input, () => this.inner.scoreIdea(input));
  }

  summarizeEmails(emails: EmailForSummary[]): Promise<EmailDigestSummary> {
    return this.cached("summarizeEmails", emails, () => this.inner.summarizeEmails(emails));
  }

  embed(text: string): Promise<number[]> {
    return this.inner.embed(text);
  }

  private cached<T>(operation: string, input: unknown, run: () => Promise<T>): Promise<T> {
    const key = cacheKey(operation, input);
    const existing = this.cache.get(key);
    if (existing) {
      this.cache.delete(key);
      this.cache.set(key, existing);
      return existing as Promise<T>;
    }

    const promise = run().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, promise);
    this.trimCache();
    return promise;
  }

  private trimCache(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) return;
      this.cache.delete(oldest);
    }
  }
}

function cacheKey(operation: string, input: unknown): string {
  const hash = crypto.createHash("sha256").update(stableStringify(input)).digest("hex");
  return `${operation}:${hash}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
