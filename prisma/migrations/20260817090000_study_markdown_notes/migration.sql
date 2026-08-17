CREATE TABLE "StudyResourceRevision" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source" TEXT NOT NULL DEFAULT 'DASHBOARD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudyResourceRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyResourceRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyResourceRevision_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StudyResourceRevision_resourceId_createdAt_idx"
ON "StudyResourceRevision"("resourceId", "createdAt");

CREATE INDEX "StudyResourceRevision_workspaceId_createdAt_idx"
ON "StudyResourceRevision"("workspaceId", "createdAt");

CREATE TABLE "StudyNoteLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceResourceId" TEXT NOT NULL,
  "targetResourceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudyNoteLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyNoteLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyNoteLink_sourceResourceId_fkey" FOREIGN KEY ("sourceResourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyNoteLink_targetResourceId_fkey" FOREIGN KEY ("targetResourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StudyNoteLink_sourceResourceId_targetResourceId_key"
ON "StudyNoteLink"("sourceResourceId", "targetResourceId");

CREATE INDEX "StudyNoteLink_workspaceId_targetResourceId_idx"
ON "StudyNoteLink"("workspaceId", "targetResourceId");
