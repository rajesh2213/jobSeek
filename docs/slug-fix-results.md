# Slug Fix Results

Generated: 2026-06-04

## 1. Extractors changed

| File | Change |
|------|--------|
| `extractors/atsTokenValidation.ts` | **NEW** — `INVALID_ATS_BOARD_TOKENS`, `sanitizeBoardToken`, `INVALID_WORKDAY_SITES` |
| `extractors/extractBoardUrls.ts` | **NEW** — collect hrefs, script/iframe src, bare URLs |
| `extractors/ashby.extractor.ts` | Scan `jobs.ashbyhq.com/{slug}`, `job-board/{slug}`; reject `posting-api` |
| `extractors/greenhouse.extractor.ts` | Scan board URLs + `?for=` on embed; reject `embed` path |
| `extractors/lever.extractor.ts` | URL scan + validation |
| `extractors/workday.extractor.ts` | Reject `login` / invalid sites |
| `detectors/ats.detector.ts` | `extractAtsToken` aligned with extractors + sanitization |
| `atsDiscovery/atsUrlParser.ts` | Invalid slug rejection in `extractSlug`, `parseCrawlableBoard`, Workday validation |
| `companyEnrichment.service.ts` | Prefer fresh extraction; reject invalid stored tokens; log warning |

## 2. Bad tokens in DB (pre-migration)

| atsType | atsBoardToken | Count (companies) |
|---------|---------------|-------------------|
| ashby | posting-api | ~10 |
| greenhouse | embed | ~5 |

**Total invalid token rows:** 15 (dry-run query)

## 3. Migration dry-run (`reextractBadAtsTokens.ts --dry-run`)

| Outcome | Count |
|---------|------:|
| Recovered real token | 13 |
| Cleared (unresolvable) | 2 (Synthesia, CircleCI) |
| Fetch failed | 0 |

Examples:

- Vanta: `posting-api` → `vanta`
- CloudTrucks: `posting-api` → `cloudtrucks`
- Cockroach Labs: `embed` → `cockroachlabs`
- QA Wolf: `posting-api` → `qawolf`

Run live: `cd apps/server && npx tsx scripts/migrations/reextractBadAtsTokens.ts`

## 4. Class A companies (20 in implementation audit)

| Why no endpoint | Count | Fix |
|---------------|------:|-----|
| `endpoint_linked_other_company` (bad slug collision) | 17 | This slug fix + re-enrich |
| `enrich_exhausted_never_wired` | 3 | Unfreeze + re-enrich |

Re-enrich script: `cd apps/server && npx tsx scripts/reEnrichClassA.ts [--dry-run]`

## 5. Orphan linker (Phase 7)

Updated `scripts/ingestion/linkOrphanEndpoints.ts`:

- **Confidence 3 only:** `endpoint.slug === company.atsBoardToken` (same type)
- Workday: slug match via `buildWorkdaySlug(parseWorkdayBoardToken(token))`
- Skips orphans with invalid slugs (`posting-api`, `embed`)
- **No** domain-guess linking at confidence 1

After migration + re-enrich, re-run linker to measure token matches.

## 6. Tests

`tests/unit/modules/discovery/atsBoardTokenExtractors.test.ts` — 15 tests (all passing)

```bash
cd apps/server && npm run build
node --import tsx --test tests/unit/modules/discovery/atsBoardTokenExtractors.test.ts
```

## 7. Model change recommendation

See `docs/slug-extraction-audit.md` Phase 4 — recommend **M:N `CompanyAtsEndpoint` join** for shared boards (e.g. Split/harnessinc). Not implemented in this change.

## 8. Remaining work (Class B)

| Failure reason | Est. pop | Next step |
|----------------|----------:|-----------|
| greenhouse_board_not_in_html | ~32 | Deeper link/script scan (partially done) |
| lever_company_slug_missing | ~32 | Same |
| workable_embed_only | ~16 | Workable extractor + ingest |
| workday_login_or_invalid_site | ~16 | Fixed invalid site rejection |
| ats_not_crawlable_today | ~72 | New ATS types |

## 9. Implementation order (updated)

1. **Deploy extractor fix** (this PR)
2. **Run migration** `reextractBadAtsTokens.ts`
3. **Run** `reEnrichClassA.ts`
4. **Run** `linkOrphanEndpoints.ts` (confidence 3)
5. Class B token extractors (Workable, etc.)
6. M:N endpoint model (separate PR)
