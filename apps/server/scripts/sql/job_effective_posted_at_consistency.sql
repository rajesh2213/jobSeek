-- Read-only: count rows where derived column drifted from COALESCE(postedAt, createdAt).
SELECT COUNT(*) AS mismatch_count
FROM "Job"
WHERE "effectivePostedAt" IS DISTINCT FROM COALESCE("postedAt", "createdAt");

-- Manual sanity sample (same ordering keys as discovery "latest").
SELECT id, "postedAt", "createdAt", "effectivePostedAt"
FROM "Job"
ORDER BY "effectivePostedAt" DESC NULLS LAST, "createdAt" DESC
LIMIT 20;
