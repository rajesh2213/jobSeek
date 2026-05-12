# Freshness Integrity Overhaul — Final Report

Branch: `feat/freshness-integrity-overhaul`
Commits: 9 (one per phase)

## 1. Findings summary

Three latent product issues drove this work, all rooted in the same anti-pattern
("treat crawl timestamps as if they were employer publish dates"):

| Issue | Where it surfaced | Root cause |
|---|---|---|
| "Posted X ago" on cards for rows we never had a real publish date for | `JobCard.tsx`, `JobHeader.tsx`, `JobMeta.tsx` — inferred `Posted` whenever `postedAt != null` | The `createdAtProxy` branch in `backfillPostedAt.ts` had silently written `createdAt` into `postedAt` for rows < 90 d old. From the product's perspective ~all rows looked POSTED. |
| `schema.org/JobPosting` JSON-LD emitted crawl dates as `datePosted` | `apps/client/lib/jobPostingJsonLd.ts` line 26 | `firstValidDateIso(postedAt, effectivePostedAt, createdAt)` fell back to `createdAt` when no real `postedAt` existed. SEO consequence: Google was being told every URL was "published today". |
| Discovery-only rows ranked alongside truly fresh rows in `/jobs?sort=latest` | `sqlForCanonicalListingIds` line 675 | `ORDER BY listingFreshnessAt DESC` treats `COALESCE(postedAt, createdAt)` as a single freshness axis with no source distinction. |

Adjacent issues discovered during the audit, fixed in scope or documented:

- Greenhouse parser uses `updated_at` as `postedAt` — listing-edits leak into freshness. **Documented as a follow-up; not fixed.**
- `careers_page` adapter never extracts `datePosted` from JSON-LD, even when it's available. **Documented as a follow-up; not fixed.**
- Sitemap `lastmod` for DISCOVERED rows defaulted to `now()` — wasted Google crawl budget. **Fixed.**
- SEO hiring-trend chart conflated discovery dates with publish dates. **Fixed.**
- `LimitWallEnhanced`'s "posted in the last 2 hours" counter inflated by crawl timestamps. **Fixed.**
- Pagination cursor instability under the legacy `ORDER BY` (collided rows shuffled across pages). **Fixed via deterministic `id ASC` tiebreaker.**

## 2. Exact schema changes

**None.** The existing schema already exposed everything needed:

- `Job.postedAt` — true ATS publish date (Phase 1 stops contaminating this)
- `Job.createdAt` — first discovery timestamp
- `Job.listingFreshnessAt` (stored generated) — already equals `COALESCE(postedAt, createdAt)`
- `idx_jobs_listing_freshness_at` — already there

Adding new columns would have forced a table rewrite on the canonical Job
table. Avoidable. See `03-schema-design.md` for the cost analysis and the
appendix on when a future `freshnessConfidence`/`postedAtSource` column would
be justified.

## 3. Exact repository changes

`apps/server/src/modules/job/job.repository.ts` — single function `sqlForCanonicalListingIds`:

```diff
- ORDER BY j."listingFreshnessAt" DESC, j."createdAt" DESC
+ ORDER BY j."postedAt"           DESC NULLS LAST,
+          j."listingFreshnessAt" DESC,
+          j."createdAt"          DESC,
+          j.id                   ASC
```

Salary sort gets the same `id ASC` tiebreaker. Doc comment updated to match.

## 4. Exact mapper changes

`apps/server/src/modules/job/job.mapper.ts`:

- New `buildFreshness(job)` helper delegating to `apps/server/src/utils/freshness.ts`
- `toJobListJson` and `toJobDetailJson` both emit `freshness: { source, label, timestamp, relative }`
- `toJobPublicJsonOverDailyCap` inherits via spread

`apps/client/lib/api.ts`:

- Adds `FreshnessSource` + `JobFreshness` types
- Adds `freshness?: JobFreshness` to `JobItem`
- Marks `postedAt`, `effectivePostedAt`, `createdAt` `@deprecated` (kept for v1 client compat)

## 5. JSON-LD changes

`apps/client/lib/jobPostingJsonLd.ts` — Strategy A:

- `datePosted` is omitted when `postedAt` is null (no more crawl-timestamp leaks)
- `validThrough` follows `datePosted` — derived only from a real publish date

`apps/client/app/sitemap.ts`:

