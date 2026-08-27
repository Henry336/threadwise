-- Phase 1 foundation for planned work, durable task drafts, and idempotent daily brief delivery.
-- All changes are additive. Existing deadlines and reminder schedules are preserved verbatim.

CREATE TYPE "PlanningScope" AS ENUM ('PERSONAL', 'GROUP', 'STUDY');
CREATE TYPE "TaskCaptureDraftStatus" AS ENUM ('COLLECTING', 'REVIEWING', 'COMMITTING', 'COMMITTED', 'CANCELED', 'EXPIRED');
CREATE TYPE "TaskCaptureDraftItemStatus" AS ENUM ('READY', 'NEEDS_REVIEW');
CREATE TYPE "DailyBriefKind" AS ENUM ('MORNING', 'EVENING', 'GROUP_DIGEST');
CREATE TYPE "DailyBriefDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

ALTER TABLE "Task"
  ADD COLUMN "plannedFor" DATE,
  ADD COLUMN "firstPlannedFor" DATE;

ALTER TABLE "StudyItem"
  ADD COLUMN "plannedFor" DATE,
  ADD COLUMN "firstPlannedFor" DATE;

ALTER TABLE "GroupWorkspace"
  ADD COLUMN "timezone" TEXT;

ALTER TABLE "UserSettings"
  ADD COLUMN "morningBriefEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "morningBriefTime" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN "eveningDebriefEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "eveningDebriefTime" TEXT NOT NULL DEFAULT '21:00';

CREATE TABLE "TaskCaptureDraft" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "principalTelegramId" TEXT NOT NULL,
  "scope" "PlanningScope" NOT NULL,
  "groupWorkspaceId" TEXT,
  "studyWorkspaceId" TEXT,
  "sourceText" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" "TaskCaptureDraftStatus" NOT NULL DEFAULT 'COLLECTING',
  "telegramChatId" TEXT,
  "telegramReviewMessageId" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskCaptureDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskCaptureDraft_scope_check" CHECK (
    ("scope" = 'PERSONAL' AND "groupWorkspaceId" IS NULL AND "studyWorkspaceId" IS NULL) OR
    ("scope" = 'GROUP' AND "groupWorkspaceId" IS NOT NULL AND "studyWorkspaceId" IS NULL) OR
    ("scope" = 'STUDY' AND "groupWorkspaceId" IS NULL AND "studyWorkspaceId" IS NOT NULL)
  )
);

CREATE TABLE "TaskCaptureDraftItem" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "plannedFor" DATE,
  "dueAt" TIMESTAMP(3),
  "moduleId" TEXT,
  "studyItemType" "StudyItemType",
  "assignees" JSONB NOT NULL DEFAULT '[]',
  "teamOwnerLabel" TEXT,
  "linkedTaskId" TEXT,
  "linkedStudyItemId" TEXT,
  "warnings" TEXT[],
  "status" "TaskCaptureDraftItemStatus" NOT NULL DEFAULT 'READY',
  "included" BOOLEAN NOT NULL DEFAULT true,
  "resultTaskId" TEXT,
  "resultStudyItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskCaptureDraftItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyBriefDelivery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipientTelegramId" TEXT NOT NULL,
  "localDate" DATE NOT NULL,
  "kind" "DailyBriefKind" NOT NULL,
  "scope" "PlanningScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "status" "DailyBriefDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "contentHash" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyBriefDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_userId_status_plannedFor_idx" ON "Task"("userId", "status", "plannedFor");
CREATE INDEX "StudyItem_workspaceId_status_plannedFor_idx" ON "StudyItem"("workspaceId", "status", "plannedFor");
CREATE INDEX "TaskCaptureDraft_principalTelegramId_status_expiresAt_idx" ON "TaskCaptureDraft"("principalTelegramId", "status", "expiresAt");
CREATE INDEX "TaskCaptureDraft_ownerUserId_status_updatedAt_idx" ON "TaskCaptureDraft"("ownerUserId", "status", "updatedAt");
CREATE INDEX "TaskCaptureDraft_groupWorkspaceId_status_idx" ON "TaskCaptureDraft"("groupWorkspaceId", "status");
CREATE INDEX "TaskCaptureDraft_studyWorkspaceId_status_idx" ON "TaskCaptureDraft"("studyWorkspaceId", "status");
CREATE UNIQUE INDEX "TaskCaptureDraftItem_draftId_position_key" ON "TaskCaptureDraftItem"("draftId", "position");
CREATE INDEX "TaskCaptureDraftItem_draftId_included_status_idx" ON "TaskCaptureDraftItem"("draftId", "included", "status");
CREATE UNIQUE INDEX "DailyBriefDelivery_recipientTelegramId_localDate_kind_scopeKey_key" ON "DailyBriefDelivery"("recipientTelegramId", "localDate", "kind", "scopeKey");
CREATE INDEX "DailyBriefDelivery_status_localDate_idx" ON "DailyBriefDelivery"("status", "localDate");
CREATE INDEX "DailyBriefDelivery_userId_localDate_kind_idx" ON "DailyBriefDelivery"("userId", "localDate", "kind");

ALTER TABLE "TaskCaptureDraft"
  ADD CONSTRAINT "TaskCaptureDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TaskCaptureDraft_groupWorkspaceId_fkey" FOREIGN KEY ("groupWorkspaceId") REFERENCES "GroupWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TaskCaptureDraft_studyWorkspaceId_fkey" FOREIGN KEY ("studyWorkspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskCaptureDraftItem"
  ADD CONSTRAINT "TaskCaptureDraftItem_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "TaskCaptureDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyBriefDelivery"
  ADD CONSTRAINT "DailyBriefDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
