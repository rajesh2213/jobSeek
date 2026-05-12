# Phase 2 — Data quality audit

> READ-ONLY. No mutations are performed by this phase.
>
> Run the SQL against a read replica. Use the wrapper for JSON output that
> can be diffed week-over-week:
>
> ```sh
> cd apps/server && DATABASE_URL=... npm run -s freshness:audit:json \
>   > ../../docs/freshness-overhaul/02-data-quality.<date>.json
> ```

## What we measure

| # | Query | Why it matters |
|---|---|---|
| 1 | overall postedAt coverage | denominator for everything below |
| 2 | proxy contamination (postedAt ≈ createdAt within 60s) | counts rows the old `createdAtProxy` script polluted |
| 3 | breakdown by source | shows where contamination lives + which adapters are clean |
| 4 | lead-time `createdAt − postedAt` per source | sanity check that "real" posted dates pre-date discovery |
| 5 | Greenhouse `updated_at` leak | Greenhouse parser uses `updated_at`; "recent" rates will be inflated |
| 6 | discovery-only age buckets | how many fallback rows there are and how old |
| 7 | identical `postedAt` batch fingerprints | reveals ingestion bugs and contamination batches |
| 8 | duplicate-vs-canonical `postedAt` drift | validates the canonical aggregation policy |
| 9 | `listingFreshnessAt` distribution split by real vs discovery | the **user-facing** freshness curve |
| 10 | sizing | drives Phase 10 backfill chunking |

## How to interpret (heuristics)

- **Posted ≈ Created within 60s** is the strongest single signal of proxy contamination.
  Real ATS posts almost never land in DB within 60 seconds of the published timestamp
  (the crawler runs on a schedule with non-zero delay). The few sources where this is
  legitimate are: Greenhouse (because its "posted" is actually `updated_at` and editors
  often re-save shortly before our crawl) — treat those separately.
- **`pct_real` < 60%** on a high-volume source → either the adapter isn't extracting
  a real date or the source genuinely doesn't expose one. Cross-reference §1.2 of the
  audit doc.
- **Identical-timestamp batches** with `rows_sharing_timestamp` in the thousands almost
  always mean a backfill or a date defaulted-to-midnight. Investigate the timestamp.

## ATS reliability ranking (based on adapter source — confirm with §3 numbers)

| Tier | Sources | Why |
|---|---|---|
| A (true publish date) | `lever`, `ashby`, `workday`, `workable`, `jobvite`, `smartrecruiters`, `bamboohr`, `teamtailor`, `rippling` | Each adapter reads a publication field. |
| B (employer-side proxy) | `openclaw` | Aggregator feed — date is high-quality but not first-party. |
| C (semantically wrong) | `greenhouse` | Uses `updated_at`, which changes on every edit. |
| D (no posted date) | `wellfound`, `careers_page` | `postedAt: undefined` ingested. Phase 6 adds JSON-LD `datePosted` extraction for `careers_page`. |

## Recommendations for cleanup (decisions for Phase 10)

1. **Treat tier-C/D contamination as primary cleanup target.** Set `postedAt = NULL`
   for rows where `ABS(postedAt - createdAt) < 60s` **and** source ∈ {`wellfound`,
   `careers_page`} first. Expand to other sources only if §3 shows a non-trivial
   `posted_proxy` count there.
2. **Do NOT bulk-NULL Greenhouse rows yet.** Mark them with `postedAtConfidence =
   'ATS_UPDATE'` (Phase 3 enum) so SEO can demote them without losing the only
   signal we have. Defer policy choice ("treat ATS_UPDATE as POSTED or DISCOVERED")
   to a feature flag.
3. **Recompute canonical aggregation** for any row whose `postedAt` flips to NULL.
   The aggregation in `jobCanonical.service.ts` already picks the earliest non-null
   value across duplicates, so it self-heals once the bad row is cleansed.

## Operational notes

- The audit script uses `$queryRawUnsafe` for parameterless aggregates. All
  queries are bounded by `canonicalJobId IS NULL` / `isActive = true` filters and
  hit indexed columns; expect sub-second on a healthy replica.
- BigInt → Number conversion happens client-side. Counts beyond `Number.MAX_SAFE_INTEGER`
  (≈ 9e15) would be unrealistic for this workload.
- Capture a `02-data-quality.YYYY-MM-DD.json` snapshot on the day of cutover and
  again 7 days later. Diff to verify that `posted_eq_created_proxy` does not grow
  (Phase 1 should have made it monotonically non-increasing).
