-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('RAW', 'CLARIFIED', 'SELECTED', 'PROTOTYPING', 'BUILT', 'PAUSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReminderMode" AS ENUM ('INDIVIDUAL', 'DIGEST');

-- CreateEnum
CREATE TYPE "CaptureKind" AS ENUM ('IDEA', 'TASK', 'REFLECTION', 'NOISE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reminderIntervalMinutes" INTEGER NOT NULL DEFAULT 180,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
    "quietHoursStart" TEXT DEFAULT '22:00',
    "quietHoursEnd" TEXT DEFAULT '08:00',
    "maxRemindersPerDay" INTEGER NOT NULL DEFAULT 5,
    "reminderMode" "ReminderMode" NOT NULL DEFAULT 'INDIVIDUAL',
    "reminderChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "problem" TEXT,
    "targetUser" TEXT,
    "type" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'RAW',
    "tags" TEXT[],
    "sourceText" TEXT NOT NULL,
    "embedding" JSONB,
    "scores" JSONB,
    "marketNotes" TEXT,
    "dos" TEXT[],
    "donts" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "sourceText" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "timezone" TEXT,
    "reminderIntervalMinutes" INTEGER,
    "nextReminderAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastRemindedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "embedding" JSONB,
    "calendarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reflection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "balancedView" TEXT NOT NULL,
    "immediateAction" TEXT NOT NULL,
    "keepInMind" TEXT NOT NULL,
    "risks" TEXT[],
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reflection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingCapture" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CaptureKind" NOT NULL,
    "sourceText" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "Idea_userId_createdAt_idx" ON "Idea"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Idea_userId_publicId_key" ON "Idea"("userId", "publicId");

-- CreateIndex
CREATE INDEX "Task_status_nextReminderAt_idx" ON "Task"("status", "nextReminderAt");

-- CreateIndex
CREATE INDEX "Task_userId_createdAt_idx" ON "Task"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_userId_publicId_key" ON "Task"("userId", "publicId");

-- CreateIndex
CREATE INDEX "Reflection_userId_createdAt_idx" ON "Reflection"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reflection_userId_publicId_key" ON "Reflection"("userId", "publicId");

-- CreateIndex
CREATE INDEX "PendingCapture_userId_expiresAt_idx" ON "PendingCapture"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "ReminderDelivery_userId_sentAt_idx" ON "ReminderDelivery"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "ReminderDelivery_taskId_sentAt_idx" ON "ReminderDelivery"("taskId", "sentAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reflection" ADD CONSTRAINT "Reflection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingCapture" ADD CONSTRAINT "PendingCapture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
