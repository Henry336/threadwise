ALTER TABLE "StudyScheduleBlock"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "sourceRef" TEXT;

CREATE UNIQUE INDEX "StudyScheduleBlock_workspaceId_source_sourceRef_key"
ON "StudyScheduleBlock"("workspaceId", "source", "sourceRef");
