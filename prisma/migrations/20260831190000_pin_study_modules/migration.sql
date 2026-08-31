ALTER TABLE "StudyModule"
ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "StudyModule_workspaceId_active_pinnedAt_displayOrder_idx"
ON "StudyModule"("workspaceId", "active", "pinnedAt", "displayOrder");
