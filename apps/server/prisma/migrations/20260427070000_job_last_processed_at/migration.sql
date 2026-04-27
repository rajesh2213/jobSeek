ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "lastProcessedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Job_lastProcessedAt_idx"
ON "Job"("lastProcessedAt");
