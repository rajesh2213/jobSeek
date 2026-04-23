ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'processing';

CREATE INDEX IF NOT EXISTS "Job_status_idx"
ON "Job"("status");
