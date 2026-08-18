CREATE TABLE "DashboardRequestReplay" (
    "fingerprint" TEXT NOT NULL,
    "principalFingerprint" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardRequestReplay_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "DashboardRequestReplay_expiresAt_idx" ON "DashboardRequestReplay"("expiresAt");
