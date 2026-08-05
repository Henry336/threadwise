CREATE TYPE "CommunityEnvironment" AS ENUM ('TEST', 'PRODUCTION');
CREATE TYPE "CommunityModeratorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "CommunityTriggerMatchType" AS ENUM ('WORD', 'PHRASE', 'DOMAIN');
CREATE TYPE "CommunityModerationActionType" AS ENUM ('REVIEW', 'WARN', 'DELETE', 'MUTE', 'BAN');
CREATE TYPE "CommunityReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

CREATE TABLE "CommunityGroup" (
  "id" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "title" TEXT,
  "environment" "CommunityEnvironment" NOT NULL,
  "ownerTelegramId" TEXT NOT NULL,
  "moderatorReviewChatId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "observeMode" BOOLEAN NOT NULL DEFAULT true,
  "lockdownMode" BOOLEAN NOT NULL DEFAULT false,
  "pauseNewMemberPosting" BOOLEAN NOT NULL DEFAULT false,
  "newMemberPauseHours" INTEGER NOT NULL DEFAULT 24,
  "cleanupServiceMessages" BOOLEAN NOT NULL DEFAULT true,
  "floodWindowSeconds" INTEGER NOT NULL DEFAULT 10,
  "floodMessageLimit" INTEGER NOT NULL DEFAULT 6,
  "duplicateWindowSeconds" INTEGER NOT NULL DEFAULT 60,
  "duplicateMessageLimit" INTEGER NOT NULL DEFAULT 3,
  "massMentionLimit" INTEGER NOT NULL DEFAULT 5,
  "rulesEnglish" TEXT,
  "rulesBurmese" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityModerator" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "status" "CommunityModeratorStatus" NOT NULL DEFAULT 'ACTIVE',
  "canWarn" BOOLEAN NOT NULL DEFAULT true,
  "canDelete" BOOLEAN NOT NULL DEFAULT true,
  "canMute" BOOLEAN NOT NULL DEFAULT true,
  "canBan" BOOLEAN NOT NULL DEFAULT false,
  "canEditRules" BOOLEAN NOT NULL DEFAULT false,
  "canChangeAutomaticActions" BOOLEAN NOT NULL DEFAULT false,
  "canManageTrustedMembers" BOOLEAN NOT NULL DEFAULT false,
  "canLockdown" BOOLEAN NOT NULL DEFAULT false,
  "addedByTelegramId" TEXT NOT NULL,
  "suspendedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityModerator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityTriggerGroup" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "description" TEXT,
  "action" "CommunityModerationActionType" NOT NULL DEFAULT 'REVIEW',
  "deleteMessage" BOOLEAN NOT NULL DEFAULT false,
  "muteDurationMinutes" INTEGER,
  "notifyModerators" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityTriggerGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityTrigger" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "triggerGroupId" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "normalizedPattern" TEXT NOT NULL,
  "matchType" "CommunityTriggerMatchType" NOT NULL DEFAULT 'PHRASE',
  "language" TEXT NOT NULL DEFAULT 'ANY',
  "createdByTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityTrigger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityTrustedMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "note" TEXT,
  "addedByTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityTrustedMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityReport" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "sourceChatId" TEXT NOT NULL,
  "sourceMessageId" INTEGER NOT NULL,
  "reportedTelegramId" TEXT,
  "reportedUsername" TEXT,
  "reportedDisplayName" TEXT,
  "evidenceText" TEXT,
  "evidenceExpiresAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "status" "CommunityReportStatus" NOT NULL DEFAULT 'OPEN',
  "reportCount" INTEGER NOT NULL DEFAULT 1,
  "moderatorChatId" TEXT,
  "moderatorMessageId" INTEGER,
  "resolvedByTelegramId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityReportReporter" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "reporterTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityReportReporter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityModerationAction" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "targetTelegramId" TEXT,
  "action" "CommunityModerationActionType" NOT NULL,
  "source" TEXT NOT NULL,
  "sourceMessageId" INTEGER,
  "reportId" TEXT,
  "reason" TEXT,
  "muteUntil" TIMESTAMP(3),
  "reversible" BOOLEAN NOT NULL DEFAULT false,
  "undoneAt" TIMESTAMP(3),
  "undoneByTelegramId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityAudit" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetTelegramId" TEXT,
  "details" JSONB,
  "ownerNotificationStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityConversation" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "messageId" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityProcessedUpdate" (
  "updateId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityProcessedUpdate_pkey" PRIMARY KEY ("updateId")
);

