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

export interface AiProvider {
  classifyMessage(text: string): Promise<Classification>;
  structureIdea(text: string): Promise<StructuredIdea>;
  structureTask(text: string): Promise<StructuredTask>;
  structureNote(text: string): Promise<StructuredNote>;
  analyzeNotes(notes: NoteForAnalysis[]): Promise<NoteAnalysis>;
  adviseOnReflection(text: string): Promise<ReflectionAdvice>;
  scoreIdea(input: StructuredIdea & { sourceText: string }): Promise<IdeaScore>;
  embed(text: string): Promise<number[]>;
}
