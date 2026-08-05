CREATE TYPE "CommunityOffenceSeverity" AS ENUM ('MINOR', 'MODERATE', 'SERIOUS', 'CRITICAL');
CREATE TYPE "CommunityOffenceStatus" AS ENUM ('PENDING', 'ACTIVE', 'PARDONED', 'REJECTED');

ALTER TABLE "CommunityGroup"
  ADD COLUMN "warningScoreThreshold" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "muteScoreThreshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "banScoreThreshold" INTEGER NOT NULL DEFAULT 8;

ALTER TABLE "CommunityTriggerGroup"
  ADD COLUMN "severity" "CommunityOffenceSeverity" NOT NULL DEFAULT 'MINOR';

UPDATE "CommunityTriggerGroup"
SET "severity" = CASE
  WHEN "action" = 'BAN' THEN 'CRITICAL'::"CommunityOffenceSeverity"
  WHEN "action" = 'MUTE' THEN 'SERIOUS'::"CommunityOffenceSeverity"
  WHEN "action" IN ('WARN', 'DELETE') THEN 'MODERATE'::"CommunityOffenceSeverity"
  ELSE 'MINOR'::"CommunityOffenceSeverity"
END;

CREATE TABLE "CommunitySeverityRule" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "severity" "CommunityOffenceSeverity" NOT NULL,
  "points" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunitySeverityRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityOffence" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "reportId" TEXT,
  "targetTelegramId" TEXT NOT NULL,
  "targetUsername" TEXT,
  "targetDisplayName" TEXT,
  "sourceChatId" TEXT NOT NULL,
  "sourceMessageId" INTEGER,
  "sourceMessageThreadId" INTEGER,
  "sourceTopicName" TEXT,
  "categoryName" TEXT,
  "severity" "CommunityOffenceSeverity" NOT NULL,
  "policyPoints" INTEGER NOT NULL,
  "proposedPoints" INTEGER NOT NULL,
  "proposedByTelegramId" TEXT NOT NULL,
  "proposalReason" TEXT,
  "appliedPoints" INTEGER,
  "status" "CommunityOffenceStatus" NOT NULL DEFAULT 'PENDING',
  "confirmedByTelegramId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "pardonedByTelegramId" TEXT,
  "pardonedAt" TIMESTAMP(3),
  "pardonReason" TEXT,
  "permanentBanApplied" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityOffence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityForumTopic" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "messageThreadId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "iconColor" INTEGER,
  "iconCustomEmojiId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "replacedByThreadId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityForumTopic_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CommunitySeverityRule" ("id", "groupId", "severity", "points", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || g."id" || s."severity"::text), g."id", s."severity", s."points", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CommunityGroup" g
CROSS JOIN (VALUES
  ('MINOR'::"CommunityOffenceSeverity", 1),
  ('MODERATE'::"CommunityOffenceSeverity", 2),
  ('SERIOUS'::"CommunityOffenceSeverity", 3),
  ('CRITICAL'::"CommunityOffenceSeverity", 5)
) AS s("severity", "points");

CREATE UNIQUE INDEX "CommunitySeverityRule_groupId_severity_key" ON "CommunitySeverityRule"("groupId", "severity");
CREATE INDEX "CommunitySeverityRule_groupId_idx" ON "CommunitySeverityRule"("groupId");
CREATE UNIQUE INDEX "CommunityOffence_reportId_key" ON "CommunityOffence"("reportId");
CREATE INDEX "CommunityOffence_groupId_targetTelegramId_status_createdAt_idx" ON "CommunityOffence"("groupId", "targetTelegramId", "status", "createdAt");
CREATE INDEX "CommunityOffence_groupId_status_createdAt_idx" ON "CommunityOffence"("groupId", "status", "createdAt");
CREATE UNIQUE INDEX "CommunityForumTopic_groupId_messageThreadId_key" ON "CommunityForumTopic"("groupId", "messageThreadId");
CREATE INDEX "CommunityForumTopic_groupId_active_idx" ON "CommunityForumTopic"("groupId", "active");

ALTER TABLE "CommunitySeverityRule" ADD CONSTRAINT "CommunitySeverityRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityOffence" ADD CONSTRAINT "CommunityOffence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityOffence" ADD CONSTRAINT "CommunityOffence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CommunityReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityForumTopic" ADD CONSTRAINT "CommunityForumTopic_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
