ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "Job_contentHash_idx"
ON "Job"("contentHash");
