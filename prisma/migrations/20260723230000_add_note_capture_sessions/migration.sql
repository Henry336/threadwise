CREATE TABLE "NoteCaptureSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NoteCaptureSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoteCaptureSegment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoteCaptureSegment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PendingCapture" ADD COLUMN "actorTelegramId" TEXT;

CREATE UNIQUE INDEX "NoteCaptureSession_userId_key" ON "NoteCaptureSession"("userId");
CREATE INDEX "NoteCaptureSession_expiresAt_idx" ON "NoteCaptureSession"("expiresAt");
CREATE UNIQUE INDEX "NoteCaptureSegment_sessionId_telegramMessageId_key" ON "NoteCaptureSegment"("sessionId", "telegramMessageId");
CREATE INDEX "NoteCaptureSegment_sessionId_telegramMessageId_idx" ON "NoteCaptureSegment"("sessionId", "telegramMessageId");

ALTER TABLE "NoteCaptureSession" ADD CONSTRAINT "NoteCaptureSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoteCaptureSegment" ADD CONSTRAINT "NoteCaptureSegment_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "NoteCaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
