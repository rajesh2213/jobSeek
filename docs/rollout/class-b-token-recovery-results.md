# Class B Token Recovery — Results

Executed: 2026-06-04

## Summary

| Metric | Result |
|--------|--------|
| **Tokens recovered (live)** | **21** |
| Success tier | Below **+25** minimum; above +20 re-audit threshold |
| Crawlable Class B scanned | 92 |
| Recovery rate | 22.8% |

Extractor improvements + migration recovered **21 companies** (8 Greenhouse, 13 Lever). Workday and Ashby yielded **0** recoveries in this pass.

---

## Metrics

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Companies with `atsBoardToken` | 722 | 743 | **+21** |
| Companies `status=ready` | 725 | 725 | 0 |
| Ready + token | 722 | 722 | 0* |
| Distinct linked companies | 846 | 846 | 0 |
| Invalid tokens | 0 | 0 | 0 |
| Class B crawlable (no token, no endpoint) | 92 | ~71 | ~−21 |

\*Recovered companies remain mostly `enriching`; ready count unchanged until enrichment wires endpoints.

Baseline/post JSON: `slug-fix-class-b-baseline.json`, `slug-fix-class-b-post.json`

---

## Recoveries by ATS type

| ATS | Recovered |
|-----|----------:|
| greenhouse | 8 |
| lever | 13 |
| workday | 0 |
| ashby | 0 |

### Companies recovered

| Company | ATS | Token |
|---------|-----|-------|
| Airship | greenhouse | airship |
| Brandwatch | greenhouse | brandwatch |
| Correlation One | greenhouse | correlationone |
| Menti | greenhouse | mentimeter |
| ResProp Management | greenhouse | resprop |
| saas.group | greenhouse | saasgroup |
| Sigma Computing | greenhouse | sigmacomputing |
| Superchat | greenhouse | superchat |
| ChargeLab | lever | chargelab-inc |
| ContinuumGlobal, Inc | lever | continuumglobal |
| CX2 | lever | cx2 |
| Findigs | lever | findigs |
| Floqast | lever | floqast |
| Holmusk | lever | holmusk |
| Nevados Engineering | lever | nevados |
| Noibu | lever | noibutechnologies |
| Outreach | lever | outreach |
| Radformation | lever | radformation |
| Sysdig | lever | sysdig |
| Veho | lever | veho |
| VideaHealth | lever | videahealth |

---

## Commands run

```bash
# Phase 0 audit
cd apps/server && npx tsx scripts/audit/classBTokenRecoveryAudit.ts

# Phase 4 dry-run
cd /home/ubuntu/jobSeek && npx tsx scripts/audit/classBTokenRecovery.ts

# Phase 5 migration
cd apps/server && npx tsx scripts/migrations/recoverClassBTokens.ts --dry-run
cd apps/server && npx tsx scripts/migrations/recoverClassBTokens.ts
```

---

## Endpoint gain estimate

| Stage | Est. companies |
|-------|---------------:|
| Tokens persisted | **21** |
| Endpoints after re-enrich (no slug collision) | **15–21** |
| Orphan slug matches (new) | **0–3** (spot-check post-migration) |

Endpoint rows are **not** created by this migration. Run standard `processEnrichCompany` / discovery queue for recovered IDs tagged `class_b_token_recovery:recovered`.

---

## Success criteria

| Tier | Target | Actual |
|------|-------:|-------:|
| Minimum | +25 | **21** (close) |
| Good | +50 | Not met |
| Excellent | +80+ | Not met |

**Recommendation:** Re-audit Workday JSON parsing on live failures (11 unresolved WD) and Ashby org paths (5 unresolved). Lever JSON extraction delivered most gains (+13). Do not expand to Workable/BambooHR without separate project.

---

## Artifacts

| Phase | Document / script |
|-------|-------------------|
| 0 | [class-b-token-recovery-audit.md](../audit/class-b-token-recovery-audit.md) |
| 1 | [class-b-token-recovery-plan.md](../implementation/class-b-token-recovery-plan.md) |
| 2 | Extractors: `greenhouse`, `lever`, `workday`, `ashby`, `extractBoardUrls`, `ats.detector` |
| 3 | `atsBoardTokenExtractors.test.ts` (24 tests, all pass) |
| 4 | `scripts/audit/classBTokenRecovery.ts` |
| 5 | `apps/server/scripts/migrations/recoverClassBTokens.ts` |
| 6 | This file |
