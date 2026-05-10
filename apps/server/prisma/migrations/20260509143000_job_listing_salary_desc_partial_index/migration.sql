-- Partial composite index for discovery id-list when sort=salary_desc
-- (sqlForCanonicalListingIds / findManyCanonicalFiltered).
--
-- Aligns with ORDER BY: "salaryMin" DESC NULLS LAST, "createdAt" DESC
-- and the static listing predicates mirrored from idx_jobs_effective_listing_fast.
-- Query-time filters still apply for expiresAt and any dynamic discovery filters.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; this migration must be
-- a single statement so Prisma Migrate executes it outside a transaction on PostgreSQL.
--
-- Rollback (run manually in a direct session; cannot run inside a transaction block):
--   DROP INDEX CONCURRENTLY IF EXISTS "idx_jobs_listing_salary_desc_fast";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jobs_listing_salary_desc_fast"
ON "Job" ("salaryMin" DESC NULLS LAST, "createdAt" DESC)
WHERE (status = 'ready' OR status IS NULL)
AND "canonicalJobId" IS NULL
AND "isActive" = true
AND role NOT IN (
  'job-role',
  'careers',
  'jobs',
  'job',
  'all',
  'benefits',
  'open-roles',
  'career-search',
  'searchcareer',
  'career-areas'
);
