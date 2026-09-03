ALTER TABLE "StudyWorkspace"
ADD COLUMN "calendarSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "calendarSyncStatus" TEXT NOT NULL DEFAULT 'DISCONNECTED',
ADD COLUMN "calendarLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "calendarLastSuccessfulAt" TIMESTAMP(3),
ADD COLUMN "calendarLastError" TEXT;

CREATE TABLE "StudyScheduleCalendarLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventUrl" TEXT,
  "operation" TEXT NOT NULL DEFAULT 'UPSERT',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "syncHash" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyScheduleCalendarLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyScheduleReminderSequence" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "occurrenceDate" TIMESTAMP(3) NOT NULL,
  "firstScheduledFor" TIMESTAMP(3) NOT NULL,
  "nextScheduledFor" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyScheduleReminderSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyScheduleCalendarLink_blockId_key" ON "StudyScheduleCalendarLink"("blockId");
CREATE UNIQUE INDEX "StudyScheduleCalendarLink_eventId_key" ON "StudyScheduleCalendarLink"("eventId");
CREATE INDEX "StudyScheduleCalendarLink_workspaceId_status_nextAttemptAt_idx" ON "StudyScheduleCalendarLink"("workspaceId", "status", "nextAttemptAt");
CREATE UNIQUE INDEX "StudyScheduleReminderSequence_blockId_occurrenceDate_key" ON "StudyScheduleReminderSequence"("blockId", "occurrenceDate");
CREATE INDEX "StudyScheduleReminderSequence_workspaceId_nextScheduledFor_idx" ON "StudyScheduleReminderSequence"("workspaceId", "nextScheduledFor");

ALTER TABLE "StudyScheduleCalendarLink"
ADD CONSTRAINT "StudyScheduleCalendarLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "StudyScheduleCalendarLink_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "StudyScheduleBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyScheduleReminderSequence"
ADD CONSTRAINT "StudyScheduleReminderSequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "StudyScheduleReminderSequence_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "StudyScheduleBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
