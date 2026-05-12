-- Partial composite index supporting the new "latest" sort introduced by the
-- freshness-integrity overhaul. The order matches sqlForCanonicalListingIds
-- for sort === 'latest':
--
--   ORDER BY j."postedAt" DESC NULLS LAST,
--            j."listingFreshnessAt" DESC,
--            j."createdAt"   DESC,
--            j.id            ASC
--
-- WHY THIS INDEX IS NEEDED
-- ------------------------
-- Existing partial indexes either default to "DESC NULLS FIRST" for postedAt
-- (idx_jobs_posted_ready_canonical_null,
--  idx_jobs_posted_created_ready_canonical_null) or have a narrower predicate
-- (idx_jobs_listing_order_fast excludes generic roles). Production EXPLAIN on
-- 95k active canonical rows showed the new ORDER BY would fall back to a
-- parallel seq scan + top-N heapsort (~95 ms / 15k buffers) instead of the
-- legacy plan's incremental sort over idx_jobs_listing_freshness_at (~1 ms /
-- 59 buffers). This new partial index restores the index-scan path with
-- pre-sorted output.
--
-- PREDICATE
-- ---------
-- The predicate exactly mirrors the WHERE clause in sqlForCanonicalListingIds:
--   "canonicalJobId" IS NULL
--   AND "isActive" = true
--   AND ("status" = 'ready' OR "status" IS NULL)
-- (No role filter — the latest-listing query does not exclude roles.)
--
-- COLUMN ORDER
-- ------------
-- (postedAt DESC NULLS LAST, listingFreshnessAt DESC, createdAt DESC, id)
-- gives the planner a complete pre-sorted stream for the LIMIT N case.
-- "id" is included so cursor pagination tiebreaker is also covered.
--
-- ZERO-DOWNTIME / OPERATIONAL NOTES
-- ---------------------------------
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; this migration
-- must be a single statement so Prisma Migrate executes it outside a
-- transaction on PostgreSQL. Build time on Supabase for ~95k matching rows is
-- expected to be a few seconds; impact on writes is minimal (no exclusive
-- lock; brief ShareUpdateExclusiveLock during build only).
--
-- Rollback (run manually in a direct session; cannot run inside a transaction
-- block):
--   DROP INDEX CONCURRENTLY IF EXISTS "idx_jobs_canonical_latest_v2";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jobs_canonical_latest_v2"
ON "Job" ("postedAt" DESC NULLS LAST, "listingFreshnessAt" DESC, "createdAt" DESC, id)
WHERE "canonicalJobId" IS NULL
  AND "isActive" = true
  AND ("status" = 'ready' OR "status" IS NULL);