CREATE UNIQUE INDEX "CommunityGroup_telegramChatId_key" ON "CommunityGroup"("telegramChatId");
CREATE INDEX "CommunityGroup_environment_enabled_idx" ON "CommunityGroup"("environment", "enabled");
CREATE UNIQUE INDEX "CommunityModerator_groupId_telegramId_key" ON "CommunityModerator"("groupId", "telegramId");
CREATE INDEX "CommunityModerator_telegramId_status_idx" ON "CommunityModerator"("telegramId", "status");
CREATE UNIQUE INDEX "CommunityTriggerGroup_groupId_normalizedName_key" ON "CommunityTriggerGroup"("groupId", "normalizedName");
CREATE INDEX "CommunityTriggerGroup_groupId_enabled_idx" ON "CommunityTriggerGroup"("groupId", "enabled");
CREATE UNIQUE INDEX "CommunityTrigger_groupId_normalizedPattern_key" ON "CommunityTrigger"("groupId", "normalizedPattern");
CREATE INDEX "CommunityTrigger_triggerGroupId_idx" ON "CommunityTrigger"("triggerGroupId");
CREATE UNIQUE INDEX "CommunityTrustedMember_groupId_telegramId_key" ON "CommunityTrustedMember"("groupId", "telegramId");
CREATE INDEX "CommunityTrustedMember_telegramId_idx" ON "CommunityTrustedMember"("telegramId");
CREATE UNIQUE INDEX "CommunityMember_groupId_telegramId_key" ON "CommunityMember"("groupId", "telegramId");
CREATE INDEX "CommunityMember_groupId_active_joinedAt_idx" ON "CommunityMember"("groupId", "active", "joinedAt");
CREATE UNIQUE INDEX "CommunityReport_groupId_sourceMessageId_key" ON "CommunityReport"("groupId", "sourceMessageId");
CREATE INDEX "CommunityReport_groupId_status_createdAt_idx" ON "CommunityReport"("groupId", "status", "createdAt");
CREATE UNIQUE INDEX "CommunityReportReporter_reportId_reporterTelegramId_key" ON "CommunityReportReporter"("reportId", "reporterTelegramId");
CREATE INDEX "CommunityReportReporter_reporterTelegramId_idx" ON "CommunityReportReporter"("reporterTelegramId");
CREATE INDEX "CommunityModerationAction_groupId_createdAt_idx" ON "CommunityModerationAction"("groupId", "createdAt");
CREATE INDEX "CommunityModerationAction_targetTelegramId_createdAt_idx" ON "CommunityModerationAction"("targetTelegramId", "createdAt");
CREATE INDEX "CommunityAudit_groupId_createdAt_idx" ON "CommunityAudit"("groupId", "createdAt");
CREATE INDEX "CommunityAudit_actorTelegramId_createdAt_idx" ON "CommunityAudit"("actorTelegramId", "createdAt");
CREATE UNIQUE INDEX "CommunityConversation_groupId_actorTelegramId_key" ON "CommunityConversation"("groupId", "actorTelegramId");
CREATE INDEX "CommunityConversation_expiresAt_idx" ON "CommunityConversation"("expiresAt");
CREATE INDEX "CommunityProcessedUpdate_createdAt_idx" ON "CommunityProcessedUpdate"("createdAt");

ALTER TABLE "CommunityModerator" ADD CONSTRAINT "CommunityModerator_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTriggerGroup" ADD CONSTRAINT "CommunityTriggerGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTrigger" ADD CONSTRAINT "CommunityTrigger_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTrigger" ADD CONSTRAINT "CommunityTrigger_triggerGroupId_fkey" FOREIGN KEY ("triggerGroupId") REFERENCES "CommunityTriggerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTrustedMember" ADD CONSTRAINT "CommunityTrustedMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReportReporter" ADD CONSTRAINT "CommunityReportReporter_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CommunityReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityModerationAction" ADD CONSTRAINT "CommunityModerationAction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityAudit" ADD CONSTRAINT "CommunityAudit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityConversation" ADD CONSTRAINT "CommunityConversation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