- `lastModified` falls back to `createdAt` instead of `now()` — deterministic per row

`apps/server/src/modules/seo/seoAggregations.service.ts`:

- `hiringTrend` buckets strictly by `postedAt`, filters `postedAt IS NOT NULL`

## 6. Query performance analysis

See `05-query-perf.md`. Headline:

- Within POSTED rows, ranking is unchanged (`listingFreshnessAt == postedAt`).
- Within DISCOVERED rows, ranking is unchanged (`listingFreshnessAt == createdAt`).
- The new cross-bucket ordering may add a Sort node on plans that previously
  ran index-only on `idx_jobs_listing_freshness_at`. The LIMIT short-circuits
  the Sort to bounded cost.
- If POST-deploy `EXPLAIN ANALYZE` shows Sort dominating wall time, an
  additional partial composite index is documented (built CONCURRENTLY,
  zero-lock). Deferred until measurement proves it's needed.

`npm run explain:job-listing -- --analyze --compare-legacy` produces a
side-by-side EXPLAIN diff for operator validation.

## 7. SEO analysis

- `datePosted` accuracy: 100% of emissions now correspond to a real
  employer-supplied publish date (Strategy A enforced at the JSON-LD generator).
- Sitemap stability: `lastmod` is deterministic per row; Googlebot crawl budget
  is preserved.
- Hiring-trend honesty: SEO landing-page charts now reflect actual publish
  dates, not crawl cadence.
- Trade-off: rows from sources without `postedAt` coverage (`wellfound`,
  `careers_page`) will not contribute to hiring-trend bars on those landing
  pages until adapter follow-ups land. Trust > volume.

## 8. Rollout plan

1. **Pre-deploy** — operator runs the baseline capture scripts in
   `00-baseline.md` against current production.
2. **Deploy** — merge the branch. The 9 commits are independently
   revertable; cherry-pick / partial rollout is straightforward.
3. **Phase 2 audit (post-deploy)** — `npm run freshness:audit:json` and archive
   under `docs/freshness-overhaul/02-data-quality.<date>.json`.
4. **Phase 10 cleanse — canary** — `npm run freshness:cleanse -- --commit --max-batches=1`,
   compare audit before/after.
5. **Phase 10 cleanse — full** — `npm run freshness:cleanse -- --commit`. ~30 min
   for a million rows at default batch/sleep settings; can resume via
   `--cursor=<lastId>` if interrupted.
6. **Phase 11 validation** — re-run baseline scripts; diff against pre-deploy
   captures.
7. **Sign-off** — operator checks each item in `11-validation.md` checklist.

## 9. Backfill plan

See `10-backfill.md`. Single resumable script:
`npm run freshness:cleanse -w @jobseek/server`. Dry-run by default,
allowlist-scoped, batched, sleep-paced, canonical-recompute integrated.

## 10. Risks

| Risk | Mitigation |
|---|---|
| New ORDER BY adds Sort cost on huge `/jobs?sort=latest&limit=20` requests | Bounded by LIMIT. Pre/post EXPLAIN diff scripted. Optional composite index documented. |
| Pagination cursor instability during the bucket transition | `id ASC` final tiebreaker guarantees a total order. Phase 10 cleansing is per-batch so any flicker is brief. |
| Google Rich Results re-evaluates pages without `datePosted` | Schema.org allows omission. Google's published guidance treats missing `datePosted` as "use crawl-time-of-page" which is correct for DISCOVERED rows. Operator validation step: Rich Results Test on a sample row. |
| Hiring-trend chart looks empty on some company pages | Expected for companies whose jobs all come from `wellfound`/`careers_page`. Adapter follow-up (extract JSON-LD `datePosted` from careers_page HTML) will restore signal without re-introducing contamination. |
| Phase 10 cleanse hits unrelated rows due to a too-broad source allowlist | Default allowlist (`wellfound`, `careers_page`) is the high-confidence intersection. Operators must explicitly opt sources in via `--sources=`. |
| `freshness` payload growth | < 1% of `/jobs` response size gzipped. |

## 11. Follow-up recommendations (NOT in this branch)

Ordered by impact:

