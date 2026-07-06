import { logger } from "../logger";
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

export class ResilientAiProvider implements AiProvider {
  constructor(private readonly primary: AiProvider, private readonly fallback: AiProvider) {}

  getStatus(): AiProviderStatus {
    return this.primary.getStatus();
  }

  async checkHealth(): Promise<AiProviderHealthCheck> {
    return this.primary.checkHealth();
  }

  async classifyMessage(text: string): Promise<Classification> {
    return this.withFallback("classifyMessage", () => this.primary.classifyMessage(text), () => this.fallback.classifyMessage(text));
  }

  async structureIdea(text: string): Promise<StructuredIdea> {
    return this.withFallback("structureIdea", () => this.primary.structureIdea(text), () => this.fallback.structureIdea(text));
  }

  async structureTask(text: string): Promise<StructuredTask> {
    return this.withFallback("structureTask", () => this.primary.structureTask(text), () => this.fallback.structureTask(text));
  }

  async structureNote(text: string): Promise<StructuredNote> {
    return this.withFallback("structureNote", () => this.primary.structureNote(text), () => this.fallback.structureNote(text));
  }

  async mergeNotes(notes: NoteForMerge[], previousPreview?: MergedNotePreview, attempt?: number): Promise<MergedNotePreview> {
    return this.withFallback(
      "mergeNotes",
      () => this.primary.mergeNotes(notes, previousPreview, attempt),
      () => this.fallback.mergeNotes(notes, previousPreview, attempt)
    );
  }

  async analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis> {
    return this.withFallback("analyzeNotes", () => this.primary.analyzeNotes(notes), () => this.fallback.analyzeNotes(notes));
  }

  async scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore> {
    return this.withFallback("scoreIdea", () => this.primary.scoreIdea(input), () => this.fallback.scoreIdea(input));
  }

  async summarizeEmails(emails: EmailForSummary[]): Promise<EmailDigestSummary> {
    return this.withFallback("summarizeEmails", () => this.primary.summarizeEmails(emails), () => this.fallback.summarizeEmails(emails));
  }

  async embed(text: string): Promise<number[]> {
    return this.withFallback("embed", () => this.primary.embed(text), () => this.fallback.embed(text));
  }

  private async withFallback<T>(operation: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      logger.error("AI provider failed; using heuristic fallback.", {
        operation,
        error: error instanceof Error ? error.message : String(error)
      });
      return fallback();
    }
  }
}
