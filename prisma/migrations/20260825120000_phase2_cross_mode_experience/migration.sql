-- Phase 2 remains additive: calendar-date recurrence and exceptions coexist
-- with legacy academic-week fields during migration.
ALTER TABLE "StudyScheduleBlock"
  ADD COLUMN "customTypeLabel" TEXT,
  ADD COLUMN "recurrenceStartDate" TIMESTAMP(3),
  ADD COLUMN "recurrenceEndDate" TIMESTAMP(3),
  ADD COLUMN "excludedDates" TIMESTAMP(3)[] NOT NULL DEFAULT ARRAY[]::TIMESTAMP(3)[];

ALTER TABLE "Task"
  ADD COLUMN "automaticReminderCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "automaticReminderBudget" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "remindersDismissedAt" TIMESTAMP(3);

CREATE TABLE "StudyTravelReminderState" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "occurrenceDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3),
  "leaveAt" TIMESTAMP(3),
  "originName" TEXT,
  "boardingStop" TEXT,
  "services" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "live" BOOLEAN NOT NULL DEFAULT false,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "arrivedAt" TIMESTAMP(3),
  "mutedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyTravelReminderState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyTravelReminderState_blockId_occurrenceDate_key"
  ON "StudyTravelReminderState"("blockId", "occurrenceDate");
CREATE INDEX "StudyTravelReminderState_workspaceId_status_occurrenceDate_idx"
  ON "StudyTravelReminderState"("workspaceId", "status", "occurrenceDate");

ALTER TABLE "StudyTravelReminderState"
  ADD CONSTRAINT "StudyTravelReminderState_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyTravelReminderState"
  ADD CONSTRAINT "StudyTravelReminderState_blockId_fkey"
  FOREIGN KEY ("blockId") REFERENCES "StudyScheduleBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
