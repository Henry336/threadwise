ALTER TABLE "GeminiStudyAnalysisJob"
ADD COLUMN "evidenceCiphertext" TEXT,
ADD COLUMN "promptCiphertext" TEXT,
ADD COLUMN "resultCiphertext" TEXT,
ADD COLUMN "diagnosticsPurgedAt" TIMESTAMP(3);

ALTER TABLE "GeminiIdeaJob"
ADD COLUMN "diagnosticsPurgedAt" TIMESTAMP(3);

CREATE TABLE "PrivacyMaintenanceRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "backupReferenceHash" TEXT NOT NULL,
    "target" TEXT,
    "lastCursor" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "changedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "safeErrorCode" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyMaintenanceRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivacyMaintenanceRun_kind_status_updatedAt_idx"
ON "PrivacyMaintenanceRun"("kind", "status", "updatedAt");

CREATE INDEX "PrivacyMaintenanceRun_backupReferenceHash_kind_status_idx"
ON "PrivacyMaintenanceRun"("backupReferenceHash", "kind", "status");

CREATE INDEX "PrivacyMaintenanceRun_status_leaseExpiresAt_idx"
ON "PrivacyMaintenanceRun"("status", "leaseExpiresAt");

CREATE UNIQUE INDEX "PrivacyMaintenanceRun_single_running_kind_idx"
ON "PrivacyMaintenanceRun"("kind") WHERE "status" = 'RUNNING';
