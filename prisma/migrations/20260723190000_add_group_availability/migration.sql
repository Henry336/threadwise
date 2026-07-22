ALTER TYPE "GroupActivityType" ADD VALUE IF NOT EXISTS 'SCHEDULE_CREATED';
ALTER TYPE "GroupActivityType" ADD VALUE IF NOT EXISTS 'SCHEDULE_FINALIZED';
ALTER TYPE "GroupActivityType" ADD VALUE IF NOT EXISTS 'SCHEDULE_CANCELED';

CREATE TYPE "AvailabilityPollStatus" AS ENUM ('OPEN', 'FINALIZED', 'CANCELED');

CREATE TABLE "AvailabilityPoll" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "dayStartMinutes" INTEGER NOT NULL DEFAULT 480,
  "dayEndMinutes" INTEGER NOT NULL DEFAULT 1320,
  "slotMinutes" INTEGER NOT NULL DEFAULT 30,
  "status" "AvailabilityPollStatus" NOT NULL DEFAULT 'OPEN',
  "createdByTelegramId" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "telegramMessageId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "finalStartAt" TIMESTAMP(3),
  "finalEndAt" TIMESTAMP(3),
  "finalizedByTelegramId" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "lastReminderAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvailabilityPoll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvailabilityResponse" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "availableStarts" TIMESTAMP(3)[] NOT NULL,
  "wantsCalendar" BOOLEAN NOT NULL DEFAULT false,
  "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvailabilityResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvailabilityCalendarEvent" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventUrl" TEXT,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvailabilityCalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AvailabilityPoll_workspaceId_publicId_key" ON "AvailabilityPoll"("workspaceId", "publicId");
CREATE INDEX "AvailabilityPoll_workspaceId_status_updatedAt_idx" ON "AvailabilityPoll"("workspaceId", "status", "updatedAt");
CREATE INDEX "AvailabilityPoll_workspaceId_createdAt_idx" ON "AvailabilityPoll"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "AvailabilityResponse_pollId_telegramId_key" ON "AvailabilityResponse"("pollId", "telegramId");
CREATE INDEX "AvailabilityResponse_pollId_updatedAt_idx" ON "AvailabilityResponse"("pollId", "updatedAt");
CREATE UNIQUE INDEX "AvailabilityCalendarEvent_pollId_telegramId_key" ON "AvailabilityCalendarEvent"("pollId", "telegramId");
CREATE INDEX "AvailabilityCalendarEvent_userId_syncedAt_idx" ON "AvailabilityCalendarEvent"("userId", "syncedAt");

ALTER TABLE "AvailabilityPoll" ADD CONSTRAINT "AvailabilityPoll_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "GroupWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityResponse" ADD CONSTRAINT "AvailabilityResponse_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "AvailabilityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityCalendarEvent" ADD CONSTRAINT "AvailabilityCalendarEvent_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "AvailabilityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityCalendarEvent" ADD CONSTRAINT "AvailabilityCalendarEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
