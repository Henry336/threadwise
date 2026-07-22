ALTER TABLE "UserSettings"
ADD COLUMN "calendarAutoSync" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "excelAutoSync" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PendingCalendarOAuth"
ADD COLUMN "taskId" TEXT,
ADD COLUMN "enableAutoSync" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "returnTo" TEXT;

ALTER TABLE "PendingMicrosoftOAuth"
ADD COLUMN "enableAutoSync" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "returnTo" TEXT;
