-- Existing active-module values did not have an expiry and are intentionally
-- treated as expired. The nullable timestamp preserves every existing module.
ALTER TABLE "StudyWorkspace"
ADD COLUMN "activeModuleUntil" TIMESTAMP(3);

DROP INDEX IF EXISTS "StudyWorkspace_activeModuleId_idx";
CREATE INDEX "StudyWorkspace_activeModuleId_activeModuleUntil_idx"
ON "StudyWorkspace"("activeModuleId", "activeModuleUntil");

-- OCR previews remain attached to the durable pending capture until the owner
-- explicitly saves or cancels the image.
ALTER TABLE "StudyPendingCapture"
ADD COLUMN "ocrText" TEXT,
ADD COLUMN "ocrConfidence" DOUBLE PRECISION,
ADD COLUMN "sourceSenderTelegramId" TEXT,
ADD COLUMN "sourceSentAt" TIMESTAMP(3);

ALTER TABLE "StudyResource"
ADD COLUMN "sourceSenderTelegramId" TEXT,
ADD COLUMN "sourceSentAt" TIMESTAMP(3);
