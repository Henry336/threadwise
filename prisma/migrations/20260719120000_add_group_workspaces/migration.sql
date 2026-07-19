CREATE TYPE "GroupMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "GroupMemberStatus" AS ENUM ('ACTIVE', 'LEFT', 'KICKED');

CREATE TABLE "GroupWorkspace" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "username" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "botStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupMembership" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "role" "GroupMemberRole" NOT NULL DEFAULT 'MEMBER',
  "status" "GroupMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupWorkspace_ownerUserId_key" ON "GroupWorkspace"("ownerUserId");
CREATE UNIQUE INDEX "GroupWorkspace_telegramChatId_key" ON "GroupWorkspace"("telegramChatId");
CREATE INDEX "GroupWorkspace_isActive_updatedAt_idx" ON "GroupWorkspace"("isActive", "updatedAt");
CREATE UNIQUE INDEX "GroupMembership_workspaceId_telegramId_key" ON "GroupMembership"("workspaceId", "telegramId");
CREATE INDEX "GroupMembership_telegramId_status_idx" ON "GroupMembership"("telegramId", "status");
CREATE INDEX "GroupMembership_workspaceId_role_idx" ON "GroupMembership"("workspaceId", "role");

ALTER TABLE "GroupWorkspace"
ADD CONSTRAINT "GroupWorkspace_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupMembership"
ADD CONSTRAINT "GroupMembership_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "GroupWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
