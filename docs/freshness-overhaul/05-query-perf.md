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
back-to-back. Three expected outcomes by candidate set size:

1. **Small/medium candidates (<~50k after WHERE).** Plan is `Bitmap Heap Scan →
   Sort → Limit`. Sort cost is in the single-digit ms — negligible.
2. **Bare listing (no filters), millions of rows.** Plan likely uses
   `idx_jobs_listing_freshness_at` for an Index Scan and adds a small Sort node
   to enforce the new leading `postedAt DESC NULLS LAST` key. The Sort node has
   bounded cost because the LIMIT short-circuits it once the top-N are seen.
3. **Worst case: full Seq Scan.** Only happens if WHERE clause is incompatible
   with available indexes — same behavior as today.

If POST-cutover EXPLAIN shows the Sort dominating wall time on the bare-list
path (>20 ms p95), apply this **CONCURRENTLY-built** composite (additive, zero-
lock once `CONCURRENTLY` is honored):

```sql
-- Run during a quiet window; CONCURRENTLY requires no transaction.
CREATE INDEX CONCURRENTLY idx_jobs_posted_freshness
  ON "Job" ("postedAt" DESC NULLS LAST, "listingFreshnessAt" DESC, "createdAt" DESC, id)
  WHERE "canonicalJobId" IS NULL
    AND "isActive" = true
    AND ("status" = 'ready' OR "status" IS NULL);
```

This index exactly matches the new ORDER BY tuple, so a properly chosen plan can
return rows pre-sorted with zero Sort cost. Deferred until measurement proves
it's needed.

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

## Validation checklist (Phase 11 will re-run)

- [ ] `/jobs?sort=latest&limit=20` page 1, page 2 — no duplicates across boundary.
- [ ] `/jobs?sort=latest&postedWithin=1w` — first 20 results are all POSTED if such exist.
- [ ] EXPLAIN ANALYZE p95 wall-time within ±10% of legacy.
- [ ] No N+1 / no JS-side sorting added.
- [ ] Pagination cursor stable for ≥3 consecutive consistent requests.
