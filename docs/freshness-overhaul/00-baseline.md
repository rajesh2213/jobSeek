# Phase 0 — Baseline and Affected-Areas Inventory

Purpose: snapshot the system before any change so Phase 11 can prove no regressions.

> Several PRE-metrics require live DB / production HTTP access and are out of scope for
> a code-only session. Each item below either (a) was captured from source (deterministic),
> or (b) is provided as a script/command for the operator to run **before** rolling out.

## 1. Affected areas (full inventory)

### Database / Schema
- `apps/server/prisma/schema.prisma`
  - `Job.postedAt` (line 149)
  - `Job.effectivePostedAt` (line 154) — derived, app-maintained
  - `Job.listingFreshnessAt` STORED generated (line 156) — `COALESCE(effectivePostedAt, createdAt)`
  - `Job.lastSeenAt`, `Job.lastProcessedAt`, `Job.createdAt`, `Job.updatedAt`
  - Indexes: `idx_jobs_effective_posted`, `idx_jobs_effective_listing_fast` (partial),
    `idx_jobs_listing_freshness_at`, `Job_listing_sort_coalesce_idx` (partial)

### Ingestion / ATS adapters
- `apps/server/src/modules/ats/greenhouse/greenhouse.parser.ts` — uses `updated_at` as posted (semantic bug, documented)
- `apps/server/src/modules/ats/lever/lever.parser.ts`
- `apps/server/src/modules/ats/ashby/ashby.parser.ts`
- `apps/server/src/modules/ats/workday/workday.parser.ts`
- `apps/server/src/modules/ats/workable/workable.parser.ts`
- `apps/server/src/modules/ats/jobvite/jobvite.parser.ts`
- `apps/server/src/modules/ats/smartrecruiters/smartrecruiters.parser.ts`
- `apps/server/src/modules/ats/bamboohr/bamboohr.parser.ts`
- `apps/server/src/modules/ats/teamtailor/teamtailor.parser.ts`
- `apps/server/src/modules/ats/rippling/rippling.parser.ts`
- `apps/server/src/modules/providers/providers/openclaw/openclaw.mapper.ts`
- `apps/server/src/services/fallbackJobIngestion.service.ts` — wellfound: `postedAt: undefined`; remoteok: `row.date`
- `apps/server/src/services/jobSourceUrlIngestion.service.ts` — `careers_page`: **never sets `postedAt`** despite JSON-LD often containing `datePosted`
- `apps/server/src/utils/jobDetailHtml.ts` — JSON-LD extractor; does NOT currently parse `datePosted`

### Contamination source
- `apps/server/src/scripts/backfillPostedAt.ts` — `createdAtProxy` branch writes `createdAt` into `postedAt`

### Canonical aggregation
- `apps/server/src/services/jobCanonical.service.ts` — `aggregateCanonicalFromSources` picks earliest non-null `postedAt`
- `apps/server/src/services/jobRanking.service.ts` — `freshnessScore` decays from `COALESCE(postedAt, createdAt)`

### Repository / queries
- `apps/server/src/modules/job/job.repository.ts`
  - `deriveEffectivePostedAt` (line 44)
  - `sqlForCanonicalListingIds` (line 661) — ORDER BY `listingFreshnessAt DESC, createdAt DESC`
  - `buildDiscoveryWhereSql` postedWithin (lines 628-639), postedAfter (lines 634-639)
  - `buildDiscoveryWhere` Prisma equivalent (lines 479-496)
  - `buildCanonicalListingJobSelect` (line 729) — selects `effectivePostedAt`
  - `ListingJobRawRow` (line 763)
  - `mergePostedAtIfEarlier` (line 1535)
  - `updateCanonicalById` / `updateCanonicalAggregation` write `effectivePostedAt`
  - `create` / `createCanonicalJob` / `createDuplicateJob` derive `effectivePostedAt`

### API mappers
- `apps/server/src/modules/job/job.mapper.ts` — `toJobListJson` / `toJobDetailJson` spread Job; expose `postedAt`, `effectivePostedAt`, `createdAt`, `lastSeenAt`

### SEO
- `apps/client/lib/jobPostingJsonLd.ts` — `datePosted = firstValidDateIso(postedAt, effectivePostedAt, createdAt)` and `validThrough` derived from same fallback
- `apps/client/app/sitemap.ts` line 313 — `lastModified: job.postedAt ? new Date(job.postedAt) : now`
- `apps/server/src/modules/seo/seoAggregations.service.ts` — `hiringTrend` buckets `COALESCE(postedAt, createdAt)`

