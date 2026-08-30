CREATE TABLE "StudyNoteDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "draftKey" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceUpdatedAt" TIMESTAMP(3),
    "moduleId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyNoteDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyNoteDraft_workspaceId_draftKey_key" ON "StudyNoteDraft"("workspaceId", "draftKey");
CREATE INDEX "StudyNoteDraft_ownerUserId_expiresAt_idx" ON "StudyNoteDraft"("ownerUserId", "expiresAt");
CREATE INDEX "StudyNoteDraft_workspaceId_updatedAt_idx" ON "StudyNoteDraft"("workspaceId", "updatedAt");

ALTER TABLE "StudyNoteDraft" ADD CONSTRAINT "StudyNoteDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyNoteDraft" ADD CONSTRAINT "StudyNoteDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyNoteDraft" ADD CONSTRAINT "StudyNoteDraft_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyNoteDraft" ADD CONSTRAINT "StudyNoteDraft_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
