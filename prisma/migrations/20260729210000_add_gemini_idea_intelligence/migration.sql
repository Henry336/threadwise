ALTER TABLE "CodexChatState" ADD COLUMN "workerId" TEXT;
ALTER TABLE "CodexChatState" ADD COLUMN "workerLastSeenAt" TIMESTAMP(3);
ALTER TABLE "CodexChatState" ADD COLUMN "geminiAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CodexChatState" ADD COLUMN "geminiVersion" TEXT;
ALTER TABLE "CodexChatState" ADD COLUMN "geminiModel" TEXT;
ALTER TABLE "CodexChatState" ADD COLUMN "workerLastError" TEXT;

CREATE TABLE "GeminiIdeaJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ideaId" TEXT NOT NULL,
  "requesterTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "telegramRequestMessageId" INTEGER,
  "action" TEXT NOT NULL,
  "status" "CodexJobStatus" NOT NULL DEFAULT 'PENDING',
  "prompt" TEXT NOT NULL,
  "model" TEXT,
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
  CONSTRAINT "GeminiIdeaJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeminiIdeaJob_status_leaseExpiresAt_createdAt_idx"
ON "GeminiIdeaJob"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "GeminiIdeaJob_userId_ideaId_createdAt_idx"
ON "GeminiIdeaJob"("userId", "ideaId", "createdAt");
CREATE INDEX "GeminiIdeaJob_requesterTelegramId_telegramChatId_createdAt_idx"
ON "GeminiIdeaJob"("requesterTelegramId", "telegramChatId", "createdAt");

ALTER TABLE "GeminiIdeaJob" ADD CONSTRAINT "GeminiIdeaJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeminiIdeaJob" ADD CONSTRAINT "GeminiIdeaJob_ideaId_fkey"
FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
