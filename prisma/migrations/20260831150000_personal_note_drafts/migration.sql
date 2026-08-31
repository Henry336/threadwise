CREATE TABLE "PersonalNoteDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftKey" TEXT NOT NULL,
    "noteId" TEXT,
    "noteUpdatedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalNoteDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalNoteDraft_userId_draftKey_key" ON "PersonalNoteDraft"("userId", "draftKey");
CREATE INDEX "PersonalNoteDraft_userId_expiresAt_idx" ON "PersonalNoteDraft"("userId", "expiresAt");
CREATE INDEX "PersonalNoteDraft_noteId_idx" ON "PersonalNoteDraft"("noteId");

ALTER TABLE "PersonalNoteDraft" ADD CONSTRAINT "PersonalNoteDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalNoteDraft" ADD CONSTRAINT "PersonalNoteDraft_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
