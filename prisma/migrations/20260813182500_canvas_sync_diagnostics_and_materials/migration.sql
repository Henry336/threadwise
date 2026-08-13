CREATE TYPE "StudyCanvasMaterialKind" AS ENUM ('PAGE', 'FILE', 'ASSIGNMENT', 'QUIZ', 'DISCUSSION', 'EXTERNAL_URL', 'OTHER');

ALTER TABLE "StudyCanvasSync" ADD COLUMN "lastSummary" JSONB;

CREATE TABLE "StudyCanvasCourseModule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "canvasCourseId" TEXT NOT NULL,
    "canvasModuleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "unlockAt" TIMESTAMP(3),
    "workflowState" TEXT,
    "published" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudyCanvasCourseModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyCanvasMaterial" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "courseModuleId" TEXT,
    "canvasCourseId" TEXT NOT NULL,
    "canvasModuleItemId" TEXT NOT NULL,
    "canvasContentId" TEXT,
    "kind" "StudyCanvasMaterialKind" NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "htmlUrl" TEXT,
    "apiUrl" TEXT,
    "externalUrl" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "extractedText" TEXT,
    "contentHash" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "unlockAt" TIMESTAMP(3),
    "published" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudyCanvasMaterial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyCanvasCourseModule_workspaceId_canvasModuleId_key" ON "StudyCanvasCourseModule"("workspaceId", "canvasModuleId");
CREATE INDEX "StudyCanvasCourseModule_workspaceId_canvasCourseId_position_idx" ON "StudyCanvasCourseModule"("workspaceId", "canvasCourseId", "position");
CREATE INDEX "StudyCanvasCourseModule_moduleId_active_position_idx" ON "StudyCanvasCourseModule"("moduleId", "active", "position");
CREATE UNIQUE INDEX "StudyCanvasMaterial_workspaceId_canvasModuleItemId_key" ON "StudyCanvasMaterial"("workspaceId", "canvasModuleItemId");
CREATE INDEX "StudyCanvasMaterial_workspaceId_kind_active_idx" ON "StudyCanvasMaterial"("workspaceId", "kind", "active");
CREATE INDEX "StudyCanvasMaterial_moduleId_active_position_idx" ON "StudyCanvasMaterial"("moduleId", "active", "position");
CREATE INDEX "StudyCanvasMaterial_courseModuleId_position_idx" ON "StudyCanvasMaterial"("courseModuleId", "position");

ALTER TABLE "StudyCanvasCourseModule" ADD CONSTRAINT "StudyCanvasCourseModule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasCourseModule" ADD CONSTRAINT "StudyCanvasCourseModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasMaterial" ADD CONSTRAINT "StudyCanvasMaterial_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasMaterial" ADD CONSTRAINT "StudyCanvasMaterial_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasMaterial" ADD CONSTRAINT "StudyCanvasMaterial_courseModuleId_fkey" FOREIGN KEY ("courseModuleId") REFERENCES "StudyCanvasCourseModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
