ALTER TABLE "UserSettings" ADD COLUMN "dueNudgeMinutes" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "PendingItemEdit" ADD COLUMN "editField" TEXT NOT NULL DEFAULT 'title';
ALTER TABLE "PendingItemEdit" ADD COLUMN "previousValue" TEXT;

CREATE TABLE "PendingSearch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "kinds" TEXT[],
  "label" TEXT,
  "includeDone" BOOLEAN NOT NULL DEFAULT false,
  "doneOnly" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PendingSearch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingSearch_userId_expiresAt_idx" ON "PendingSearch"("userId", "expiresAt");

ALTER TABLE "PendingSearch" ADD CONSTRAINT "PendingSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
