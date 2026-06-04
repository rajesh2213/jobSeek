# Slug Fix Production Rollout — Summary

**Date:** 2026-06-04  
**Scope:** Execute, validate, measure, report only (no app/schema changes in this rollout).

---

## Executive summary

The slug extraction fix rollout completed successfully in production. **15 invalid generic tokens** were eliminated; **13 companies** received real ATS board tokens; **2 orphans** were linked at confidence 3. Endpoint-linked company coverage rose from **844 → 846** (+0.24% of DB companies). Re-enrich processed 103 candidates but did not create new endpoint rows in this pass—most remain blocked by enrichment caps or missing board wiring.

---

## 1. Companies recovered

| Source | Count | Detail |
|--------|------:|--------|
| Token migration (Phase 2) | **13** | Bad `posting-api` / `embed` → real slug or cleared |
| Token cleared (unresolvable) | **2** | Synthesia, CircleCI |
| Orphan linker (Phase 5) | **2** | Avantus, Vanta |
| Re-enrich new endpoints | **0** | All 103 runs ended partial / cap |

**Total distinct companies improved:** 15 token fixes + 2 new links (overlap: Avantus/Vanta counted in both migration and linker).

---

## 2. Tokens corrected

- **13** recovered via `reextractBadAtsTokens.ts`
- **2** cleared (null token)
- **0** invalid tokens remain (`posting-api`, `embed`, `login`, `signin`, `api`)

See: [slug-fix-dry-run.md](./slug-fix-dry-run.md), [slug-fix-migration-live.md](./slug-fix-migration-live.md)

---

## 3. Class A companies linked

Implementation audit identified **20** Class A companies (valid careers, no endpoint). This rollout:

- Re-enriched **103** candidates (includes Class A + post-migration tags)
- **0** new `AtsEndpoint` rows from re-enrich
- **2** Class A–adjacent wins via slug match after migration: **Avantus**, **Vanta**

Remaining Class A blockers: `endpoint_linked_other_company` collisions on shared slugs, `enrich_exhausted` cap (15 attempts), and companies without resolvable tokens on careers pages.

---

## 4. Orphans linked

| Before | After | Linked this rollout |
|-------:|------:|--------------------:|
| 227 | 225 | **2** |

Links: `greenhouse/avantus` → Avantus, `ashby/vanta` → Vanta (confidence 3 only).

See: [slug-fix-orphan-dry-run.md](./slug-fix-orphan-dry-run.md)

---

## 5. Coverage increase

| Metric | Before | After | Δ |
|--------|-------:|------:|--:|
| Distinct companies with linked endpoint | 844 | 846 | **+2** |
| Linked AtsEndpoint rows | 901 | 904 | +3 |
| Orphan active endpoints | 227 | 225 | −2 |
| Invalid ATS tokens | 15 | 0 | −15 |

% of 10,347 companies with linked endpoint: **8.16% → 8.18%**

---

## 6. Remaining blockers

| Blocker | Est. scale | Notes |
|---------|------------|-------|
| Orphan endpoints (no slug match) | **225** | No confidence-3 company token match |
| `enrich_exhausted` | **~88+** in re-enrich cohort | Cap prevents further auto-enrich |
| Shared-board collisions | **6** duplicate token groups | harnessinc, figment, harrison, octoenergy, avalerehealth, workday coke |
| Careers URL 404 / wrong path | **~65%** of discovery failures | Outside slug fix scope |
| M:N board model not deployed | Class A collisions | Recommended in audit; not implemented |

---

## 7. Next gain opportunity (estimate only)

| Initiative | Est. companies | Rationale |
|------------|---------------:|-----------|
| M:N `CompanyAtsEndpoint` + relink Class A | **15–17** | Unblocks `endpoint_linked_other_company` |
| Orphan linker v2 (domain + human review) | **Low** at conf 3; **medium** with supervised conf 2 | 225 orphans; only 2 matched exact slug today |
| Reset + re-queue `enrich_exhausted` with fixed extractors | **20–90** | Depends on careers page fetch success |
| Playwright / internal job board crawler | **100s** | Largest cohort in valid-careers audit |
| Workable/BambooHR/SmartRecruiters detectors | **50–150** | URL quality audit Class B |

**Highest leverage after this rollout:** shared-board model (M:N) to recover Class A collisions without weakening `@@unique([type, slug])` integrity.

---

## Artifacts

| Phase | Document |
|-------|----------|
| 0 Baseline | [slug-fix-baseline.md](./slug-fix-baseline.md), `slug-fix-baseline.json` |
| 1 Dry run | [slug-fix-dry-run.md](./slug-fix-dry-run.md) |
| 2 Migration | [slug-fix-migration-live.md](./slug-fix-migration-live.md) |
| 3 Re-enrich | [slug-fix-re-enrich.md](./slug-fix-re-enrich.md) |
| 4 Orphan validation | [slug-fix-orphan-dry-run.md](./slug-fix-orphan-dry-run.md) |
| 6–7 Metrics | [slug-fix-post-rollout.md](./slug-fix-post-rollout.md), `slug-fix-post-rollout.json` |
| 8 Summary | This file |

## Rollout checklist

- [x] Phase 0 baseline captured
- [x] Phase 1 dry-run PASS (no suspicious conversions)
- [x] Phase 2 live migration + invalid token count = 0
- [x] Phase 3 re-enrich executed (rollout script)
- [x] Phase 4 orphan dry-run PASS (confidence 3 only)
- [x] Phase 5 orphan live (2 links)
- [x] Phase 6–7 post metrics + collision audit
- [x] Phase 8 production summary

**No further implementation performed per instructions.**
