ALTER TABLE "CodexJob" ADD COLUMN "publishRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CodexJob" ADD COLUMN "publishAutoMerge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CodexJob" ADD COLUMN "publishStatus" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishBranch" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishCommitSha" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishPrNumber" INTEGER;
ALTER TABLE "CodexJob" ADD COLUMN "publishPrUrl" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishChecks" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishMergeCommitSha" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishBlocker" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "publishCompletedAt" TIMESTAMP(3);

CREATE TABLE "CodexPublishAudit" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "ownerTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "branch" TEXT,
  "commitSha" TEXT,
  "prNumber" INTEGER,
  "prUrl" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CodexPublishAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodexPublishAudit_jobId_eventKey_key"
ON "CodexPublishAudit"("jobId", "eventKey");
CREATE INDEX "CodexPublishAudit_ownerTelegramId_telegramChatId_createdAt_idx"
ON "CodexPublishAudit"("ownerTelegramId", "telegramChatId", "createdAt");
CREATE INDEX "CodexPublishAudit_jobId_createdAt_idx"
ON "CodexPublishAudit"("jobId", "createdAt");

ALTER TABLE "CodexPublishAudit" ADD CONSTRAINT "CodexPublishAudit_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "CodexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
