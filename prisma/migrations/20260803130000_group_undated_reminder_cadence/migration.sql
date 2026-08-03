-- Track consecutive undated group nudges independently from lifetime reminder history.
ALTER TABLE "Task"
ADD COLUMN "undatedNudgeCount" INTEGER NOT NULL DEFAULT 0;

-- Groups previously inherited the personal three-hour default. Move untouched
-- group defaults to the quieter six-hour cadence without changing personal users.
UPDATE "UserSettings" AS settings
SET "reminderIntervalMinutes" = 360
FROM "User" AS owner
WHERE settings."userId" = owner."id"
  AND owner."telegramId" LIKE 'chat:%'
  AND settings."reminderIntervalMinutes" = 180;

-- Existing open undated group tasks should follow the new default immediately.
UPDATE "Task" AS task
SET "reminderIntervalMinutes" = 360,
    "nextReminderAt" = NOW() + INTERVAL '6 hours'
FROM "User" AS owner, "UserSettings" AS settings
WHERE task."userId" = owner."id"
  AND settings."userId" = owner."id"
  AND owner."telegramId" LIKE 'chat:%'
  AND task."status" = 'OPEN'
  AND task."archivedAt" IS NULL
  AND task."dueAt" IS NULL
  AND task."reminderIntervalMinutes" = 180
  AND settings."reminderIntervalMinutes" = 360;
