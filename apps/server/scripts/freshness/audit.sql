-- Freshness data-quality audit (READ-ONLY).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/server/scripts/freshness/audit.sql
-- Or via the wrapper:
--   cd apps/server && npx tsx scripts/freshness/audit.ts > docs/freshness-overhaul/02-data-quality.json
--
-- This script ONLY reads. No UPDATE / INSERT / DELETE / DDL.

\timing on
\set ON_ERROR_STOP on

\echo '=== 1. Overall posted-date coverage (canonical, active, ready) ==='
SELECT
  COUNT(*)                                                AS total,
  COUNT("postedAt")                                       AS with_posted,
  COUNT(*) FILTER (WHERE "postedAt" IS NULL)              AS without_posted,
  ROUND(100.0 * COUNT("postedAt") / NULLIF(COUNT(*), 0), 2) AS pct_with_posted
FROM "Job"
WHERE "canonicalJobId" IS NULL
  AND "isActive" = true
  AND ("status" = 'ready' OR "status" IS NULL);

\echo '=== 2. Likely-fake postedAt (postedAt within 60s of createdAt = proxy footprint) ==='
SELECT
  COUNT(*)                                                                  AS total,
  COUNT(*) FILTER (WHERE "postedAt" IS NULL)                                 AS posted_null,
  COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
  )                                                                         AS posted_eq_created_proxy,
  COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
  )                                                                         AS posted_real,
  ROUND(100.0 * COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
  ) / NULLIF(COUNT(*), 0), 2)                                               AS pct_real
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "isActive" = true;

\echo '=== 3. Coverage by source (the operational table) ==='
SELECT
  source,
  COUNT(*)                                                                  AS total,
  COUNT(*) FILTER (WHERE "postedAt" IS NULL)                                AS posted_null,
  COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
  )                                                                         AS posted_proxy,
  COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
  )                                                                         AS posted_real,
  ROUND(100.0 * COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
  ) / NULLIF(COUNT(*), 0), 2)                                               AS pct_real
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "isActive" = true
GROUP BY source
ORDER BY total DESC;

\echo '=== 4. Lead-time between postedAt and createdAt (only "real" rows) ==='
SELECT
  source,
  COUNT(*) AS rows_with_real_postedAt,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "postedAt"))/86400)::numeric, 2) AS p50_lead_days,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "postedAt"))/86400)::numeric, 2) AS p95_lead_days,
  ROUND(MAX(EXTRACT(EPOCH FROM ("createdAt" - "postedAt"))/86400)::numeric, 2)                                          AS max_lead_days
FROM "Job"
WHERE "canonicalJobId" IS NULL
  AND "postedAt" IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
GROUP BY source
ORDER BY rows_with_real_postedAt DESC;

\echo '=== 5. Greenhouse staleness leak (uses updated_at as posted) ==='
SELECT
  COUNT(*)                                                            AS greenhouse_total,
  COUNT(*) FILTER (WHERE "postedAt" >= NOW() - INTERVAL '7 days')     AS recent_by_updated_at_7d,
  COUNT(*) FILTER (WHERE "postedAt" >= NOW() - INTERVAL '24 hours')   AS recent_by_updated_at_24h,
  ROUND(100.0 * COUNT(*) FILTER (WHERE "postedAt" >= NOW() - INTERVAL '24 hours') / NULLIF(COUNT(*), 0), 2) AS pct_24h
FROM "Job"
WHERE source = 'greenhouse'
  AND "canonicalJobId" IS NULL AND "isActive" = true;

\echo '=== 6. Discovery-only freshness window distribution (where postedAt IS NULL) ==='
SELECT
  CASE
    WHEN "createdAt" >= NOW() - INTERVAL '24 hours' THEN '00_lt_24h'
    WHEN "createdAt" >= NOW() - INTERVAL '7 days'   THEN '01_lt_7d'
    WHEN "createdAt" >= NOW() - INTERVAL '30 days'  THEN '02_lt_30d'
    WHEN "createdAt" >= NOW() - INTERVAL '90 days'  THEN '03_lt_90d'
    ELSE                                                  '04_ge_90d'
  END AS bucket,
  COUNT(*) AS rows
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "isActive" = true
  AND "postedAt" IS NULL
GROUP BY 1
ORDER BY 1;

\echo '=== 7. Identical-timestamp batch fingerprints (same postedAt across many rows = suspicious) ==='
SELECT
  source,
  "postedAt",
  COUNT(*) AS rows_sharing_timestamp
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "isActive" = true
  AND "postedAt" IS NOT NULL
GROUP BY source, "postedAt"
HAVING COUNT(*) >= 25
ORDER BY rows_sharing_timestamp DESC
LIMIT 50;

\echo '=== 8. Duplicate-vs-canonical postedAt drift (sanity for aggregateCanonicalFromSources) ==='
SELECT
  COUNT(*)                                                            AS duplicates_with_posted,
  COUNT(*) FILTER (WHERE d."postedAt" < c."postedAt")                AS earlier_than_canonical,
  COUNT(*) FILTER (WHERE d."postedAt" > c."postedAt")                AS later_than_canonical,
  COUNT(*) FILTER (WHERE d."postedAt" = c."postedAt")                AS equal_to_canonical
FROM "Job" d
JOIN "Job" c ON c.id = d."canonicalJobId"
WHERE d."canonicalJobId" IS NOT NULL
  AND d."postedAt" IS NOT NULL
  AND c."postedAt" IS NOT NULL;

\echo '=== 9. Listing freshness distribution (the sort-key the user actually sees) ==='
SELECT
  CASE
    WHEN "listingFreshnessAt" >= NOW() - INTERVAL '24 hours' THEN '00_lt_24h'
    WHEN "listingFreshnessAt" >= NOW() - INTERVAL '7 days'   THEN '01_lt_7d'
    WHEN "listingFreshnessAt" >= NOW() - INTERVAL '30 days'  THEN '02_lt_30d'
    WHEN "listingFreshnessAt" >= NOW() - INTERVAL '90 days'  THEN '03_lt_90d'
    ELSE                                                          '04_ge_90d'
  END AS bucket,
  COUNT(*)                                                                            AS rows,
  COUNT(*) FILTER (WHERE "postedAt" IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60)                    AS rows_real_posted,
  COUNT(*) FILTER (WHERE "postedAt" IS NULL)                                          AS rows_discovered_only
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "isActive" = true
  AND ("status" = 'ready' OR "status" IS NULL)
GROUP BY 1
ORDER BY 1;

\echo '=== 10. Total active canonical rows (sizing for backfill estimates) ==='
SELECT
  COUNT(*)                                              AS canonical_active,
  COUNT(*) FILTER (WHERE "postedAt" IS NULL)            AS posted_null_active,
  COUNT(*) FILTER (
    WHERE "postedAt" IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
  )                                                     AS posted_proxy_active
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "isActive" = true;
