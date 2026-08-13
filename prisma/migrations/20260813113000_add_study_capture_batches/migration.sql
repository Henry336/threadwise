CREATE TYPE "StudyCaptureBatchStatus" AS ENUM (
  'COLLECTING',
  'SENDING',
  'REVIEW',
  'PROCESSING',
  'COMPLETED',
  'EXPIRING',
  'EXPIRED'
);

CREATE TABLE "StudyPendingCaptureBatch" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT,
  "telegramMediaGroupId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "sharedCaption" TEXT,
  "status" "StudyCaptureBatchStatus" NOT NULL DEFAULT 'COLLECTING',
  "readyAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3),
  "reviewMessageId" INTEGER,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StudyPendingCaptureBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StudyPendingCapture"
ADD COLUMN "batchId" TEXT,
ADD COLUMN "batchPosition" INTEGER;

CREATE UNIQUE INDEX "StudyPendingCaptureBatch_token_key"
ON "StudyPendingCaptureBatch"("token");

CREATE UNIQUE INDEX "StudyPendingCaptureBatch_workspaceId_telegramMediaGroupId_key"
ON "StudyPendingCaptureBatch"("workspaceId", "telegramMediaGroupId");

CREATE INDEX "StudyPendingCaptureBatch_status_readyAt_leaseExpiresAt_idx"
ON "StudyPendingCaptureBatch"("status", "readyAt", "leaseExpiresAt");

CREATE INDEX "StudyPendingCaptureBatch_status_expiresAt_idx"
ON "StudyPendingCaptureBatch"("status", "expiresAt");

CREATE INDEX "StudyPendingCapture_batchId_batchPosition_idx"
ON "StudyPendingCapture"("batchId", "batchPosition");

ALTER TABLE "StudyPendingCaptureBatch"
ADD CONSTRAINT "StudyPendingCaptureBatch_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyPendingCaptureBatch"
ADD CONSTRAINT "StudyPendingCaptureBatch_moduleId_fkey"
FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudyPendingCapture"
ADD CONSTRAINT "StudyPendingCapture_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "StudyPendingCaptureBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
