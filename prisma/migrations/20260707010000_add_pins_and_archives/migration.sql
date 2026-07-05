ALTER TABLE "Idea" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Task" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Note" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Note" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Reflection" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Reflection" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Idea_userId_pinnedAt_idx" ON "Idea"("userId", "pinnedAt");
CREATE INDEX "Idea_userId_archivedAt_idx" ON "Idea"("userId", "archivedAt");

CREATE INDEX "Task_userId_pinnedAt_idx" ON "Task"("userId", "pinnedAt");
CREATE INDEX "Task_userId_archivedAt_idx" ON "Task"("userId", "archivedAt");

CREATE INDEX "Note_userId_pinnedAt_idx" ON "Note"("userId", "pinnedAt");
CREATE INDEX "Note_userId_archivedAt_idx" ON "Note"("userId", "archivedAt");

CREATE INDEX "Reflection_userId_pinnedAt_idx" ON "Reflection"("userId", "pinnedAt");
CREATE INDEX "Reflection_userId_archivedAt_idx" ON "Reflection"("userId", "archivedAt");
