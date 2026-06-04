# Class B Activation — Results

Executed: 2026-06-04

## Executive summary

Recovered Class B companies were activated end-to-end: **21 endpoints** created or linked, **15 validated** with live jobs (**314** jobs fetched in validation pass), coverage **8.17% → 8.37%**. Orphan count **decreased by 1** (Floqast relink). No duplicate `type_slug` rows introduced.

---

## 1. Companies activated

| Action | Count |
|--------|------:|
| Endpoints created | 20 |
| Orphans relinked | 1 (Floqast) |
| Ingest jobs enqueued | 21 |
| Validation pass (jobs ≥ 1) | 15 |
| Validation fail | 6 |

All **21** recovered companies now have a linked `AtsEndpoint` row.

---

## 2. Endpoints created

20 new registrations via `registerEndpoint` (enrichment source, initially inactive until validation).

---

## 3. Endpoints linked

1 orphan relinked: **Floqast** `lever/floqast` → companyId set.

---

## 4. Active endpoints gained

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Active endpoints (global) | 809 | 822 | **+13** |
| Companies with active endpoint | 571 | 585 | **+14** |

15 endpoints passed validation (`isActive: true`). Six remain inactive after failed crawl.

---

## 5. Jobs discovered

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Ready jobs | 97,403 | 97,567 | +164 |
| Active jobs | 41,093 | 41,257 | +164 |

Validation pass fetched **314** jobs across 15 endpoints (persisted via ingest enqueue).

### Validation outcomes

| Result | Companies |
|--------|-----------|
| PASS | Airship, Brandwatch, ChargeLab, ContinuumGlobal, Correlation One, CX2, Findigs, Floqast, Menti, Outreach, Radformation, saas.group, Sigma Computing, Superchat, Sysdig |
| FAIL | Holmusk, Nevados Engineering, Noibu, ResProp Management, Veho, VideaHealth |

Failures: Lever 404 (wrong slug) or Greenhouse 404; Nevados zero jobs.

---

## 6. Coverage increase

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Companies with endpoints | 846 | 867 | **+21** |
| Linked endpoints | 904 | 925 | **+21** |
| Orphan endpoints | 225 | 224 | **−1** |
| Endpoint coverage % | 8.17% | 8.37% | **+0.20 pp** |

---

## 7. Commit gate

| Check | Status |
|-------|--------|
| Unit tests (`npm run test`) | Run at commit |
| Build (`npm run build`) | Run at commit |
| Activation idempotent | Yes (`type_slug` upsert) |
| Coverage increased | Yes (+21 companies with endpoints) |
| No duplicate endpoints | Yes (unique constraint) |
| No orphan growth | Yes (−1) |

---

## 8. Recommendation — next project

1. **Re-enrich the 6 failed validations** — fix slug mismatches (e.g. `veho` vs actual Lever account) or clear bad tokens; do not broaden ATS scope.
2. **Run ingest worker** to persist validation-fetched jobs for 15 PASS endpoints (jobs already enqueued).
3. **Set `status=ready`** for companies with active endpoint + jobs (standard enrichment completion, recovered cohort only).
4. **Deferred:** Workable/BambooHR Class B (169 companies) — separate provider project, not activation.

---

## Artifacts

| Phase | Path |
|-------|------|
| 1 Baseline | [class-b-activation-baseline.md](./class-b-activation-baseline.md) |
| 2 Dry run | `scripts/audit/classBActivation.ts` |
| 3 Activate | `apps/server/scripts/migrations/activateRecoveredClassB.ts` |
| 4 Validate | `apps/server/scripts/migrations/validateRecoveredClassB.ts` |
| 5 Metrics | `class-b-activation-pre.json`, `class-b-activation-post.json` |
| 6 Results | This file |
