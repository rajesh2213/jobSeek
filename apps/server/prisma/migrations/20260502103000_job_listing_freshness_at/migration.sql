-- Single sort key aligned with UI freshness: COALESCE(effectivePostedAt, createdAt).
-- Fixes partition bug where ORDER BY effectivePostedAt NULLS LAST placed ALL non-null timestamps
-- above ALL nulls, while the UI falls back to createdAt for null effectivePostedAt.
--
-- Large Job tables (Supabase pooler): disable statement timeout so DDL is not canceled mid-flight.
SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE "Job" ADD COLUMN "listingFreshnessAt" TIMESTAMP(3) NOT NULL
GENERATED ALWAYS AS (COALESCE("effectivePostedAt", "createdAt")) STORED;
