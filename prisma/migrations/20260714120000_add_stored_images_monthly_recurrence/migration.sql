ALTER TYPE "RecurrenceRule" ADD VALUE 'MONTHLY';

ALTER TABLE "Task" ADD COLUMN "recurrenceDayOfMonth" INTEGER;

CREATE TABLE "PendingImageUpload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramFileId" TEXT NOT NULL,
  "telegramUniqueId" TEXT,
  "mediaKind" TEXT NOT NULL,
  "mimeType" TEXT,
  "fileName" TEXT,
  "caption" TEXT,
  "fileSize" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingImageUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoredImage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "telegramFileId" TEXT NOT NULL,
  "telegramUniqueId" TEXT,
  "mediaKind" TEXT NOT NULL,
  "mimeType" TEXT,
  "fileName" TEXT,
  "caption" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoredImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingImageUpload_userId_expiresAt_idx" ON "PendingImageUpload"("userId", "expiresAt");
CREATE UNIQUE INDEX "StoredImage_userId_publicId_key" ON "StoredImage"("userId", "publicId");
CREATE INDEX "StoredImage_userId_createdAt_idx" ON "StoredImage"("userId", "createdAt");
CREATE INDEX "StoredImage_userId_telegramUniqueId_idx" ON "StoredImage"("userId", "telegramUniqueId");

ALTER TABLE "PendingImageUpload" ADD CONSTRAINT "PendingImageUpload_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoredImage" ADD CONSTRAINT "StoredImage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
