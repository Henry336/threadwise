CREATE TABLE "SharedRateLimitBucket" (
    "bucketKey" TEXT NOT NULL,
    "principalFingerprint" TEXT NOT NULL,
    "routeClass" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedRateLimitBucket_pkey" PRIMARY KEY ("bucketKey")
);

CREATE INDEX "SharedRateLimitBucket_expiresAt_idx" ON "SharedRateLimitBucket"("expiresAt");
CREATE INDEX "SharedRateLimitBucket_principalFingerprint_routeClass_windowStartedAt_idx"
    ON "SharedRateLimitBucket"("principalFingerprint", "routeClass", "windowStartedAt");
