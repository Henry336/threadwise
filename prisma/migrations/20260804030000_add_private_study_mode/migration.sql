-- Study Mode is an owner-only academic domain. It intentionally does not reuse
-- shared GroupWorkspace data or the generic Task reminder cadence.
CREATE TYPE "StudyTrafficLight" AS ENUM ('GREEN', 'AMBER', 'RED', 'UNASSESSED');
CREATE TYPE "StudyItemType" AS ENUM ('LECTURE', 'TUTORIAL', 'LAB', 'ASSIGNMENT', 'PROJECT', 'REVISION', 'TIMED_PRACTICE', 'READING', 'ADMINISTRATIVE');
CREATE TYPE "StudyItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PROCESSED', 'DONE', 'SKIPPED');
CREATE TYPE "StudyPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "StudyMistakeCategory" AS ENUM ('CONCEPTUAL_MISUNDERSTANDING', 'WRONG_APPROACH', 'EXECUTION_CARELESS', 'TIME_MANAGEMENT');
CREATE TYPE "StudyMistakeStatus" AS ENUM ('OPEN', 'REATTEMPT_DUE', 'RESOLVED');
CREATE TYPE "StudyReminderKind" AS ENUM ('WEEKLY_REVIEW', 'WEEKLY_REVIEW_INCOMPLETE', 'MISTAKE_REATTEMPT', 'MODULE_RED', 'DEADLINE_APPROACHING', 'ITEM_OVERDUE', 'STUDY_BLOCK', 'TIMED_PRACTICE_MISSING');

CREATE TABLE "StudyWorkspace" (
  "id" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "ownerTelegramId" TEXT NOT NULL,
  "boundChatId" TEXT, "semesterName" TEXT NOT NULL DEFAULT 'NUS semester',
  "semesterStartDate" TIMESTAMP(3), "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
  "active" BOOLEAN NOT NULL DEFAULT false, "weeklyReviewDay" INTEGER NOT NULL DEFAULT 7,
  "weeklyReviewTime" TEXT NOT NULL DEFAULT '19:00', "quietHoursStart" TEXT DEFAULT '01:30',
  "quietHoursEnd" TEXT DEFAULT '09:00', "maxRemindersPerDay" INTEGER NOT NULL DEFAULT 4,
  "timedPracticeStartWeek" INTEGER NOT NULL DEFAULT 4,
  "studyBlockRemindersEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyWorkspace_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyModule" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "displayOrder" INTEGER NOT NULL DEFAULT 0, "color" TEXT,
  "workloadGroup" TEXT, "currentMastery" "StudyTrafficLight" NOT NULL DEFAULT 'UNASSESSED',
  "masteryReason" TEXT, "redSince" TIMESTAMP(3), "lastRedWarningAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyModule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyWeek" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "number" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3) NOT NULL,
  "overallStatus" "StudyTrafficLight" NOT NULL DEFAULT 'UNASSESSED',
  "reviewCompleted" BOOLEAN NOT NULL DEFAULT false, "topPriorities" TEXT[] NOT NULL,
  "reflection" TEXT, "overloadNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyWeek_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyItem" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "moduleId" TEXT NOT NULL, "weekId" TEXT,
  "publicId" TEXT NOT NULL, "type" "StudyItemType" NOT NULL, "title" TEXT NOT NULL, "notes" TEXT,
  "status" "StudyItemStatus" NOT NULL DEFAULT 'OPEN', "priority" "StudyPriority" NOT NULL DEFAULT 'NORMAL',
  "dueAt" TIMESTAMP(3), "plannedMinutes" INTEGER, "actualMinutes" INTEGER NOT NULL DEFAULT 0,
  "mastery" "StudyTrafficLight" NOT NULL DEFAULT 'UNASSESSED', "masteryReason" TEXT,
  "processedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudySession" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "moduleId" TEXT NOT NULL, "itemId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL, "endedAt" TIMESTAMP(3), "durationMinutes" INTEGER,
  "method" TEXT NOT NULL, "result" TEXT, "topicsMixed" TEXT[] NOT NULL,
  "attemptedScore" DOUBLE PRECISION, "maximumScore" DOUBLE PRECISION, "usedNotes" BOOLEAN,
  "timed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyMistake" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "moduleId" TEXT NOT NULL, "itemId" TEXT,
  "publicId" TEXT NOT NULL, "source" TEXT NOT NULL, "category" "StudyMistakeCategory" NOT NULL,
  "cause" TEXT NOT NULL, "prevention" TEXT NOT NULL, "firstAttemptAt" TIMESTAMP(3) NOT NULL,
  "revisitAt" TIMESTAMP(3), "status" "StudyMistakeStatus" NOT NULL DEFAULT 'OPEN', "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyMistake_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WeeklyReview" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "weekId" TEXT NOT NULL, "moduleStatuses" JSONB NOT NULL,
  "wins" TEXT[] NOT NULL, "unresolvedTopics" TEXT[] NOT NULL, "nextWeekPriorities" TEXT[] NOT NULL,
  "lostTimeCauses" TEXT[] NOT NULL, "overloadNotes" TEXT, "workloadCompatible" BOOLEAN,
  "protectedOverflowBlock" TEXT, "summary" TEXT, "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeeklyReview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyScheduleBlock" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "moduleId" TEXT, "dayOfWeek" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL, "startWeek" INTEGER, "endWeek" INTEGER,
  "label" TEXT NOT NULL, "blockType" TEXT NOT NULL, "reminderLeadMinutes" INTEGER NOT NULL DEFAULT 10,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyScheduleBlock_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyConversation" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "kind" TEXT NOT NULL, "step" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyConversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudyReminderDelivery" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "kind" "StudyReminderKind" NOT NULL,
  "entityKey" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "scheduledFor" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3), "chatId" TEXT NOT NULL, "messageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudyReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyWorkspace_ownerUserId_key" ON "StudyWorkspace"("ownerUserId");
