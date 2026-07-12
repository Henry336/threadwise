CREATE TABLE "PendingImageCapture" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "caption" TEXT,
    "telegramFileId" TEXT,
    "telegramUniqueId" TEXT,
    "confidence" DOUBLE PRECISION,
    "awaitingAction" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PendingImageCapture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PendingExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "merchant" TEXT,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "paymentMethod" TEXT,
    "receiptFileUniqueId" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "notes" TEXT,
    "awaitingEdit" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PendingExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "merchant" TEXT,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "paymentMethod" TEXT,
    "sourceType" TEXT NOT NULL,
    "receiptFileUniqueId" TEXT,
    "receiptContentHash" TEXT,
    "rawText" TEXT NOT NULL,
    "ocrConfidence" DOUBLE PRECISION,
    "notes" TEXT,
    "excelSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PendingMicrosoftOAuth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingMicrosoftOAuth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MicrosoftConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "microsoftEmail" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "workbookDriveItemId" TEXT,
    "workbookDriveId" TEXT,
    "workbookWebUrl" TEXT,
    "workbookName" TEXT,
    "tableName" TEXT NOT NULL DEFAULT 'Expenses',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MicrosoftConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Expense_userId_publicId_key" ON "Expense"("userId", "publicId");
CREATE UNIQUE INDEX "Expense_userId_receiptContentHash_key" ON "Expense"("userId", "receiptContentHash");
CREATE INDEX "Expense_userId_transactionAt_idx" ON "Expense"("userId", "transactionAt");
CREATE INDEX "Expense_userId_createdAt_idx" ON "Expense"("userId", "createdAt");
CREATE INDEX "Expense_userId_excelSyncedAt_idx" ON "Expense"("userId", "excelSyncedAt");
CREATE INDEX "PendingImageCapture_userId_expiresAt_idx" ON "PendingImageCapture"("userId", "expiresAt");
CREATE INDEX "PendingImageCapture_userId_awaitingAction_expiresAt_idx" ON "PendingImageCapture"("userId", "awaitingAction", "expiresAt");
CREATE INDEX "PendingExpense_userId_expiresAt_idx" ON "PendingExpense"("userId", "expiresAt");
CREATE INDEX "PendingExpense_userId_awaitingEdit_expiresAt_idx" ON "PendingExpense"("userId", "awaitingEdit", "expiresAt");
CREATE UNIQUE INDEX "PendingMicrosoftOAuth_state_key" ON "PendingMicrosoftOAuth"("state");
CREATE INDEX "PendingMicrosoftOAuth_userId_expiresAt_idx" ON "PendingMicrosoftOAuth"("userId", "expiresAt");
CREATE UNIQUE INDEX "MicrosoftConnection_userId_key" ON "MicrosoftConnection"("userId");

ALTER TABLE "PendingImageCapture" ADD CONSTRAINT "PendingImageCapture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingExpense" ADD CONSTRAINT "PendingExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingMicrosoftOAuth" ADD CONSTRAINT "PendingMicrosoftOAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicrosoftConnection" ADD CONSTRAINT "MicrosoftConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
