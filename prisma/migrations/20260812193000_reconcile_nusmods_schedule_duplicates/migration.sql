-- The first NUSMods importer release treated pre-existing class timetable blocks
-- as unrelated manual data. Preserve the imported block and hide only exact,
-- class-like local equivalents. Deliberate study/protected blocks are untouched.
UPDATE "StudyScheduleBlock" AS local
SET "active" = FALSE,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "StudyScheduleBlock" AS imported
WHERE imported."workspaceId" = local."workspaceId"
  AND imported."moduleId" = local."moduleId"
  AND imported."dayOfWeek" = local."dayOfWeek"
  AND imported."startTime" = local."startTime"
  AND imported."endTime" = local."endTime"
  AND imported."source" = 'NUSMODS'
  AND imported."active" = TRUE
  AND local."source" IN ('MANUAL', 'SYSTEM_SEED')
  AND local."active" = TRUE
  AND LOWER(local."blockType") IN (
    'class', 'design lecture', 'ensemble teaching', 'lab', 'laboratory',
    'lecture', 'lesson', 'packaged lecture', 'packaged tutorial',
    'recitation', 'sectional teaching', 'seminar', 'timetable', 'tutorial',
    'tutorial type 2', 'tutorial type 3', 'workshop'
  );
