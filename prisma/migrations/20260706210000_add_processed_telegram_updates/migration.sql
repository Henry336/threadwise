-- CreateTable
CREATE TABLE "ProcessedTelegramUpdate" (
    "id" TEXT NOT NULL,
    "updateId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedTelegramUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedTelegramUpdate_updateId_key" ON "ProcessedTelegramUpdate"("updateId");

-- CreateIndex
CREATE INDEX "ProcessedTelegramUpdate_createdAt_idx" ON "ProcessedTelegramUpdate"("createdAt");
