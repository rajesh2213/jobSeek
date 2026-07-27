-- OG-1.3: persist redirect targets before hard-deleting Job rows so /job/{id} can 301.
CREATE TABLE IF NOT EXISTS "JobRedirect" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "companySlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobRedirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JobRedirect_jobId_key" ON "JobRedirect"("jobId");
CREATE INDEX IF NOT EXISTS "JobRedirect_createdAt_idx" ON "JobRedirect"("createdAt");
