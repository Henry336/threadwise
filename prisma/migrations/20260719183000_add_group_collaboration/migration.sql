CREATE TYPE "TaskAssigneeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');
CREATE TYPE "GroupActivityType" AS ENUM (
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_COMPLETED',
  'TASK_REOPENED',
  'TASK_ARCHIVED',
  'TASK_ASSIGNED',
  'TASK_UNASSIGNED',
  'ASSIGNMENT_ACCEPTED',
  'ASSIGNMENT_DECLINED',
  'TASK_BLOCKED',
  'TASK_UNBLOCKED',
  'TASK_HANDED_OFF'
);

ALTER TABLE "TaskAssignee"
ADD COLUMN "status" "TaskAssigneeStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "respondedAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "TaskAssignee_telegramId_idx";
CREATE INDEX "TaskAssignee_telegramId_status_idx" ON "TaskAssignee"("telegramId", "status");
CREATE INDEX "TaskAssignee_taskId_status_idx" ON "TaskAssignee"("taskId", "status");

CREATE TABLE "GroupActivity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "type" "GroupActivityType" NOT NULL,
  "taskPublicId" TEXT,
  "taskTitle" TEXT,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupActivity_workspaceId_createdAt_idx" ON "GroupActivity"("workspaceId", "createdAt");
CREATE INDEX "GroupActivity_workspaceId_type_createdAt_idx" ON "GroupActivity"("workspaceId", "type", "createdAt");

ALTER TABLE "GroupActivity"
ADD CONSTRAINT "GroupActivity_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "GroupWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
