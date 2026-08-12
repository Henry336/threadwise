CREATE TABLE "GeminiStudyAnalysisJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "requesterTelegramId" TEXT NOT NULL,
  "status" "CodexJobStatus" NOT NULL DEFAULT 'PENDING',
  "evidenceHash" TEXT NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "prompt" TEXT NOT NULL,
  "model" TEXT,
  "workerId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "result" JSONB,
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GeminiStudyAnalysisJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeminiStudyAnalysisJob_status_leaseExpiresAt_createdAt_idx"
ON "GeminiStudyAnalysisJob"("status", "leaseExpiresAt", "createdAt");

CREATE INDEX "GeminiStudyAnalysisJob_workspaceId_moduleId_createdAt_idx"
ON "GeminiStudyAnalysisJob"("workspaceId", "moduleId", "createdAt");

CREATE INDEX "GeminiStudyAnalysisJob_moduleId_evidenceHash_status_idx"
ON "GeminiStudyAnalysisJob"("moduleId", "evidenceHash", "status");

ALTER TABLE "GeminiStudyAnalysisJob"
ADD CONSTRAINT "GeminiStudyAnalysisJob_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeminiStudyAnalysisJob"
ADD CONSTRAINT "GeminiStudyAnalysisJob_moduleId_fkey"
FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
