CREATE TYPE "FileCourierJobKind" AS ENUM ('SEARCH', 'RECENT', 'LOOKUP', 'SEND');
CREATE TYPE "FileCourierJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

ALTER TABLE "CodexChatState"
ADD COLUMN "fileCourierAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fileRootCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "fileCourierMaxBytes" BIGINT,
ADD COLUMN "fileCourierLastError" TEXT;

CREATE TABLE "FileCourierJob" (
    "id" TEXT NOT NULL,
    "ownerTelegramId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "requesterTelegramId" TEXT NOT NULL,
    "telegramRequestMessageId" INTEGER,
    "kind" "FileCourierJobKind" NOT NULL,
    "status" "FileCourierJobStatus" NOT NULL DEFAULT 'PENDING',
    "query" TEXT,
    "sortLatest" BOOLEAN NOT NULL DEFAULT false,
    "selectedPath" TEXT,
    "selectedFileName" TEXT,
    "selectedParentPath" TEXT,
    "selectedSizeBytes" BIGINT,
    "selectedModifiedAt" TIMESTAMP(3),
    "selectedIdentityKey" TEXT,
    "selectedMimeType" TEXT,
    "selectedFileType" TEXT,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "telegramDeliveryMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileCourierJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FileCourierResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "absolutePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "parentPath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,
    "identityKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileCourierResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FileCourierAudit" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileCourierAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileCourierJob_ownerTelegramId_telegramChatId_status_createdAt_idx"
ON "FileCourierJob"("ownerTelegramId", "telegramChatId", "status", "createdAt");

CREATE INDEX "FileCourierJob_status_leaseExpiresAt_createdAt_idx"
ON "FileCourierJob"("status", "leaseExpiresAt", "createdAt");

CREATE INDEX "FileCourierResult_jobId_modifiedAt_idx"
ON "FileCourierResult"("jobId", "modifiedAt");

CREATE INDEX "FileCourierAudit_jobId_createdAt_idx"
ON "FileCourierAudit"("jobId", "createdAt");

CREATE INDEX "FileCourierAudit_action_createdAt_idx"
ON "FileCourierAudit"("action", "createdAt");

ALTER TABLE "FileCourierResult"
ADD CONSTRAINT "FileCourierResult_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "FileCourierJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileCourierAudit"
ADD CONSTRAINT "FileCourierAudit_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "FileCourierJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
