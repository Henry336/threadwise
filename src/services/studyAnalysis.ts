/**
 * Provider-neutral entry point for Study AI module review (Connections / Quiz / Both).
 * It only re-exports the job queue and prompt/parse helpers from geminiStudyAnalysis.ts
 * under neutral names. Used by the dashboard Study routes (to request and read reviews)
 * and by studyAnalysisRunner.ts (to claim and finish queued jobs).
 */
// The persisted Prisma table retains its historical Gemini-prefixed name to avoid
// rewriting completed analysis history. Active runtime callers use provider-neutral
// names and the server-side OpenAI adapter.
export {
  StudyAnalysisMode,
  buildGeminiStudyAnalysisPrompt as buildStudyAnalysisPrompt,
  claimGeminiStudyAnalysisJob as claimStudyAnalysisJob,
  completeGeminiStudyAnalysisJob as completeStudyAnalysisJob,
  failGeminiStudyAnalysisJob as failStudyAnalysisJob,
  getGeminiStudyAnalysis as getStudyAnalysis,
  parseGeminiStudyAnalysisOutput as parseStudyAnalysisOutput,
  requestGeminiStudyAnalysis as requestStudyAnalysis,
} from "./geminiStudyAnalysis";
export type {
  DashboardNoteEditSuggestion,
  DashboardStudyAnalysis,
  DashboardStudyAnalysisResponse,
  EvidenceSnapshot,
  GeminiStudyAnalysisWorkerJob as StudyAnalysisWorkerJob,
  StudyAnalysisEvidence,
  StudyAnalysisFinding,
  StudyAnalysisMisconception,
  StudyAnalysisPace,
  StudyAnalysisQuizItem,
} from "./geminiStudyAnalysis";
