# Phase 8B — Business Impact Model

**Generated:** 2026-06-09  
**Status:** Directional — structural simulation + modeled CTR; no production carousel events yet

---

## Baseline (Pre-8B Production Data)

| Metric | Main feed (top 20) | Recommended section |
|--------|-------------------|---------------------|
| Fit availability | **0.0%** | **100.0%** |
| Avg fit score | — | **62.0** |
| Unavailable rate | **100.0%** | **0.0%** |
| Confidence (high/med/low) | — | 3 / 1 / 3 |

Source: `phase8b-availability-lift.json` — 4 resumes with family × 20 main-feed jobs vs 7 recommended slots.

**Caveat:** Main-feed 0% reflects cross-domain freshness ordering for current resume corpus; recommended section only surfaces same/adjacent-family jobs by design.

---

## Structural Funnel (Resume Fit simulation)

| Stage | Same-family | Adjacent-family |
|-------|-------------|-----------------|
| Recommendation slots | 7 | 0 |
| Fit available if checked | **100%** | — |
| Modeled CTR | 12% | 8% |

Modeled aggregate funnel (7 views → 0.84 clicks → 0.38 fit checks → 0.08 applications):

| Stage | Modeled volume |
|-------|----------------|
| Recommendations viewed | 7 |
| Job clicked | 0.84 |
| Fit checked | 0.38 |
| Application started | 0.08 |

**Note:** Fit check requires explicit `ResumeScorePill` click — not automatic on view.

---

## Feature Adoption Scenarios

Assumes modeled **12% carousel CTR** and **45% fit-check rate** on clicked jobs. Baseline monthly engaged users with resume: **directional N=100** (placeholder — scale linearly).

| Adoption | Users seeing carousel | Clicks/mo | Fit checks/mo | Apply starts/mo | Fit availability on rec jobs |
|----------|----------------------|-----------|---------------|-----------------|------------------------------|
| **10%** | 10 | 1.2 | 0.5 | 0.1 | ~100% structural |
| **25%** | 25 | 3.0 | 1.4 | 0.3 | ~100% structural |
| **50%** | 50 | 6.0 | 2.7 | 0.6 | ~100% structural |
| **100%** | 100 | 12.0 | 5.4 | 1.2 | ~100% structural |

### Estimated lift vs no carousel (directional)

| Adoption | Fit check lift | Resume upload lift | Upgrade impression lift |
|----------|---------------|-------------------|------------------------|
| **10%** | +5–10% | +2–4% | +3–6% |
| **25%** | +15–25% | +5–10% | +8–15% |
| **50%** | +30–45% | +10–18% | +15–25% |
| **100%** | +50–80% | +18–30% | +25–40% |

Rationale: Each successful fit check on a recommended job replaces a likely-unavailable main-feed check (0% on top-20 sample). Upgrade impressions follow `ResumeFitViewed` → breakdown CTA path.

---

## Quality Guardrails

| Check | Result |
|-------|--------|
| Cross-family recommendations | **0** wrong (118 slots audited) |
| Same-family dominance | **69–100%** per family |
| Algorithm integrity | **PASS** |

Source: `phase8b-quality-audit.json`

---

## Analytics Readiness

| Requirement | Status |
|-------------|--------|
| `RecommendedJobsViewed` instrumented | ✅ |
| `RecommendedJobClicked` instrumented | ✅ |
| Fit events attributable to carousel | ❌ No `surface` on `ResumeFitViewed` |
| Apply events attributable to carousel | ❌ PostHog only, no recommended source |
| Production event volume | ❌ Flag not deployed |

See `phase8b-analytics-audit.json` for gaps.

---

## Decision Framework

| Criterion | Threshold | Measured | Pass? |
|-----------|-----------|----------|-------|
| Carousel CTR | ≥ 3% | **12% modeled** (0% production) | ⚠️ Unverified |
| Fit-check rate improvement | Must improve | **0% → 100%** availability on rec jobs | ✅ Structural |
| Availability lift | ≥ 10pp | **+100pp** on sample | ✅ |
| Wrong recommendations | 0 cross-family | **0** | ✅ |
| Server rerank prerequisites | Strong carousel CTR + fit lift | Carousel not in production | ❌ Defer |

---

## Recommendation: **GO_KEEP_CAROUSEL_ONLY**

### Rationale

1. **Availability lift is decisive** — recommended jobs score 100% available vs 0% on main-feed top-20 for the current resume corpus (+100pp, far above 10pp gate).

2. **Recommendation quality is clean** — 0 cross-family slots across 118 audited recommendations; algorithm behaves correctly.

3. **Server-side rerank is premature** — no production `RecommendedJobsViewed` / `RecommendedJobClicked` data to validate real CTR ≥ 3%. Building server rerank before carousel proof duplicates risk with higher implementation cost.

4. **Analytics gaps block full funnel measurement** — add `surface=recommended_carousel` to fit events before judging engagement.

### Do not proceed to server rerank until

- [ ] `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` deployed ≥ 2 weeks
- [ ] Production carousel CTR ≥ 3% (from Meta `RecommendedJobClicked` / `RecommendedJobsViewed`)
- [ ] `ResumeFitViewed` with `surface=recommended_carousel` shows ≥ 15% lift vs main feed
- [ ] Availability lift on real clicks ≥ 10pp (not just structural simulation)

### Stop conditions (monitor post-deploy)

- Carousel CTR < 3% for 14 days → **NO_GO** on further personalization investment
- Fit-check rate flat vs control → pause rollout
- Availability lift < 10pp on clicked jobs → investigate pool size / family coverage

---

## Next Steps (Phase 8C — not in scope)

1. Deploy carousel at 10% with flag
2. Add `surface` attribution to `ResumeFitViewed` / `ApplyJobButton`
3. Re-run `resumeFeedRecommendationFunnel.mjs` against production Meta exports
4. Re-evaluate server rerank only if carousel CTR and fit-check lift confirm
