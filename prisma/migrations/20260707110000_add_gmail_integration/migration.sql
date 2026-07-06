-- CreateTable
CREATE TABLE "PendingGmailOAuth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingGmailOAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailEmail" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scanHourLocal" INTEGER NOT NULL DEFAULT 8,
    "summaryChatId" TEXT,
    "lastScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailMessageSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "from" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "importanceReason" TEXT,
    "suggestedAction" TEXT,
    "receivedAt" TIMESTAMP(3),
    "reminderTaskId" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailMessageSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingGmailOAuth_state_key" ON "PendingGmailOAuth"("state");

-- CreateIndex
CREATE INDEX "PendingGmailOAuth_userId_expiresAt_idx" ON "PendingGmailOAuth"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_userId_key" ON "GmailConnection"("userId");

-- CreateIndex
CREATE INDEX "GmailConnection_scanEnabled_lastScanAt_idx" ON "GmailConnection"("scanEnabled", "lastScanAt");

-- CreateIndex
CREATE UNIQUE INDEX "GmailMessageSummary_userId_gmailMessageId_key" ON "GmailMessageSummary"("userId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "GmailMessageSummary_userId_scannedAt_idx" ON "GmailMessageSummary"("userId", "scannedAt");

-- CreateIndex
CREATE INDEX "GmailMessageSummary_userId_important_idx" ON "GmailMessageSummary"("userId", "important");

-- AddForeignKey
ALTER TABLE "PendingGmailOAuth" ADD CONSTRAINT "PendingGmailOAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailMessageSummary" ADD CONSTRAINT "GmailMessageSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
