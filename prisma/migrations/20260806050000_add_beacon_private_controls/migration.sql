ALTER TABLE "CommunityModerator"
  ADD COLUMN "canAddTriggers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canRemoveTriggers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canChangeTriggerSeverity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageTriggerGroups" BOOLEAN NOT NULL DEFAULT false;

-- Preserve permissions explicitly granted before they were split into safer capabilities.
UPDATE "CommunityModerator"
SET
  "canAddTriggers" = "canEditRules",
  "canRemoveTriggers" = "canEditRules",
  "canChangeTriggerSeverity" = "canEditRules",
  "canManageTriggerGroups" = "canEditRules";

ALTER TABLE "CommunityTrigger"
  ADD COLUMN "pendingApproval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvedByTelegramId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "CommunityReport"
  ADD COLUMN "sourceMessageThreadId" INTEGER,
  ADD COLUMN "sourceTopicName" TEXT;

ALTER TABLE "CommunityModerationAction"
  ADD COLUMN "sourceMessageThreadId" INTEGER,
  ADD COLUMN "sourceTopicName" TEXT;

CREATE TABLE "CommunityControlSession" (
  "actorTelegramId" TEXT NOT NULL,
  "selectedGroupId" TEXT NOT NULL,
  "triggerSearchQuery" TEXT,
  "triggerActionFilter" "CommunityModerationActionType",
  "triggerGroupFilterId" TEXT,
  "triggerPage" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityControlSession_pkey" PRIMARY KEY ("actorTelegramId")
);

CREATE INDEX "CommunityControlSession_selectedGroupId_idx" ON "CommunityControlSession"("selectedGroupId");

ALTER TABLE "CommunityControlSession"
  ADD CONSTRAINT "CommunityControlSession_selectedGroupId_fkey"
  FOREIGN KEY ("selectedGroupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
