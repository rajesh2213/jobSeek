# Phase 3 — Additive freshness model (no-DDL primary path)

## Headline decision

**Ship Phase 3-8 with zero schema changes.** The existing schema already
provides everything the new semantics need:

| Concept | Field today | Why it's already correct |
|---|---|---|
| true publish date | `Job.postedAt` (`DateTime?`) | After Phase 1 we never invent it. |
| discovery timestamp | `Job.createdAt` (`DateTime`) | First-insert time. |
| last verification crawl | `Job.lastSeenAt` (`DateTime`) | Already updated by re-crawl. |
| **effective freshness** | `Job.listingFreshnessAt` (STORED generated) | Equals `COALESCE(postedAt, createdAt)`. |
| sort index | `idx_jobs_listing_freshness_at` + partial `idx_jobs_effective_listing_fast` | Already there. |

The sort index `idx_jobs_listing_freshness_at` was built on `listingFreshnessAt DESC`
in migration `20260502204600_job_listing_freshness_at_index`. It is exactly the
shape we need for the new ORDER BY (see Phase 5).

Two derived signals stay in the **application layer** (mapper-owned, frontend-blind):

```ts
type FreshnessSource = "POSTED" | "DISCOVERED";

function deriveFreshness(job: { postedAt: Date | null; createdAt: Date; listingFreshnessAt: Date }) {
  const source: FreshnessSource = job.postedAt ? "POSTED" : "DISCOVERED";
  const timestamp = job.postedAt ?? job.createdAt; // == job.listingFreshnessAt
  const label = source === "POSTED" ? "Posted" : "Added";
  return { source, timestamp, label };
}
```

Cost: ~50 ns per job per response. Cost of the avoided alternative (adding a stored
generated `freshnessSource TEXT`): an `ALTER TABLE` that forces a full table rewrite
on the canonical Job table. Operational risk hugely outweighs the negligible CPU.

## Why no new column?

- `postedAt IS NULL` is the exact boundary we want. `freshnessSource = DISCOVERED ⇔ postedAt IS NULL`.
  The predicate is indexable as-is (the partial sort index already implicitly uses it).
- `effectiveFreshnessAt` is `listingFreshnessAt`. Adding a duplicate column with a different
  name would force a table rewrite **and** require renaming references everywhere — a
  giant migration for zero behavioral benefit.
- "Confidence" (e.g. distinguishing Greenhouse `updated_at` from a true publish) is a
  *future* discriminator. Until the product needs that distinction at SQL level, we encode
  it in the adapter parsers (Phase 6 — Greenhouse opts out of `datePosted` even when
  `postedAt` is set) and in mapper output. See Appendix B for when to add the column.

## Schema delta (committed: none)

```diff
  // apps/server/prisma/schema.prisma
  // (intentionally unchanged this phase)
```

The Prisma client does not need regeneration. No migration file is created. This is
the smallest possible diff that delivers the user-visible semantics.

## Backfill needs (Phase 10)

Even without DDL, we still want a one-shot cleanse of historical proxy rows:

```sql
-- runs in chunks via Phase 10 script; not in Phase 3
UPDATE "Job"
SET "postedAt" = NULL,
    "effectivePostedAt" = "createdAt"   -- keeps listingFreshnessAt unchanged
WHERE "postedAt" IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
  AND source IN ('wellfound', 'careers_page');
```

Because `listingFreshnessAt` is derived as `COALESCE(effectivePostedAt, createdAt)`,
setting `effectivePostedAt = createdAt` keeps the sort key identical — no rank
changes, no pagination disruption. The only observable change is:
`postedAt → NULL`, which flips `freshnessSource` from `POSTED` to `DISCOVERED` and
relabels the UI from "Posted" to "Added" for cleansed rows.

## Indexing plan (committed: none)

The existing indexes serve the new ORDER BY without modification:

- `idx_jobs_listing_freshness_at` (`listingFreshnessAt DESC`) — primary sort key
- `idx_jobs_effective_listing_fast` (`effectivePostedAt DESC` WHERE listing-predicate) — partial mirror
- `Job_listing_sort_coalesce_idx` (`COALESCE(postedAt, createdAt) DESC NULLS LAST` WHERE canonical) — already matches

Phase 5 confirms via `EXPLAIN` that the new ORDER BY uses these indexes
without spilling to a Sort node.

## Rollback strategy

- All changes from this phase forward are in TypeScript and SQL files behind an
  `ENABLE_FRESHNESS_V2` env flag (added in Phase 7). Rolling back is `unset
  ENABLE_FRESHNESS_V2 && restart`.
- No DDL means no migration to revert.
- The Phase 10 cleanse is gated by source list and dry-run-first. If a regression
  is detected, reverse it row-by-row from the audit script JSON snapshots.

## Appendix A — Future enum values (not implemented now)

If/when product needs them:

```
FreshnessSource: POSTED | DISCOVERED | INFERRED | SITEMAP | UNKNOWN
FreshnessConfidence: HIGH | MEDIUM | LOW
PostedAtSource: ATS_PUBLISH | ATS_UPDATE | HTML_JSONLD | URL_UUID | UNKNOWN
```

These would live in a new optional column `postedAtSource TEXT`, populated only by
adapter parsers going forward. Backfill is best-effort (source enum can be inferred
from the row's `source` column). Adding this column does NOT force a table rewrite
if it's `NULL`-defaulted and not `STORED GENERATED`. Deferred to a future feature.

## Appendix B — When to revisit adding a column

Add `freshnessSource TEXT GENERATED ALWAYS AS (...) STORED` if:

1. SEO landing-page SQL grows to need `WHERE freshnessSource = 'POSTED'` as a
   predicate inside `JOIN`s where Postgres can't push the filter through.
2. We add `INFERRED` semantics (e.g. computed from URL UUIDv1 + flagged as
   "approximate") that aren't a pure function of `postedAt IS NULL`.
3. Greenhouse-style `ATS_UPDATE` confidence needs to live in canonical-listing
   SQL paths (currently handled in adapter + JSON-LD emit only).

Until then, the application-derived value is the right level of indirection.
