CREATE TYPE "StudyAnalysisMode" AS ENUM ('CONNECTIONS', 'QUIZ', 'BOTH');
CREATE TYPE "StudyNoteEditSuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED', 'SUPERSEDED');

ALTER TABLE "GeminiStudyAnalysisJob"
ADD COLUMN "mode" "StudyAnalysisMode" NOT NULL DEFAULT 'CONNECTIONS';

CREATE INDEX "GeminiStudyAnalysisJob_workspaceId_moduleId_mode_createdAt_idx"
ON "GeminiStudyAnalysisJob"("workspaceId", "moduleId", "mode", "createdAt");

CREATE TABLE "StudyNoteEditSuggestion" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "analysisJobId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "status" "StudyNoteEditSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "originalBodyHash" TEXT NOT NULL,
  "originalBody" TEXT NOT NULL,
  "suggestedBody" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "appliedBody" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StudyNoteEditSuggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyNoteEditSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyNoteEditSuggestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyNoteEditSuggestion_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "GeminiStudyAnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyNoteEditSuggestion_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StudyNoteEditSuggestion_analysisJobId_resourceId_key"
ON "StudyNoteEditSuggestion"("analysisJobId", "resourceId");
CREATE INDEX "StudyNoteEditSuggestion_workspaceId_status_createdAt_idx"
ON "StudyNoteEditSuggestion"("workspaceId", "status", "createdAt");
CREATE INDEX "StudyNoteEditSuggestion_resourceId_status_idx"
ON "StudyNoteEditSuggestion"("resourceId", "status");
