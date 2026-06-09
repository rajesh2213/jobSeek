# Phase 8C — Experiment Plan

**Generated:** 2026-06-09  
**Feature:** Recommended for your background carousel  
**Status:** Ready for measurement — not deployed

---

## Feature Flag

```
NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION
```

| Value | Variant |
|-------|---------|
| unset / `0` / `false` | **control** |
| `1` / `true` | **carousel** |

Helper: `getFeedPersonalizationVariant()` in `apps/client/lib/resumeFeedPersonalizationFlag.ts`

---

## Variants

### Control
- Carousel section **hidden**
- Main jobs feed unchanged (freshness order)
- Fit events use `surface=main_feed` on job cards
- No `RecommendedJobsViewed` / `RecommendedJobClicked` events

### Carousel
- Carousel shown above main feed when:
  - User signed in
  - Resume uploaded
  - `candidateFamily` resolved
  - Recommended jobs exist in pool
- Fit/apply on carousel use `surface=recommended_carousel`
- Main feed below unchanged

**No changes in either variant to:** Resume Fit scoring, feed ranking, job APIs, recommendation algorithm.

---

## Eligibility

| Criterion | Control | Carousel |
|-----------|---------|----------|
| Signed in | ✅ | ✅ |
| Resume uploaded | — | ✅ |
| `candidateFamily != null` | — | ✅ |
| Flag enabled | — | ✅ |

---

## Rollout Phases

| Phase | Flag | Audience | Duration | Gate |
|-------|------|----------|----------|------|
| 0 | Off | 100% control | Pre-launch | Telemetry validated in staging |
| 1 | On (internal) | Team + staging | 3 days | Events fire correctly |
| 2 | 10% | Production | 1 week | CTR ≥ 3%, no errors |
| 3 | 50% | Production | 1 week | `fit_availability` lift ≥ 10pp |
| 4 | 100% | Production | Ongoing | Sustained KPIs |

**Phase 2+ note:** Percentage rollout requires client-side bucketing (e.g. `userId % 100`) — not implemented in 8C; flag is binary until bucketing added in 8D.

---

## Primary Hypothesis

Surfacing same/adjacent-family jobs in a carousel **increases meaningful fit checks** without changing Resume Fit scoring or main feed order.

---

## Success Metrics

| Metric | Control baseline | Success |
|--------|------------------|---------|
| `recommendation_ctr` | 0% | ≥ 3% |
| `fit_check_rate` (carousel) | — | > main_feed rate |
| `fit_availability` lift | ~0–20% on main feed top-20 | ≥ +10pp on carousel |
| `application_rate` | TBD | Directional increase |
| `upgrade_rate` | TBD | Directional increase |

---

## Guardrails

| Metric | Threshold |
|--------|-----------|
| Main feed `fit_availability` | No regression > 2pp |
| Page load (LCP) | No regression > 100ms |
| Error rate on `/jobs` | No increase |
| False-high fit scores | Maintain Phase 7 GO (< 2%) |

---

## Analysis Plan

1. **Assignment:** `getFeedPersonalizationVariant()` at page load
2. **Exposure:** `RecommendedJobsViewed` = carousel variant exposed
3. **Primary analysis:** Compare `fit_availability` by `surface` (carousel vs main_feed)
4. **Secondary:** Funnel conversion View → Click → Fit → Apply
5. **Duration:** Minimum 14 days or 500 carousel views (whichever first)

---

## Stop Rules

| Condition | Action |
|-----------|--------|
| CTR < 3% for 14 days | Set flag off → **NO_GO** on further personalization |
| No fit-check lift vs control | Stop experiment |
| Availability lift < 10pp | Keep carousel; do **not** proceed to server rerank |
| Guardrail breach | Immediate flag off |

---

## Decision Outcomes (post-experiment)

| Outcome | Next step |
|---------|-----------|
| Carousel CTR strong + fit lift | Keep carousel; evaluate server rerank (Phase 9) |
| Carousel CTR weak | **NO_GO** — remove carousel |
| Carousel CTR ok, no fit lift | Iterate UX (auto-check fit, more jobs) before rerank |

---

## Telemetry Prerequisites (8C complete)

- [x] `surface` on all fit events
- [x] `JobApplyClicked` Meta event
- [x] Session surface memory for job detail
- [x] Funnel spec documented
- [x] Dashboard KPIs defined
