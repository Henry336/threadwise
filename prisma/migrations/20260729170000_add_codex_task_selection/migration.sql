CREATE TABLE "CodexThread" (
  "id" TEXT NOT NULL,
  "ownerTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "preview" TEXT,
  "source" TEXT NOT NULL,
  "status" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "threadCreatedAt" TIMESTAMP(3),
  "threadUpdatedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodexThread_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CodexChatState" ADD COLUMN "activeThreadId" TEXT;
ALTER TABLE "CodexChatState" ADD COLUMN "pendingThreadJobId" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "threadTitle" TEXT;
ALTER TABLE "CodexJob" ADD COLUMN "newThread" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "CodexThread_ownerTelegramId_telegramChatId_projectId_enabled_threadUpdatedAt_idx"
ON "CodexThread"("ownerTelegramId", "telegramChatId", "projectId", "enabled", "threadUpdatedAt");
CREATE INDEX "CodexThread_ownerTelegramId_telegramChatId_title_idx"
ON "CodexThread"("ownerTelegramId", "telegramChatId", "title");
CREATE INDEX "CodexChatState_activeThreadId_idx" ON "CodexChatState"("activeThreadId");

ALTER TABLE "CodexThread" ADD CONSTRAINT "CodexThread_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "CodexProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodexChatState" ADD CONSTRAINT "CodexChatState_activeThreadId_fkey"
FOREIGN KEY ("activeThreadId") REFERENCES "CodexThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
