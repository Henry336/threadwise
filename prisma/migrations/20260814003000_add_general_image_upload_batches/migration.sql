CREATE TYPE "ImageUploadBatchStatus" AS ENUM (
  'COLLECTING',
  'SENDING',
  'REVIEW',
  'PROCESSING',
  'COMPLETED',
  'EXPIRING',
  'EXPIRED'
);

CREATE TABLE "PendingImageUploadBatch" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "telegramMediaGroupId" TEXT NOT NULL,
  "sharedCaption" TEXT,
  "status" "ImageUploadBatchStatus" NOT NULL DEFAULT 'COLLECTING',
  "readyAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3),
  "reviewMessageId" INTEGER,
  "awaitingCaption" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingImageUploadBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PendingImageUpload"
ADD COLUMN "sourceChatId" TEXT,
ADD COLUMN "sourceMessageId" INTEGER,
ADD COLUMN "batchId" TEXT,
ADD COLUMN "batchPosition" INTEGER;

CREATE UNIQUE INDEX "PendingImageUploadBatch_token_key"
ON "PendingImageUploadBatch"("token");

CREATE UNIQUE INDEX "PendingImageUploadBatch_userId_chatId_telegramMediaGroupId_key"
ON "PendingImageUploadBatch"("userId", "chatId", "telegramMediaGroupId");

CREATE INDEX "PendingImageUploadBatch_status_readyAt_leaseExpiresAt_idx"
ON "PendingImageUploadBatch"("status", "readyAt", "leaseExpiresAt");

CREATE INDEX "PendingImageUploadBatch_status_expiresAt_idx"
ON "PendingImageUploadBatch"("status", "expiresAt");

CREATE UNIQUE INDEX "PendingImageUpload_userId_sourceChatId_sourceMessageId_key"
ON "PendingImageUpload"("userId", "sourceChatId", "sourceMessageId");

CREATE INDEX "PendingImageUpload_batchId_batchPosition_idx"
ON "PendingImageUpload"("batchId", "batchPosition");

ALTER TABLE "PendingImageUploadBatch"
ADD CONSTRAINT "PendingImageUploadBatch_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PendingImageUpload"
ADD CONSTRAINT "PendingImageUpload_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "PendingImageUploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
