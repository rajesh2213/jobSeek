CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_listing_order_fast
ON "Job" ("postedAt" DESC, "createdAt" DESC)
WHERE status = 'ready'
AND "canonicalJobId" IS NULL
AND "isActive" = true;
