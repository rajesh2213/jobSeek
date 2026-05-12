# Phase 5 — Query and sorting overhaul

## The single behavioral change

`sqlForCanonicalListingIds` (`apps/server/src/modules/job/job.repository.ts`) is
the only sort site for the canonical listing. Every entry point —
`findManyCanonicalFiltered`, `GET /jobs`, the SEO list pages, the load-more
endpoint, the search results page — funnels through it.

**Before**

```sql
ORDER BY j."listingFreshnessAt" DESC, j."createdAt" DESC
```

**After**

```sql
ORDER BY j."postedAt"           DESC NULLS LAST,
         j."listingFreshnessAt" DESC,
         j."createdAt"          DESC,
         j.id                   ASC
```

## Why this is the right shape

| Key | Effect |
|---|---|
| `postedAt DESC NULLS LAST` | POSTED bucket above DISCOVERED, also orders within POSTED by real publish date. |
| `listingFreshnessAt DESC`  | Within DISCOVERED (postedAt NULL → tie on key 1) orders by `COALESCE(postedAt, createdAt)` which collapses to `createdAt`. Within POSTED, identical to key 1 — Postgres skips re-sorting. |
| `createdAt DESC`           | Tiebreaker for rows with identical listing freshness (batch ingest). |
| `id ASC`                   | Strict deterministic tiebreaker — makes cursor pagination collision-proof. |

Equivalent to the user-recommended `CASE WHEN freshnessSource = 'POSTED' THEN 0
ELSE 1 END, effectiveFreshnessAt DESC` but expressed in a form that the planner
can satisfy with index scans (a CASE expression breaks index ordering).

## What does NOT change

- **Within POSTED rows.** `listingFreshnessAt == postedAt` for those rows so the
  legacy and the new ORDER BY produce identical ranking.
- **Within DISCOVERED rows.** `listingFreshnessAt == createdAt` for those rows
  so the legacy and the new ORDER BY produce identical ranking.
- **Salary sort.** Unchanged except for the added `j.id ASC` final tiebreaker.

## Pagination stability

The legacy ORDER BY relied on `listingFreshnessAt DESC, createdAt DESC`. Both
collide for backfilled rows that share `createdAt` (Prisma seeds, batch
ingests). With offset/limit pagination the planner is free to return the same
collided rows in different positions on consecutive requests — leading to
duplicated entries on page boundaries.

The new tail `createdAt DESC, id ASC` makes the order **total**: every two rows
have a stable winner. Cursor-based pagination using `(listingFreshnessAt,
createdAt, id)` is now sound.

## Index usage analysis

Operator validation:

```sh
cd apps/server
DATABASE_URL=... npm run -s explain:job-listing -- --analyze --compare-legacy \
  | tee ../../docs/freshness-overhaul/05-explain.txt
```

This runs `EXPLAIN (ANALYZE, BUFFERS)` for the new and the legacy `ORDER BY`
back-to-back.

### Pre-rollout EXPLAIN against production (95k canonical rows) — index required

Production baseline (`deploy-snapshots/freshness-rollout-pre/`) showed the new
ORDER BY **could not be served** by any of the existing 10 partial indexes on
`Job`:

| Index | Why it didn't help |
|---|---|
| `idx_jobs_posted_ready_canonical_null`           | `(postedAt DESC)` — defaults to `NULLS FIRST`; our query needs `NULLS LAST`. |
| `idx_jobs_posted_created_ready_canonical_null`   | Same `NULLS FIRST` mismatch. |
| `idx_jobs_listing_order_fast`                    | `NULLS LAST` order matches, but predicate includes a `role NOT IN (...)` exclusion that our listing query doesn't carry. |
| `idx_jobs_listing_freshness_at`                  | Sorts by `listingFreshnessAt` only — wrong leading key. |
| `Job_listing_sort_coalesce_idx`                  | Indexed on `COALESCE(postedAt, createdAt)`, no `postedAt` prefix. |

Result before mitigation:

