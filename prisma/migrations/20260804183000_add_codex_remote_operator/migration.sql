-- AlterEnum
ALTER TYPE "CodexJobStatus" ADD VALUE IF NOT EXISTS 'WAITING_APPROVAL' BEFORE 'PENDING';
ALTER TYPE "CodexJobStatus" ADD VALUE IF NOT EXISTS 'CANCELED';

-- CreateEnum
CREATE TYPE "CodexApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- AlterTable
ALTER TABLE "CodexProject"
ADD COLUMN "gitRepository" BOOLEAN,
ADD COLUMN "gitBranch" TEXT,
ADD COLUMN "gitClean" BOOLEAN,
ADD COLUMN "gitHeadSha" TEXT,
ADD COLUMN "gitOriginMainSha" TEXT,
ADD COLUMN "gitReady" BOOLEAN,
ADD COLUMN "gitError" TEXT;

-- AlterTable
ALTER TABLE "CodexChatState"
ADD COLUMN "workerCapabilities" JSONB,
ADD COLUMN "workerCapabilitiesAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CodexJob"
ADD COLUMN "requestedCapabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "approvedCapabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "repairAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxRepairAttempts" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "CodexJobApproval" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "status" "CodexApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedBy" TEXT NOT NULL DEFAULT 'OWNER',
    "decisionTelegramId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodexJobApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodexJobApproval_jobId_capability_key" ON "CodexJobApproval"("jobId", "capability");
CREATE INDEX "CodexJobApproval_status_requestedAt_idx" ON "CodexJobApproval"("status", "requestedAt");
CREATE INDEX "CodexJobApproval_jobId_status_idx" ON "CodexJobApproval"("jobId", "status");

ALTER TABLE "CodexJobApproval"
ADD CONSTRAINT "CodexJobApproval_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "CodexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
