CREATE TABLE "PendingItemEdit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKind" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemPublicId" TEXT NOT NULL,
  "previousTitle" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PendingItemEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingItemEdit_userId_expiresAt_idx" ON "PendingItemEdit"("userId", "expiresAt");

ALTER TABLE "PendingItemEdit" ADD CONSTRAINT "PendingItemEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