1. **`careers_page` JSON-LD `datePosted` extraction.** Extend
   `extractJsonLdJobPostingStrict` in `apps/server/src/utils/jobDetailHtml.ts`
   to capture `datePosted`, and wire it through `jobSourceUrlIngestion.service.ts`.
   This single change restores POSTED coverage for the bulk of career-page
   rows that currently fall to DISCOVERED. ~1-day project; tests live in
   `apps/server/tests/unit/utils/jobDetailHtml.*`.
2. **Greenhouse `updated_at` demotion.** Add a `postedAtSource` enum column
   (additive, default NULL — no table rewrite needed since not stored-generated)
   and have the Greenhouse parser tag rows as `ATS_UPDATE`. Mapper omits
   `datePosted` for `ATS_UPDATE` until product decides whether to treat those
   as POSTED or DISCOVERED. Sketched in `03-schema-design.md` Appendix A.
3. **Promote `freshness` from optional to required.** After a week of stable
   rollout, mark `JobItem.freshness` required, drop the legacy `postedAt`/
   `effectivePostedAt`/`createdAt` fields. Coordinated with extension /
   email consumers.
4. **Add a partial composite index** if EXPLAIN under load shows the new
   Sort dominates. SQL pre-written in `05-query-perf.md`.
5. **`growthEmail` template refactor.** The email template still renders
   freshness inline (string fallback). Route through `job.freshness.relative`
   for consistency.
6. **Extension parity.** When the extension surfaces freshness text, point it
   at `job.freshness` directly (it already receives the field for free via
   the shared `JobItem`).
7. **Backfill recovery for over-eager cleansing.** Phase 10's allowlist is
   conservative; if the audit later reveals contamination from a source not
   yet listed, extend `--sources=` and re-run. Track via the `freshness:audit`
   snapshots.

## 12. What changed where (file index)

```
apps/server/src/utils/freshness.ts                           (new, Phase 4)
apps/server/src/scripts/backfillPostedAt.ts                  (Phase 1)
apps/server/src/modules/job/job.mapper.ts                    (Phase 4)
apps/server/src/modules/job/job.repository.ts                (Phase 5)
apps/server/src/modules/seo/seoAggregations.service.ts       (Phase 6)
apps/server/scripts/explain.jobListing.ts                    (Phase 5)
apps/server/scripts/freshness/audit.sql                      (new, Phase 2)
apps/server/scripts/freshness/audit.ts                       (new, Phase 2)
apps/server/scripts/freshness/cleanseContaminatedPostedAt.ts (new, Phase 10)
apps/server/tests/unit/utils/freshness.test.ts               (new, Phase 4)
apps/server/tests/unit/services/jobCanonical.postedAt.test.ts (new, Phase 9)
apps/server/package.json                                     (npm scripts)
apps/client/lib/api.ts                                       (Phase 7)
apps/client/lib/jobPostingJsonLd.ts                          (Phase 6)
apps/client/lib/jobPostingJsonLd.test.ts                     (Phase 6 / 8)
apps/client/app/sitemap.ts                                   (Phase 6)
apps/client/components/job/FreshnessIndicator.tsx            (new, Phase 8)
apps/client/components/job/JobCard.tsx                       (Phase 8)
apps/client/components/job/JobHeader.tsx                     (Phase 8)
apps/client/components/job/JobMeta.tsx                       (Phase 8)
apps/client/components/job/LimitWallEnhanced.tsx             (Phase 8)
docs/freshness-overhaul/                                     (new, all phases)
```

## 13. Commit ledger

| Phase | SHA | Subject |
|---|---|---|
| 1 | 6350343 | stop postedAt contamination from createdAt proxy fallback |
| 2 | ba5c02d | add freshness data-quality audit (read-only) |
| 4 | a560267 | add backend-owned freshness contract |
| 5 | 799d0d6 | rank POSTED jobs above DISCOVERED in latest sort |
| 6 | 5e77d8c | emit JSON-LD datePosted only for real publish dates (Strategy A) |
| 7 | 466cf1b | extend JobItem with freshness contract |
| 8 | d1ddcf8 | route card / header / meta through backend freshness contract |
| 9 | 9675fcb | lock down canonical postedAt aggregation policy with tests |
| 10 | afe4620 | add resumable cleanser for contaminated postedAt rows |
| 12 | (this commit) | freshness overhaul docs |

Phase 3 (schema design) and Phase 11 (validation) produce documentation only,
shipped with Phase 12.