CREATE UNIQUE INDEX "StudyWorkspace_ownerTelegramId_key" ON "StudyWorkspace"("ownerTelegramId");
CREATE UNIQUE INDEX "StudyWorkspace_boundChatId_key" ON "StudyWorkspace"("boundChatId");
CREATE INDEX "StudyWorkspace_active_boundChatId_idx" ON "StudyWorkspace"("active", "boundChatId");
CREATE UNIQUE INDEX "StudyModule_workspaceId_code_key" ON "StudyModule"("workspaceId", "code");
CREATE INDEX "StudyModule_workspaceId_active_displayOrder_idx" ON "StudyModule"("workspaceId", "active", "displayOrder");
CREATE INDEX "StudyModule_workspaceId_currentMastery_idx" ON "StudyModule"("workspaceId", "currentMastery");
CREATE UNIQUE INDEX "StudyWeek_workspaceId_number_key" ON "StudyWeek"("workspaceId", "number");
CREATE INDEX "StudyWeek_workspaceId_startDate_endDate_idx" ON "StudyWeek"("workspaceId", "startDate", "endDate");
CREATE UNIQUE INDEX "StudyItem_workspaceId_publicId_key" ON "StudyItem"("workspaceId", "publicId");
CREATE INDEX "StudyItem_workspaceId_status_dueAt_idx" ON "StudyItem"("workspaceId", "status", "dueAt");
CREATE INDEX "StudyItem_moduleId_status_createdAt_idx" ON "StudyItem"("moduleId", "status", "createdAt");
CREATE INDEX "StudyItem_weekId_status_idx" ON "StudyItem"("weekId", "status");
CREATE INDEX "StudyItem_workspaceId_mastery_idx" ON "StudyItem"("workspaceId", "mastery");
CREATE INDEX "StudySession_workspaceId_startedAt_idx" ON "StudySession"("workspaceId", "startedAt");
CREATE INDEX "StudySession_workspaceId_endedAt_idx" ON "StudySession"("workspaceId", "endedAt");
CREATE INDEX "StudySession_moduleId_timed_startedAt_idx" ON "StudySession"("moduleId", "timed", "startedAt");
CREATE UNIQUE INDEX "StudyMistake_workspaceId_publicId_key" ON "StudyMistake"("workspaceId", "publicId");
CREATE INDEX "StudyMistake_workspaceId_status_revisitAt_idx" ON "StudyMistake"("workspaceId", "status", "revisitAt");
CREATE INDEX "StudyMistake_moduleId_status_idx" ON "StudyMistake"("moduleId", "status");
CREATE UNIQUE INDEX "WeeklyReview_weekId_key" ON "WeeklyReview"("weekId");
CREATE INDEX "WeeklyReview_workspaceId_completedAt_idx" ON "WeeklyReview"("workspaceId", "completedAt");
CREATE INDEX "StudyScheduleBlock_workspaceId_active_dayOfWeek_idx" ON "StudyScheduleBlock"("workspaceId", "active", "dayOfWeek");
CREATE UNIQUE INDEX "StudyConversation_workspaceId_key" ON "StudyConversation"("workspaceId");
CREATE INDEX "StudyConversation_expiresAt_idx" ON "StudyConversation"("expiresAt");
CREATE UNIQUE INDEX "StudyReminderDelivery_dedupeKey_key" ON "StudyReminderDelivery"("dedupeKey");
CREATE INDEX "StudyReminderDelivery_workspaceId_sentAt_idx" ON "StudyReminderDelivery"("workspaceId", "sentAt");
CREATE INDEX "StudyReminderDelivery_workspaceId_kind_scheduledFor_idx" ON "StudyReminderDelivery"("workspaceId", "kind", "scheduledFor");

