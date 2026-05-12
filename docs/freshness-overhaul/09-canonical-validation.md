# Phase 9 — Canonical / dedup validation

## What we audited

`apps/server/src/services/jobCanonical.service.ts:aggregateCanonicalFromSources`
is the only place where canonical-level `postedAt` is computed by combining the
canonical row with all duplicate rows pointing at it. The relevant lines:

```ts
let postedAt: Date | null = ordered[0].postedAt ?? null;
for (let i = 1; i < ordered.length; i++) {
  const t = ordered[i].postedAt;
  if (!t) continue;
  if (!postedAt || t.getTime() < postedAt.getTime()) postedAt = t;
}
```

## Properties verified

The new test file
`apps/server/tests/unit/services/jobCanonical.postedAt.test.ts` locks down five
properties so future refactors can't regress them:

1. **Earliest non-null wins.** Across canonical + duplicates the earliest real
   publish date is picked. Source quality is intentionally NOT used here — the
   first row to publish a date is treated as the authoritative one.
2. **NULL is "no signal."** A duplicate with `postedAt = null` never overwrites
   a canonical's real publish date.
3. **All-NULL → NULL.** If neither canonical nor any duplicate has a publish
   date, the canonical surfaces `postedAt = null` (DISCOVERED). The product
   correctly relabels these as "Added" once the Phase 4-8 client work is live.
4. **Discovery → Publish upgrade.** If the canonical was created from a
   careers_page / wellfound row (no postedAt) and a duplicate from Lever later
   attaches with a real postedAt, the next recompute upgrades the canonical
   from DISCOVERED to POSTED. This is the primary mechanism by which
   contaminated rows self-heal after Phase 10 cleansing.
5. **freshnessScore tracks the picked timestamp.** Older publish dates score
   lower, as expected by `jobRanking.service.ts:freshnessScore`.

## Properties NOT changed in this phase

- Source quality is not used for `postedAt` selection. That's deliberate — the
  current heuristic ("earliest non-null") is robust and easy to reason about.
  If/when we introduce `postedAtConfidence` (Phase 3 Appendix B), this would
  become "highest-confidence first, then earliest."
- Greenhouse `updated_at` is treated as a `postedAt` by the parser — the
  aggregation can't tell it apart from a real publish date. Documented as a
  follow-up; out of Phase 9 scope.

## How recomputation runs

`recomputeCanonical(repo, canonicalId)` reloads canonical + duplicates and calls
`updateCanonicalAggregation` with the aggregated values. After Phase 10 cleanses
contaminated `postedAt`s, the next recompute run will:

- pick the earliest **real** publish date among duplicates if any exists,
- otherwise leave `postedAt = null` and surface as DISCOVERED.

The Phase 10 backfill triggers `recomputeCanonical` for affected canonical IDs
after each chunk, ensuring user-visible state converges per-row rather than
en-masse.
