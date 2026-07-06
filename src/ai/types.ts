export type CaptureKind = "idea" | "task" | "reflection" | "note" | "noise";

export type Classification = {
  kind: CaptureKind;
  confidence: number;
  reason: string;
  suggestedTitle?: string;
  dueDateText?: string;
};

export type StructuredIdea = {
  title: string;
  concept: string;
  problem?: string;
  targetUser?: string;
  type?: string;
  tags: string[];
};

export type StructuredTask = {
  title: string;
  description?: string;
  dueDateText?: string;
};

export type ReflectionAdvice = {
  situation: string;
  balancedView: string;
  immediateAction: string;
  keepInMind: string;
  risks: string[];
};

export type StructuredNote = {
  title: string;
  body: string;
  summary: string;
  tags: string[];
};

export type NoteForMerge = {
  publicId: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  sourceText: string;
  createdAt: string;
};

export type MergedNotePreview = {
  title: string;
  body: string;
  summary: string;
  tags: string[];
  connections: string[];
  preservedDetails: string[];
  possibleMissingContext: string[];
};

export type NoteForAnalysis = {
  title: string;
  body: string;
  summary: string;
  tags: string[];
  createdAt: string;
};

export type NoteAnalysis = {
  overview: string;
  whatWorks: string[];
  whatDoesNotWork: string[];
  suggestions: string[];
  experiments: string[];
};

export type IdeaScore = {
  buildability: number;
  usefulness: number;
  novelty: number;
  portfolioValue: number;
  monetization: number;
  difficulty: number;
  risk: number;
  summary: string;
  marketNotes: string;
  dos: string[];
  donts: string[];
};

export type EmailForSummary = {
  messageId: string;
  threadId?: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt?: string;
};

export type EmailSummaryItem = {
  messageId: string;
  subject: string;
  from: string;
  summary: string;
  important: boolean;
  importanceReason?: string;
  suggestedAction?: string;
};

export type EmailDigestSummary = {
  overview: string;
  items: EmailSummaryItem[];
};

export type AiProviderStatus = {
  provider: "openai" | "heuristic";
  apiKeyConfigured: boolean;
  chatModels: string[];
  activeChatModel?: string;
  embeddingModel?: string;
  lastSuccessfulChatAt?: string;
  lastRateLimit?: {
    model: string;
    at: string;
  };
  lastError?: {
    model?: string;
    at: string;
    message: string;
  };
};

export type AiProviderHealthCheck = {
  ok: boolean;
  checkedAt: string;
  provider: AiProviderStatus;
  model?: string;
  error?: string;
};

export interface AiProvider {
  getStatus(): AiProviderStatus;
  checkHealth(): Promise<AiProviderHealthCheck>;
  classifyMessage(text: string): Promise<Classification>;
  structureIdea(text: string): Promise<StructuredIdea>;
  structureTask(text: string): Promise<StructuredTask>;
  structureNote(text: string): Promise<StructuredNote>;
  mergeNotes(notes: NoteForMerge[], previousPreview?: MergedNotePreview, attempt?: number): Promise<MergedNotePreview>;
  analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis>;
  adviseOnReflection(text: string): Promise<ReflectionAdvice>;
  scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore>;
  summarizeEmails(emails: EmailForSummary[]): Promise<EmailDigestSummary>;
  embed(text: string): Promise<number[]>;
}