ALTER TABLE "StudyWorkspace" ADD CONSTRAINT "StudyWorkspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyModule" ADD CONSTRAINT "StudyModule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyWeek" ADD CONSTRAINT "StudyWeek_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyItem" ADD CONSTRAINT "StudyItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyItem" ADD CONSTRAINT "StudyItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyItem" ADD CONSTRAINT "StudyItem_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "StudyWeek"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StudyItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyMistake" ADD CONSTRAINT "StudyMistake_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyMistake" ADD CONSTRAINT "StudyMistake_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyMistake" ADD CONSTRAINT "StudyMistake_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StudyItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "StudyWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyScheduleBlock" ADD CONSTRAINT "StudyScheduleBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyScheduleBlock" ADD CONSTRAINT "StudyScheduleBlock_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyConversation" ADD CONSTRAINT "StudyConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyReminderDelivery" ADD CONSTRAINT "StudyReminderDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 1 academic integrations and module-scoped capture. This migration has
-- not shipped yet, so the additions remain in the original Study Mode boundary.
ALTER TYPE "StudyReminderKind" ADD VALUE 'WEEKLY_PREVIEW';
ALTER TYPE "StudyReminderKind" ADD VALUE 'DAY_PREVIEW';
ALTER TYPE "StudyReminderKind" ADD VALUE 'CLASS_DEPARTURE';
ALTER TYPE "StudyReminderKind" ADD VALUE 'CLASS_FOLLOW_UP';
ALTER TYPE "StudyReminderKind" ADD VALUE 'CANVAS_MISSING_REVIEW';
ALTER TYPE "StudyReminderKind" ADD VALUE 'CANVAS_SYNC_ERROR';

CREATE TYPE "StudyItemSource" AS ENUM ('MANUAL', 'CANVAS');
CREATE TYPE "StudyResourceKind" AS ENUM ('NOTE', 'IMAGE', 'LINK', 'FILE', 'QUESTION');
CREATE TYPE "StudyCanvasSyncStatus" AS ENUM ('NEVER', 'RUNNING', 'READY', 'ERROR');
CREATE TYPE "StudyCanvasAssignmentStatus" AS ENUM ('ACTIVE', 'SUBMITTED', 'MISSING');

