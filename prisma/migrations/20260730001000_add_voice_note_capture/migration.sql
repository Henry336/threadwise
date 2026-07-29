CREATE TYPE "VoiceCleanupMode" AS ENUM ('VERBATIM', 'LIGHT');
CREATE TYPE "VoiceTranscriptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNDONE');

ALTER TABLE "UserSettings"
  ADD COLUMN "voiceCleanupMode" "VoiceCleanupMode" NOT NULL DEFAULT 'LIGHT',
  ADD COLUMN "voiceTranscriptionModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini-transcribe',
  ADD COLUMN "voiceLanguageHint" TEXT,
  ADD COLUMN "voiceAutoTranscribeAudio" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "VoiceTranscriptionJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requesterTelegramId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "telegramMessageId" INTEGER NOT NULL,
  "telegramFileId" TEXT NOT NULL,
  "telegramFileUniqueId" TEXT,
  "sourceKind" TEXT NOT NULL,
  "durationSeconds" INTEGER,
  "mimeType" TEXT,
  "fileName" TEXT,
  "fileSize" INTEGER,
  "cleanupMode" "VoiceCleanupMode" NOT NULL,
  "transcriptionModel" TEXT NOT NULL,
  "languageHint" TEXT,
  "status" "VoiceTranscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "processorId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "rawTranscript" TEXT,
  "cleanedText" TEXT,
  "cleanedNoteId" TEXT,
  "cleanupError" TEXT,
  "error" TEXT,
  "acknowledgementMessageId" INTEGER,
  "telegramResultMessageId" INTEGER,
  "deliveredAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "transcribedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "undoneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoiceTranscriptionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceTranscriptionJob_telegramChatId_telegramMessageId_key"
  ON "VoiceTranscriptionJob"("telegramChatId", "telegramMessageId");
CREATE INDEX "VoiceTranscriptionJob_status_leaseExpiresAt_createdAt_idx"
  ON "VoiceTranscriptionJob"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "VoiceTranscriptionJob_userId_telegramChatId_createdAt_idx"
  ON "VoiceTranscriptionJob"("userId", "telegramChatId", "createdAt");
CREATE INDEX "VoiceTranscriptionJob_telegramFileUniqueId_idx"
  ON "VoiceTranscriptionJob"("telegramFileUniqueId");

ALTER TABLE "VoiceTranscriptionJob"
  ADD CONSTRAINT "VoiceTranscriptionJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceTranscriptionJob"
  ADD CONSTRAINT "VoiceTranscriptionJob_cleanedNoteId_fkey"
  FOREIGN KEY ("cleanedNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