### Frontend (cards / detail / mobile)
- `apps/client/components/job/JobCard.tsx` — `postedMetaLine` infers Posted/Added client-side, lines 60-68
- `apps/client/components/job/JobHeader.tsx` — uses `effectivePostedAt ?? createdAt`, line 23
- `apps/client/components/job/JobMeta.tsx` — same conflated instant, line 13
- `apps/client/components/job/LimitWallEnhanced.tsx` — uses `postedAt`
- `apps/client/lib/api.ts` — `JobItem` exposes `postedAt`, `effectivePostedAt`, `createdAt`
- `apps/client/lib/format.ts` — relative time formatter (pure; reused)
- `apps/client/lib/similarJobsRank.ts` — uses `postedAt`

### Email / alerts (consumers)
- `apps/server/src/modules/growthEmail/growthEmail.service.ts` — `j.postedAt ? slice : "Recently posted"` (rendered string)
- `apps/server/src/modules/growthEmail/growthEmail.templates.ts`
- `apps/server/src/workers/jobAlerts.worker.ts`
- `apps/server/src/utils/emailTemplates.ts`

## 2. Pre-change snapshots — operator commands

These produce the PRE artifacts that Phase 11 will rerun POST-change.

### 2.1 EXPLAIN ANALYZE of the listing sort (today)
```sh
# from repo root, with DATABASE_URL set to read-replica
cd apps/server
DATABASE_URL=... npm run -s explain:job-listing -- --analyze \
  | tee ../../docs/freshness-overhaul/baseline/explain-latest-bare.txt
DATABASE_URL=... npm run -s explain:job-listing -- --scenario=posted --analyze \
  | tee ../../docs/freshness-overhaul/baseline/explain-latest-posted.txt
DATABASE_URL=... npm run -s explain:job-listing -- --scenario=category --analyze \
  | tee ../../docs/freshness-overhaul/baseline/explain-latest-category.txt
```

### 2.2 API latency (sample 50 requests, p50/p95)
```sh
# operator-side — replace URL and Clerk token
URL='https://api.jobloom.example/jobs?sort=latest&limit=20'
for i in $(seq 1 50); do
  curl -s -o /dev/null -w '%{time_total}\n' "$URL"
done | tee docs/freshness-overhaul/baseline/api-latency.txt
```

### 2.3 SEO route latency (sample 20 requests)
```sh
for path in /jobs /jobs/browse /job/<known-id>; do
  for i in $(seq 1 20); do
    curl -s -o /dev/null -w "$path %{time_total}\n" "https://jobloom.example$path"
  done
done | tee docs/freshness-overhaul/baseline/seo-latency.txt
```

### 2.4 Sample current JSON-LD (for diffing in Phase 6)
```sh
# detail page renders JSON-LD inline; grep it out
curl -s 'https://jobloom.example/job/<known-id>' \
  | grep -A1 'application/ld+json' \
  | head -50 \
  | tee docs/freshness-overhaul/baseline/jsonld-sample.txt
```

### 2.5 Lighthouse (jobs page)
```sh
npx -y lighthouse https://jobloom.example/jobs \
  --quiet --chrome-flags='--headless=new' \
  --output=json --output-path=docs/freshness-overhaul/baseline/lighthouse-jobs.json
```

### 2.6 Current freshness rendering screenshots
- Operator capture: `/jobs` (above the fold), `/job/<id>` (header), mobile viewport
- Save to `docs/freshness-overhaul/baseline/screenshots/`

## 3. Static facts confirmed from source (no DB needed)

| Sort key today | `ORDER BY j."listingFreshnessAt" DESC, j."createdAt" DESC` |
| Generated col | `listingFreshnessAt = COALESCE(effectivePostedAt, createdAt)` |
| Sort index   | `idx_jobs_listing_freshness_at` (full) + `idx_jobs_effective_listing_fast` (partial) |
| Card label rule | `prefix = job.postedAt != null ? "Posted" : "Added"` (client-inferred) |
| JSON-LD datePosted | `firstValidDateIso(postedAt, effectivePostedAt, createdAt)` — **emits createdAt fallback** |
| Sitemap lastmod | `postedAt ?? now()` — **unstable** for fallback rows |

## 4. Phase 1 target

Single behavioral change: remove `createdAtProxy` branch from `backfillPostedAt.ts`.
No schema change. No runtime path touched. Only the standalone script behavior changes.
