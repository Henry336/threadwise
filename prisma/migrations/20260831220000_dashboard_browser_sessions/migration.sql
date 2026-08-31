CREATE TABLE "DashboardBrowserSession" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardBrowserSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DashboardBrowserSession_ownerUserId_revokedAt_expiresAt_idx"
    ON "DashboardBrowserSession"("ownerUserId", "revokedAt", "expiresAt");

CREATE INDEX "DashboardBrowserSession_expiresAt_idx"
    ON "DashboardBrowserSession"("expiresAt");

ALTER TABLE "DashboardBrowserSession"
    ADD CONSTRAINT "DashboardBrowserSession_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
