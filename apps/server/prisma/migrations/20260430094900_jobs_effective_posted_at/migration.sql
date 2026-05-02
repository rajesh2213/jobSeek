ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "effectivePostedAt" TIMESTAMP;

UPDATE "Job"
SET "effectivePostedAt" = COALESCE("postedAt", "createdAt")
WHERE "effectivePostedAt" IS NULL;

-- Non-concurrent indexes: Prisma runs migrations in a transaction;
-- PostgreSQL forbids CREATE INDEX CONCURRENTLY inside a transaction block.
CREATE INDEX IF NOT EXISTS idx_jobs_effective_posted
ON "Job" ("effectivePostedAt" DESC)
WHERE status = 'ready'
AND "canonicalJobId" IS NULL
AND "isActive" = true;

-- Mirrors current listing predicate so planner can use index scan
-- with status null-compat and excluded role slugs.
CREATE INDEX IF NOT EXISTS idx_jobs_effective_listing_fast
ON "Job" ("effectivePostedAt" DESC)
WHERE (status = 'ready' OR status IS NULL)
AND "canonicalJobId" IS NULL
AND "isActive" = true
AND role NOT IN ('job-role','careers','jobs','job','all','benefits','open-roles','career-search','searchcareer','career-areas');
