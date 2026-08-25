ALTER TABLE "StudyWorkspace"
  ADD COLUMN "lastReminderCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastReminderStatus" TEXT,
  ADD COLUMN "lastReminderSummary" JSONB;

ALTER TABLE "StudyModule"
  ADD COLUMN "canvasTermId" TEXT,
  ADD COLUMN "canvasTermName" TEXT,
  ADD COLUMN "canvasTermStartAt" TIMESTAMP(3),
  ADD COLUMN "canvasTermEndAt" TIMESTAMP(3);

ALTER TABLE "StudyScheduleBlock"
  ADD COLUMN "excludedWeeks" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
