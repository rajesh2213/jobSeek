-- Single sort key aligned with UI freshness: COALESCE(effectivePostedAt, createdAt).
-- Fixes partition bug where ORDER BY effectivePostedAt NULLS LAST placed ALL non-null timestamps
-- above ALL nulls, while the UI falls back to createdAt for null effectivePostedAt (fresh jobs sank below stale rows).
ALTER TABLE "Job" ADD COLUMN "listingFreshnessAt" TIMESTAMP(3) NOT NULL
GENERATED ALWAYS AS (COALESCE("effectivePostedAt", "createdAt")) STORED;

CREATE INDEX "idx_jobs_listing_freshness_at" ON "Job" ("listingFreshnessAt" DESC);
