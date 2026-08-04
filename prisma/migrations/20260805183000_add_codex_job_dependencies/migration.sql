ALTER TYPE "CodexJobStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';

ALTER TABLE "CodexJob"
ADD COLUMN "queueKey" TEXT,
ADD COLUMN "queueOrdinal" INTEGER,
ADD COLUMN "dependsOnJobId" TEXT;

UPDATE "CodexJob"
SET "queueKey" = COALESCE("threadId", "id")
WHERE "queueKey" IS NULL;

ALTER TABLE "CodexJob"
ALTER COLUMN "queueKey" SET NOT NULL;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "queueKey" ORDER BY "createdAt", "id"
  )::INTEGER AS ordinal
  FROM "CodexJob"
)
UPDATE "CodexJob" AS job
SET "queueOrdinal" = ordered.ordinal
FROM ordered
WHERE job."id" = ordered."id";

ALTER TABLE "CodexJob"
ALTER COLUMN "queueOrdinal" SET NOT NULL;

ALTER TABLE "CodexJob"
ADD CONSTRAINT "CodexJob_dependsOnJobId_fkey"
FOREIGN KEY ("dependsOnJobId") REFERENCES "CodexJob"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CodexJob_queueKey_status_createdAt_idx"
ON "CodexJob"("queueKey", "status", "createdAt");

CREATE UNIQUE INDEX "CodexJob_queueKey_queueOrdinal_key"
ON "CodexJob"("queueKey", "queueOrdinal");

CREATE INDEX "CodexJob_dependsOnJobId_idx"
ON "CodexJob"("dependsOnJobId");
