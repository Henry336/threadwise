ALTER TABLE "UserSettings"
ADD COLUMN "directNudgesEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TaskAssignee" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "telegramId" TEXT,
  "username" TEXT,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TaskAssignee" ("id", "taskId", "normalizedKey", "telegramId", "username", "displayName")
SELECT
  CONCAT("id", ':legacy-assignee'),
  "id",
  CASE
    WHEN "assignedTelegramId" IS NOT NULL THEN CONCAT('id:', "assignedTelegramId")
    WHEN "assignedUsername" IS NOT NULL THEN CONCAT('username:', LOWER("assignedUsername"))
    ELSE CONCAT('name:', LOWER("assignedDisplayName"))
  END,
  "assignedTelegramId",
  "assignedUsername",
  "assignedDisplayName"
FROM "Task"
WHERE "assignedTelegramId" IS NOT NULL
   OR "assignedUsername" IS NOT NULL
   OR "assignedDisplayName" IS NOT NULL;

CREATE UNIQUE INDEX "TaskAssignee_taskId_normalizedKey_key" ON "TaskAssignee"("taskId", "normalizedKey");
CREATE INDEX "TaskAssignee_telegramId_idx" ON "TaskAssignee"("telegramId");
CREATE INDEX "TaskAssignee_username_idx" ON "TaskAssignee"("username");

ALTER TABLE "TaskAssignee"
ADD CONSTRAINT "TaskAssignee_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
