-- Preserve user archive choices separately from Canvas source state.
ALTER TABLE "StudyModule" ADD COLUMN "userArchivedAt" TIMESTAMP(3);
ALTER TABLE "StudyCanvasAssignment" ADD COLUMN "userArchivedAt" TIMESTAMP(3);

-- Existing inactive Canvas modules and skipped Canvas assignments were already
-- user-visible archives. Mark them so future syncs cannot resurrect them.
UPDATE "StudyModule"
SET "userArchivedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "active" = false AND "canvasCourseId" IS NOT NULL;

UPDATE "StudyCanvasAssignment" AS assignment
SET "userArchivedAt" = COALESCE(item."updatedAt", CURRENT_TIMESTAMP)
FROM "StudyItem" AS item
WHERE assignment."itemId" = item."id" AND item."status" = 'SKIPPED';