| Plan           | Method                              | Buffers   | Exec time |
|----------------|-------------------------------------|-----------|-----------|
| Legacy         | Index Scan + Incremental Sort       | hit=61    |  2.3 ms   |
| New            | **Parallel Seq Scan** + top-N Sort  | hit=15171 | **95.4 ms** (~40× worse) |
| New, force idx | Parallel Bitmap → out-of-order Sort | hit=15372 | **3039 ms** (worst) |

A new partial index — promoted from "deferred" to required — is applied as
migration `20260512170000_job_canonical_latest_partial_index`:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_canonical_latest_v2
  ON "Job" ("postedAt" DESC NULLS LAST, "listingFreshnessAt" DESC, "createdAt" DESC, id)
  WHERE "canonicalJobId" IS NULL
    AND "isActive" = true
    AND ("status" = 'ready' OR "status" IS NULL);
```

Result after applying:

| Plan           | Method                                          | Buffers | Exec time |
|----------------|-------------------------------------------------|---------|-----------|
| Legacy         | Index Scan + Incremental Sort *(unchanged)*     | hit=61  |  2.3 ms   |
| New            | **Index Only Scan** on `idx_jobs_canonical_latest_v2` — no Sort node | hit=42 | **0.235 ms** |
| Cursor page 2  | Index Only Scan with `ROW(...) <` Index Cond     | hit=38  |  0.318 ms |

The new sort is now **10× faster than the legacy plan**. The legacy plan is
unaffected because it uses a different index; the new index simply sits idle
until code is deployed that emits the new ORDER BY.

### Deployment order

Migration must apply **before** the code that emits the new ORDER BY. Both are
zero-downtime: the migration is `CREATE INDEX CONCURRENTLY` (no table lock,
small `ShareUpdateExclusiveLock` only), and the code is backward-compatible
once the index exists. Practical order on this VPS:

1. `npx prisma migrate deploy` — applies the new partial index. Legacy code
   continues running, unchanged plan.
2. `npm run build:server` — compile `dist/` with the new ORDER BY.
3. `cd deploy/ && ./restart-jobseek.sh` — restart workers, picks up new code.

## What else I audited

| Site | Verdict |
|---|---|
| `findManyCanonicalFiltered` | Routes through `sqlForCanonicalListingIds`. No separate sort. |
| `hydrateCanonicalListingForShadow` | Hydrate path — no ORDER BY (uses `id IN (...)`). Already preserves passed-in order via `reorderJobsByCanonicalIds`. |
| `hydrateCanonicalListingTruncDescriptionForShadow` | Same as above. |
| `seoAggregations.service.ts` line 58 (`hiringTrend`) | GROUP BY date bucket using `COALESCE(postedAt, createdAt)`. Conflates discovery into "posted". Fix in Phase 6 (SEO). |
| `jobCanonical.service.ts` | Picks earliest non-null postedAt across duplicates — Phase 9 validation only. |
| `growthEmail.service.ts` | Email template uses postedAt presence to choose copy. Phase 8 will route through the freshness object. |

## Rollback

The new ORDER BY is in a single Prisma SQL template literal. Reverting is one
commit's worth of `git revert`. The Phase 4 mapper's `freshness` field is
backward compatible (additive). Rolling back Phase 5 alone leaves Phase 4
intact and harmless.

If the index itself ever needs removal (it won't impact correctness either way):

```sql
-- Run in a direct (non-pgbouncer) session; CONCURRENTLY cannot run in a tx:
DROP INDEX CONCURRENTLY IF EXISTS "idx_jobs_canonical_latest_v2";
```

## Validation checklist (Phase 11 will re-run)

- [ ] `/jobs?sort=latest&limit=20` page 1, page 2 — no duplicates across boundary.
- [ ] `/jobs?sort=latest&postedWithin=1w` — first 20 results are all POSTED if such exist.
- [ ] EXPLAIN ANALYZE p95 wall-time within ±10% of legacy.
- [ ] No N+1 / no JS-side sorting added.
- [ ] Pagination cursor stable for ≥3 consecutive consistent requests.
