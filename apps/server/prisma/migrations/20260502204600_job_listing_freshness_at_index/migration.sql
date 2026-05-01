-- Index split out so generated-column DDL can finish before index build (reduces single-statement pressure).
SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE INDEX IF NOT EXISTS "idx_jobs_listing_freshness_at" ON "Job" ("listingFreshnessAt" DESC);
