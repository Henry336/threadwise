ALTER TABLE "Task"
ADD COLUMN "calendarEventId" TEXT,
ADD COLUMN "calendarEventUrl" TEXT,
ADD COLUMN "calendarSyncedAt" TIMESTAMP(3);

CREATE TABLE "PendingCalendarOAuth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingCalendarOAuth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calendarEmail" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingCalendarOAuth_state_key" ON "PendingCalendarOAuth"("state");
CREATE INDEX "PendingCalendarOAuth_userId_expiresAt_idx" ON "PendingCalendarOAuth"("userId", "expiresAt");
CREATE UNIQUE INDEX "CalendarConnection_userId_key" ON "CalendarConnection"("userId");

ALTER TABLE "PendingCalendarOAuth"
ADD CONSTRAINT "PendingCalendarOAuth_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarConnection"
ADD CONSTRAINT "CalendarConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
