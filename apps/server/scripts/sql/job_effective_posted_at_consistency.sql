-- Read-only: count rows where derived column drifted from COALESCE(postedAt, createdAt).
SELECT COUNT(*) AS mismatch_count
FROM "Job"
WHERE "effectivePostedAt" IS DISTINCT FROM COALESCE("postedAt", "createdAt");

-- Manual sanity sample (same ordering keys as discovery "latest").
SELECT id, "postedAt", "createdAt", "effectivePostedAt", "listingFreshnessAt"
FROM "Job"
ORDER BY "listingFreshnessAt" DESC, "createdAt" DESC
LIMIT 20;
