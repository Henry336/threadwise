CREATE TYPE "CodexJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "CodexProject" (
  "id" TEXT NOT NULL,
  "ownerTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodexProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodexChatState" (
  "id" TEXT NOT NULL,
  "ownerTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "activeProjectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodexChatState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodexJob" (
  "id" TEXT NOT NULL,
  "ownerTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "status" "CodexJobStatus" NOT NULL DEFAULT 'PENDING',
  "prompt" TEXT NOT NULL,
  "telegramRequestMessageId" INTEGER,
  "threadId" TEXT,
  "model" TEXT,
  "reasoningEffort" TEXT,
  "replyToJobId" TEXT,
  "workerId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "finalResponse" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodexJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodexJobAttachment" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "telegramFileId" TEXT NOT NULL,
  "telegramFileUniqueId" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CodexJobAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodexJobMessage" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "messageId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CodexJobMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodexProject_ownerTelegramId_telegramChatId_alias_key"
ON "CodexProject"("ownerTelegramId", "telegramChatId", "alias");
CREATE UNIQUE INDEX "CodexProject_ownerTelegramId_telegramChatId_path_key"
ON "CodexProject"("ownerTelegramId", "telegramChatId", "path");
CREATE INDEX "CodexProject_ownerTelegramId_telegramChatId_enabled_lastSeenAt_idx"
ON "CodexProject"("ownerTelegramId", "telegramChatId", "enabled", "lastSeenAt");

CREATE UNIQUE INDEX "CodexChatState_ownerTelegramId_telegramChatId_key"
ON "CodexChatState"("ownerTelegramId", "telegramChatId");
CREATE INDEX "CodexChatState_activeProjectId_idx" ON "CodexChatState"("activeProjectId");

CREATE INDEX "CodexJob_status_leaseExpiresAt_createdAt_idx"
ON "CodexJob"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "CodexJob_ownerTelegramId_telegramChatId_createdAt_idx"
ON "CodexJob"("ownerTelegramId", "telegramChatId", "createdAt");
CREATE INDEX "CodexJob_threadId_idx" ON "CodexJob"("threadId");
CREATE INDEX "CodexJob_replyToJobId_idx" ON "CodexJob"("replyToJobId");
CREATE INDEX "CodexJobAttachment_jobId_idx" ON "CodexJobAttachment"("jobId");

CREATE UNIQUE INDEX "CodexJobMessage_chatId_messageId_key" ON "CodexJobMessage"("chatId", "messageId");
CREATE INDEX "CodexJobMessage_jobId_idx" ON "CodexJobMessage"("jobId");

ALTER TABLE "CodexChatState" ADD CONSTRAINT "CodexChatState_activeProjectId_fkey"
FOREIGN KEY ("activeProjectId") REFERENCES "CodexProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CodexJob" ADD CONSTRAINT "CodexJob_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "CodexProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CodexJob" ADD CONSTRAINT "CodexJob_replyToJobId_fkey"
FOREIGN KEY ("replyToJobId") REFERENCES "CodexJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CodexJobAttachment" ADD CONSTRAINT "CodexJobAttachment_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "CodexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodexJobMessage" ADD CONSTRAINT "CodexJobMessage_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "CodexJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