ALTER TABLE "StudyWorkspace"
  ALTER COLUMN "weeklyReviewDay" SET DEFAULT 6,
  ALTER COLUMN "weeklyReviewTime" SET DEFAULT '20:30',
  ADD COLUMN "weeklyPreviewDay" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "weeklyPreviewTime" TEXT NOT NULL DEFAULT '19:00',
  ADD COLUMN "canvasSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "activeModuleId" TEXT,
  ADD COLUMN "activeOriginId" TEXT,
  ADD COLUMN "activeOriginUntil" TIMESTAMP(3);

ALTER TABLE "StudyModule"
  ADD COLUMN "canvasCourseId" TEXT,
  ADD COLUMN "canvasCourseName" TEXT,
  ADD COLUMN "canvasLastSeenAt" TIMESTAMP(3);

ALTER TABLE "StudyItem"
  ADD COLUMN "source" "StudyItemSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "titleOverridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dueAtOverridden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StudyScheduleBlock"
  ADD COLUMN "venueId" TEXT,
  ADD COLUMN "venueName" TEXT,
  ADD COLUMN "destinationStopId" TEXT,
  ADD COLUMN "preparation" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "defaultOriginId" TEXT,
  ADD COLUMN "travelBufferMinutes" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE "StudyResource" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "kind" "StudyResourceKind" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "url" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "telegramFileId" TEXT,
  "telegramUniqueId" TEXT,
  "mediaKind" TEXT,
  "mimeType" TEXT,
  "fileName" TEXT,
  "fileSize" INTEGER,
  "caption" TEXT,
  "ocrText" TEXT,
  "ocrConfidence" DOUBLE PRECISION,
  "sourceMessageId" INTEGER,
  "pinnedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyPendingCapture" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT,
  "sourceText" TEXT,
  "telegramFileId" TEXT,
  "telegramUniqueId" TEXT,
  "mediaKind" TEXT,
  "mimeType" TEXT,
  "fileName" TEXT,
  "fileSize" INTEGER,
  "sourceMessageId" INTEGER,
  "selectedKind" "StudyResourceKind",
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyPendingCapture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyNoteCaptureSession" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyNoteCaptureSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyNoteCaptureSegment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudyNoteCaptureSegment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyCanvasSync" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "status" "StudyCanvasSyncStatus" NOT NULL DEFAULT 'NEVER',
  "canvasUserId" TEXT,
  "canvasUserName" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessfulAt" TIMESTAMP(3),
  "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyCanvasSync_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyCanvasAssignment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "canvasCourseId" TEXT NOT NULL,
  "canvasAssignmentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "htmlUrl" TEXT,
  "dueAt" TIMESTAMP(3),
  "unlockAt" TIMESTAMP(3),
  "lockAt" TIMESTAMP(3),
  "submissionState" TEXT,
  "submittedAt" TIMESTAMP(3),
  "workflowState" TEXT,
  "status" "StudyCanvasAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceUpdatedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "missingSince" TIMESTAMP(3),
  "needsReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyCanvasAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyLocationOrigin" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "providerVenueId" TEXT,
  "providerStopId" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyLocationOrigin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyModule_workspaceId_canvasCourseId_key" ON "StudyModule"("workspaceId", "canvasCourseId");
