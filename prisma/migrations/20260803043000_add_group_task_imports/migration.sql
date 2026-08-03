-- CreateEnum
CREATE TYPE "TaskImportStatus" AS ENUM ('PENDING', 'IMPORTING', 'PARTIAL', 'IMPORTED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaskImportItemStatus" AS ENUM ('READY', 'IMPORTED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "teamOwnerLabel" TEXT;

-- AlterTable
ALTER TABLE "GroupWorkspace" ADD COLUMN "threadwiseTopicId" INTEGER;

-- Imported rows carry a durable idempotency key so a recovered or retried import
-- cannot create the same task twice.
ALTER TABLE "Task" ADD COLUMN "importSourceItemId" TEXT;

-- CreateTable
CREATE TABLE "PendingTaskImport" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedByTelegramId" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "status" "TaskImportStatus" NOT NULL DEFAULT 'PENDING',
    "telegramMessageId" INTEGER,
    "telegramThreadId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingTaskImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingTaskImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "assignees" JSONB NOT NULL,
    "teamOwnerLabel" TEXT,
    "initialStatus" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "included" BOOLEAN NOT NULL DEFAULT true,
    "warnings" TEXT[] NOT NULL,
    "status" "TaskImportItemStatus" NOT NULL DEFAULT 'READY',
    "errorMessage" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingTaskImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingTaskImport_workspaceId_status_createdAt_idx" ON "PendingTaskImport"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingTaskImport_requestedByTelegramId_status_expiresAt_idx" ON "PendingTaskImport"("requestedByTelegramId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingTaskImportItem_taskId_key" ON "PendingTaskImportItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingTaskImportItem_importId_position_key" ON "PendingTaskImportItem"("importId", "position");

-- CreateIndex
CREATE INDEX "PendingTaskImportItem_importId_included_status_idx" ON "PendingTaskImportItem"("importId", "included", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_importSourceItemId_key" ON "Task"("importSourceItemId");

-- AddForeignKey
ALTER TABLE "PendingTaskImport" ADD CONSTRAINT "PendingTaskImport_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTaskImport" ADD CONSTRAINT "PendingTaskImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "GroupWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTaskImportItem" ADD CONSTRAINT "PendingTaskImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PendingTaskImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTaskImportItem" ADD CONSTRAINT "PendingTaskImportItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
