ALTER TABLE "Idea" ADD COLUMN "archivedReason" TEXT;

ALTER TABLE "Task" ADD COLUMN "archivedReason" TEXT;

ALTER TABLE "Note" ADD COLUMN "archivedReason" TEXT;
ALTER TABLE "Note" ADD COLUMN "mergedIntoNoteId" TEXT;

ALTER TABLE "Reflection" ADD COLUMN "archivedReason" TEXT;

CREATE TABLE "PendingNoteMerge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceNoteIds" TEXT[],
  "preview" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingNoteMerge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Note_userId_mergedIntoNoteId_idx" ON "Note"("userId", "mergedIntoNoteId");
CREATE INDEX "PendingNoteMerge_userId_expiresAt_idx" ON "PendingNoteMerge"("userId", "expiresAt");

ALTER TABLE "Note" ADD CONSTRAINT "Note_mergedIntoNoteId_fkey" FOREIGN KEY ("mergedIntoNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PendingNoteMerge" ADD CONSTRAINT "PendingNoteMerge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
