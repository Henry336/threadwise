CREATE TABLE "PendingBulkAction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "itemKind" TEXT NOT NULL,
  "itemIds" TEXT[] NOT NULL,
  "requestedByTelegramId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingBulkAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingBulkAction_userId_expiresAt_idx" ON "PendingBulkAction"("userId", "expiresAt");

ALTER TABLE "PendingBulkAction"
ADD CONSTRAINT "PendingBulkAction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
