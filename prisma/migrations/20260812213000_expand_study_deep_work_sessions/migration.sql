ALTER TABLE "StudySession"
ADD COLUMN "topic" TEXT,
ADD COLUMN "focusStructure" TEXT,
ADD COLUMN "techniques" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "StudySessionResource" (
  "sessionId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudySessionResource_pkey" PRIMARY KEY ("sessionId", "resourceId")
);

CREATE INDEX "StudySession_workspaceId_archivedAt_startedAt_idx"
ON "StudySession"("workspaceId", "archivedAt", "startedAt");

CREATE INDEX "StudySessionResource_resourceId_idx"
ON "StudySessionResource"("resourceId");

ALTER TABLE "StudySessionResource"
ADD CONSTRAINT "StudySessionResource_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySessionResource"
ADD CONSTRAINT "StudySessionResource_resourceId_fkey"
FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
