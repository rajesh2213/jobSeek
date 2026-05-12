# Phase 10 — Cleansing backfill

## The script

`apps/server/scripts/freshness/cleanseContaminatedPostedAt.ts`
(`npm run freshness:cleanse -w @jobseek/server`)

A read-safe-by-default backfill. **Mutations require `--commit`.**

### What it does

For every `Job` row where:

```sql
source IN ($SOURCES)
  AND postedAt IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (postedAt - createdAt))) < $THRESHOLD_SECONDS
```

set:

```sql
postedAt = NULL,
effectivePostedAt = createdAt
```

Then trigger `recomputeCanonical(repo, canonicalId)` for each affected canonical
so duplicate-side cleansing self-heals canonical aggregates.

### Why it can't disturb pagination

`listingFreshnessAt` is a stored generated column equal to
`COALESCE(effectivePostedAt, createdAt)`. Before cleansing, a contaminated row
has `effectivePostedAt ≈ postedAt ≈ createdAt`. After cleansing,
`effectivePostedAt = createdAt`. Either way `listingFreshnessAt = createdAt`,
so the secondary sort key in the new Phase 5 ORDER BY is unchanged. The
primary key flips from "non-NULL postedAt" (POSTED bucket) to "NULL postedAt"
(DISCOVERED bucket) which is the entire point. Cursor-paginated requests
straddling the cutover may surface a row in a new position once, but
subsequent requests are stable.

## Default safety net

| Setting | Default | Why |
|---|---|---|
| `--commit` | OFF | Dry-run by default; nothing is written without the flag. |
| `--sources=` | `wellfound,careers_page` | Only adapters that **never** legitimately set `postedAt` are targeted. Greenhouse is intentionally excluded — its `updated_at`-as-postedAt issue is a parser fix, not a cleansing target. |
| `--threshold-seconds=` | 60 | Real ATS publishes are virtually never within 60 s of our crawl insertion. 60 s catches proxy artifacts without false-positives. |
| `--batch-size=` | 200 | Bounded memory. Tunable. |
| `--sleep-ms=` | 100 | Backoff between batches keeps the script polite to production. |
| `--max-batches=` | 0 (unlimited) | Use a small value (e.g. 1) for canary testing. |
| `--cursor=` | none | Resumable. Pass the last cursor printed by a prior run. |

## Rollout sequencing

1. **Dry-run, no source filter changes** — confirm row counts match the Phase 2 audit.
   ```sh
   DATABASE_URL=... npm run -s freshness:cleanse -w @jobseek/server
   ```
2. **Canary** — commit a single batch and review.
   ```sh
   DATABASE_URL=... npm run -s freshness:cleanse -w @jobseek/server -- --commit --max-batches=1
   ```
   Then re-run `freshness:audit:json` and confirm `posted_eq_created_proxy`
   dropped by ~`batch-size`.
3. **Full run** — once canary looks clean.
   ```sh
   DATABASE_URL=... npm run -s freshness:cleanse -w @jobseek/server -- --commit
   ```
4. **Re-audit** — final `freshness:audit:json` snapshot, archived to
   `docs/freshness-overhaul/02-data-quality.<date>.json`.

## Resumability

The script orders by `id ASC` and uses `--cursor=<lastId>` to resume. If the
process crashes mid-batch:

- Each batch is one `UPDATE … WHERE id IN (…)` inside a short transaction. A
  crash mid-batch rolls back; the rows remain contaminated and will be picked
  up by the next run.
- The canonical recompute phase is per-id and not transactional with the
  cleansing. A crash here means some canonical rows have stale aggregates;
  they self-correct on the next ingest of any duplicate, or operator can
  re-run with `--commit` (cleanse is idempotent — no contaminated rows left).

## Monitoring checklist (Phase 11 re-runs)

- [ ] `posted_eq_created_proxy` from `freshness:audit:json` is 0 (or close to)
- [ ] `coverageBySource` for `wellfound`/`careers_page` shows `posted_proxy = 0`
- [ ] `findManyCanonicalFiltered` p95 within ±10% of baseline (see Phase 5)
- [ ] No spike in canonical-recompute queue lag
- [ ] No Sentry / pino error rate increase tagged `job_canonical_recomputed`
- [ ] Sample 10 random `wellfound`/`careers_page` job detail pages — they should now show "Added X ago" with no JSON-LD `datePosted`

## When to expand the scope

If the audit shows `posted_proxy > 0` for a source NOT in the default allowlist
(e.g. `serp`, or any provider whose adapter has been audited and confirmed not
to extract real publish dates), re-run with `--sources=<source>` to target it
specifically. Never bulk-cleanse without per-source review — Tier-A adapters
(`lever`, `ashby`, `workday`, etc.) legitimately produce real `postedAt`
values that may happen to be within 60 s of crawl time on quiet pages.
