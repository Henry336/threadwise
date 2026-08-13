CREATE TYPE "TaskAudience" AS ENUM ('UNASSIGNED', 'EVERYONE', 'ASSIGNEES');
CREATE TYPE "TaskReminderScheduleStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'CANCELED');

ALTER TABLE "Task"
ADD COLUMN "audience" "TaskAudience" NOT NULL DEFAULT 'UNASSIGNED';

UPDATE "Task" AS task
SET "audience" = 'ASSIGNEES'
WHERE EXISTS (
  SELECT 1
  FROM "TaskAssignee" AS assignee
  WHERE assignee."taskId" = task."id"
);

ALTER TABLE "ReminderDelivery"
ADD COLUMN "deliveryKey" TEXT;

CREATE UNIQUE INDEX "ReminderDelivery_deliveryKey_key"
ON "ReminderDelivery"("deliveryKey");

CREATE TABLE "TaskReminderSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" "TaskReminderScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "leaseExpiresAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "taskStateCanceled" BOOLEAN NOT NULL DEFAULT false,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskReminderSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskReminderSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskReminderSchedule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaskReminderSchedule_taskId_scheduledAt_key"
ON "TaskReminderSchedule"("taskId", "scheduledAt");
CREATE INDEX "TaskReminderSchedule_status_scheduledAt_idx"
ON "TaskReminderSchedule"("status", "scheduledAt");
CREATE INDEX "TaskReminderSchedule_userId_status_scheduledAt_idx"
ON "TaskReminderSchedule"("userId", "status", "scheduledAt");

CREATE TABLE "TaskControlSurface" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskControlSurface_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskControlSurface_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaskControlSurface_userId_chatId_key"
ON "TaskControlSurface"("userId", "chatId");
CREATE INDEX "TaskControlSurface_chatId_idx"
ON "TaskControlSurface"("chatId");
