CREATE TYPE "RecurrenceRule" AS ENUM ('DAILY', 'WEEKLY');

ALTER TABLE "Task"
ADD COLUMN "assignedTelegramId" TEXT,
ADD COLUMN "assignedUsername" TEXT,
ADD COLUMN "assignedDisplayName" TEXT,
ADD COLUMN "recurrenceRule" "RecurrenceRule",
ADD COLUMN "recurrenceIntervalDays" INTEGER;

CREATE INDEX "Task_userId_assignedUsername_idx" ON "Task"("userId", "assignedUsername");
CREATE INDEX "Task_recurrenceRule_nextReminderAt_idx" ON "Task"("recurrenceRule", "nextReminderAt");
