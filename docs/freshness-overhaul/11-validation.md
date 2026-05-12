# Phase 11 — Validation

## CI-equivalent checks run locally

| Check | Result | Notes |
|---|---|---|
| Server `tsc --noEmit` | PASS | clean |
| Client `tsc --noEmit` | PASS | clean |
| Server `npm run test:all` (unit + functional) | PASS — 182 tests | up from 165 baseline |
| Client `node --test` (jobPostingJsonLd + resumeScoreSoftening) | PASS — 12 tests | JSON-LD test refreshed for Strategy A |
| Server `npm run build:server` | PASS | tsc clean, `dist/` regenerated |
| Client `npm run build` (Next.js production) | PASS | `/jobs`, `/job/[id]`, `/sitemap.xml`, all SEO routes built |
| Linter (`ReadLints`) | clean on all touched files | |

Test count growth comes from:
- 11 new tests in `tests/unit/utils/freshness.test.ts`
- 5 new tests in `tests/unit/services/jobCanonical.postedAt.test.ts`
- 3 refreshed/added tests in `apps/client/lib/jobPostingJsonLd.test.ts`

## What's NOT verified inside this session

These require live infrastructure access (DB credentials, production HTTP,
headless Chromium for Lighthouse). The operator must run them post-deploy.
Each has a documented command in `docs/freshness-overhaul/00-baseline.md`:

- `EXPLAIN ANALYZE --compare-legacy` for the listing sort
- API p95 latency sample on `/jobs?sort=latest`
- SEO route p95 on `/job/<id>`, `/jobs`, `/jobs/<seo-slug>`
- Lighthouse on `/jobs` (compare to baseline)
- Sample real JSON-LD output for a DISCOVERED row (assert no `datePosted`)
- Sample real JSON-LD output for a POSTED row (assert `datePosted` present)
- Two consecutive `freshness:audit:json` runs to verify `posted_eq_created_proxy` is monotonically non-increasing

## Validation checklist (operator gate)

After deploy and after each Phase 10 cleanse pass:

- [ ] `freshness:audit:json` — `posted_eq_created_proxy` count
- [ ] `/jobs?sort=latest&limit=20` page 1 + page 2 — no duplicates across boundary
- [ ] `/jobs?sort=latest&postedWithin=1w` — first 20 are all POSTED if such exist
- [ ] EXPLAIN ANALYZE for `sqlForCanonicalListingIds` p95 wall-time within ±10% of legacy
- [ ] Pull a known DISCOVERED `/job/<id>` — JSON-LD has no `datePosted` and no `validThrough`
- [ ] Pull a known POSTED `/job/<id>` — JSON-LD has `datePosted` matching `postedAt` and `validThrough = postedAt + 45d`
- [ ] Visual check on `/jobs` cards: "Posted 3 hours ago" only on POSTED rows; "Added X ago" on DISCOVERED rows; no "Just posted" / "NEW" badges on DISCOVERED rows
- [ ] Mobile viewport: no layout shift, no hydration warnings in console
- [ ] Sitemap regen produces stable `lastmod` for DISCOVERED rows across two consecutive pulls
- [ ] Hiring-trend on a `/jobs/<seo-slug>` page — bars accurate per source coverage

## Rollback contract

Each phase commit is independently revertable. Order of decreasing revert
priority if a regression is found:

1. Phase 5 (sort change) — `git revert <commit>` restores legacy ORDER BY
2. Phase 8 (frontend) — `git revert <commit>` restores card inference path
3. Phase 6 (JSON-LD / sitemap) — revert if Google Rich Results regresses
4. Phase 10 (cleanser) — by definition idempotent; re-run is safe, "rollback"
   means leaving postedAt = NULL on previously contaminated rows (the correct state)
5. Phase 1 (contamination stop) — leave reverted only if there's a critical product
   need to repopulate fake postedAt values (there isn't)
