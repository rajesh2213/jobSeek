-- Idempotent backfill: derived column must match COALESCE("postedAt", "createdAt").
-- Listing uses ORDER BY "effectivePostedAt" — stale values break UX vs UI fallbacks.
UPDATE "Job"
SET "effectivePostedAt" = COALESCE("postedAt", "createdAt")
WHERE "effectivePostedAt" IS NULL
   OR "effectivePostedAt" IS DISTINCT FROM COALESCE("postedAt", "createdAt");
