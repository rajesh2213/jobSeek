ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "resumeFileKey" TEXT,
ADD COLUMN IF NOT EXISTS "resumeFileSize" INTEGER;

CREATE INDEX IF NOT EXISTS "Job_expiresAt_idx"
ON "Job"("expiresAt");

CREATE INDEX IF NOT EXISTS "Job_isActive_expiresAt_idx"
ON "Job"("isActive", "expiresAt");

CREATE INDEX IF NOT EXISTS "Job_lastSeenAt_idx"
ON "Job"("lastSeenAt");

CREATE INDEX IF NOT EXISTS "Job_canonicalJobId_lastSeenAt_idx"
ON "Job"("canonicalJobId", "lastSeenAt");