CREATE INDEX "StudyWorkspace_activeModuleId_idx" ON "StudyWorkspace"("activeModuleId");
CREATE INDEX "StudyWorkspace_activeOriginId_activeOriginUntil_idx" ON "StudyWorkspace"("activeOriginId", "activeOriginUntil");
CREATE INDEX "StudyScheduleBlock_defaultOriginId_idx" ON "StudyScheduleBlock"("defaultOriginId");
CREATE UNIQUE INDEX "StudyResource_workspaceId_publicId_key" ON "StudyResource"("workspaceId", "publicId");
CREATE UNIQUE INDEX "StudyResource_workspaceId_telegramUniqueId_key" ON "StudyResource"("workspaceId", "telegramUniqueId");
CREATE INDEX "StudyResource_workspaceId_kind_createdAt_idx" ON "StudyResource"("workspaceId", "kind", "createdAt");
CREATE INDEX "StudyResource_moduleId_kind_pinnedAt_createdAt_idx" ON "StudyResource"("moduleId", "kind", "pinnedAt", "createdAt");
CREATE INDEX "StudyResource_workspaceId_archivedAt_idx" ON "StudyResource"("workspaceId", "archivedAt");
CREATE UNIQUE INDEX "StudyPendingCapture_token_key" ON "StudyPendingCapture"("token");
CREATE INDEX "StudyPendingCapture_workspaceId_expiresAt_idx" ON "StudyPendingCapture"("workspaceId", "expiresAt");
CREATE UNIQUE INDEX "StudyNoteCaptureSession_workspaceId_key" ON "StudyNoteCaptureSession"("workspaceId");
CREATE INDEX "StudyNoteCaptureSession_expiresAt_idx" ON "StudyNoteCaptureSession"("expiresAt");
CREATE UNIQUE INDEX "StudyNoteCaptureSegment_sessionId_telegramMessageId_key" ON "StudyNoteCaptureSegment"("sessionId", "telegramMessageId");
CREATE INDEX "StudyNoteCaptureSegment_sessionId_createdAt_idx" ON "StudyNoteCaptureSegment"("sessionId", "createdAt");
CREATE UNIQUE INDEX "StudyCanvasSync_workspaceId_key" ON "StudyCanvasSync"("workspaceId");
CREATE INDEX "StudyCanvasSync_status_nextSyncAt_idx" ON "StudyCanvasSync"("status", "nextSyncAt");
CREATE UNIQUE INDEX "StudyCanvasAssignment_itemId_key" ON "StudyCanvasAssignment"("itemId");
CREATE UNIQUE INDEX "StudyCanvasAssignment_workspaceId_canvasAssignmentId_key" ON "StudyCanvasAssignment"("workspaceId", "canvasAssignmentId");
CREATE INDEX "StudyCanvasAssignment_workspaceId_status_dueAt_idx" ON "StudyCanvasAssignment"("workspaceId", "status", "dueAt");
CREATE INDEX "StudyCanvasAssignment_moduleId_status_dueAt_idx" ON "StudyCanvasAssignment"("moduleId", "status", "dueAt");
CREATE INDEX "StudyCanvasAssignment_workspaceId_needsReview_idx" ON "StudyCanvasAssignment"("workspaceId", "needsReview");
CREATE UNIQUE INDEX "StudyLocationOrigin_workspaceId_name_key" ON "StudyLocationOrigin"("workspaceId", "name");
CREATE INDEX "StudyLocationOrigin_workspaceId_active_displayOrder_idx" ON "StudyLocationOrigin"("workspaceId", "active", "displayOrder");

ALTER TABLE "StudyWorkspace" ADD CONSTRAINT "StudyWorkspace_activeModuleId_fkey" FOREIGN KEY ("activeModuleId") REFERENCES "StudyModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyWorkspace" ADD CONSTRAINT "StudyWorkspace_activeOriginId_fkey" FOREIGN KEY ("activeOriginId") REFERENCES "StudyLocationOrigin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyScheduleBlock" ADD CONSTRAINT "StudyScheduleBlock_defaultOriginId_fkey" FOREIGN KEY ("defaultOriginId") REFERENCES "StudyLocationOrigin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyPendingCapture" ADD CONSTRAINT "StudyPendingCapture_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyPendingCapture" ADD CONSTRAINT "StudyPendingCapture_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyNoteCaptureSession" ADD CONSTRAINT "StudyNoteCaptureSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyNoteCaptureSession" ADD CONSTRAINT "StudyNoteCaptureSession_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyNoteCaptureSegment" ADD CONSTRAINT "StudyNoteCaptureSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudyNoteCaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasSync" ADD CONSTRAINT "StudyCanvasSync_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasAssignment" ADD CONSTRAINT "StudyCanvasAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasAssignment" ADD CONSTRAINT "StudyCanvasAssignment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "StudyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyCanvasAssignment" ADD CONSTRAINT "StudyCanvasAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StudyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyLocationOrigin" ADD CONSTRAINT "StudyLocationOrigin_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
