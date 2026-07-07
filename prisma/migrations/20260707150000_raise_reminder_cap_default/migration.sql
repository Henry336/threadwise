ALTER TABLE "UserSettings" ALTER COLUMN "maxRemindersPerDay" SET DEFAULT 200;

UPDATE "UserSettings"
SET "maxRemindersPerDay" = 200
WHERE "maxRemindersPerDay" = 5;
