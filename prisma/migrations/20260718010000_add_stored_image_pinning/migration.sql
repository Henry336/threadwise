ALTER TABLE "StoredImage"
ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "StoredImage_userId_pinnedAt_idx"
ON "StoredImage"("userId", "pinnedAt");
