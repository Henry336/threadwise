ALTER TABLE "PendingCapture"
ADD COLUMN "telegramChatId" TEXT,
ADD COLUMN "telegramPromptMessageId" INTEGER;

CREATE INDEX "PendingCapture_reminder_reply_idx"
ON "PendingCapture"("userId", "actorTelegramId", "telegramChatId", "telegramPromptMessageId");
