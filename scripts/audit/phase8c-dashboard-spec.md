# Phase 8C — Dashboard Definitions

**Generated:** 2026-06-09  
**Audience:** Product / growth analytics (Meta Events Manager + PostHog)

---

## Primary KPIs

### 1. `recommendation_ctr`

**Definition:** Click-through rate on the recommended carousel.

```
RecommendedJobClicked / RecommendedJobsViewed
```

| Filter | Value |
|--------|-------|
| Event (numerator) | `RecommendedJobClicked` |
| Event (denominator) | `RecommendedJobsViewed` |
| Time grain | Daily, weekly |
| Segment by | `candidate_family`, experiment variant |

**Target:** ≥ 3% (Phase 8B stop/go gate)

---

### 2. `fit_check_rate`

**Definition:** Share of carousel job clicks that produce a fit score check.

```
ResumeFitViewed (surface=recommended_carousel)
/ RecommendedJobClicked
```

| Filter | Value |
|--------|-------|
| Numerator | `ResumeFitViewed` WHERE `surface` = `recommended_carousel` |
| Denominator | `RecommendedJobClicked` |
| Segment by | `candidate_family`, `confidence` |

**Note:** Fit requires explicit "Check fit" click on `ResumeScorePill`.

---

### 3. `fit_availability`

**Definition:** Share of fit checks on recommended surface that return a score (not unavailable).

```
ResumeFitViewed / (ResumeFitViewed + ResumeFitUnavailable)
WHERE surface = recommended_carousel
```

| Segment | Compare |
|---------|---------|
| `recommended_carousel` | vs `main_feed` |
| By `candidate_family` | SWE vs marketing vs design |

**Target:** ≥ 10pp lift over `main_feed` (Phase 8B gate)

---

### 4. `application_rate`

**Definition:** Apply clicks after fit check on recommended jobs.

```
JobApplyClicked (surface=recommended_carousel)
/ ResumeFitViewed (surface=recommended_carousel)
```

Parallel PostHog metric: `job_apply_clicked` WHERE `surface=recommended_carousel`.

---

### 5. `upgrade_rate`

**Definition:** Upgrade CTA clicks attributed to fit flow.

```
ResumeMatchUpgradeClick / ResumeFitViewed
WHERE surface IN (recommended_carousel, main_feed)
```

| Segment | Surface |
|---------|---------|
| Carousel path | `recommended_carousel` |
| Control path | `main_feed` |

---

## Secondary Metrics

| Metric | Formula |
|--------|---------|
| Carousel impression rate | `RecommendedJobsViewed` / signed-in job page views |
| Jobs per carousel | AVG(`job_count`) on `RecommendedJobsViewed` |
| Unavailable breakdown | `ResumeFitUnavailableReason` by `reason`, `surface` |
| Resume uploads | `ResumeUploaded` / DAU with jobs page visit |

---

## Dashboard Layout

### Panel A — Experiment Overview
- Variant split (control vs carousel)
- `recommendation_ctr` trend
- `fit_availability` by surface (carousel vs main_feed)

### Panel B — Funnel
- Stacked funnel: Viewed → Clicked → Fit → Apply
- Drop-off % between stages
- Filter: last 7 / 28 days

### Panel C — Quality
- `fit_availability` by `candidate_family`
- Avg fit `score` by surface
- Confidence distribution (`high` / `medium` / `low`)

### Panel D — Revenue
- `upgrade_rate` by surface
- `ResumeMatchUpgradeClick` by `surface` param on upgrade events

---

## Data Sources

| Source | Events |
|--------|--------|
| Meta Pixel (custom) | All `ResumeFit*`, `RecommendedJobs*`, `JobApplyClicked` |
| PostHog | `job_apply_clicked` (with `surface`), page views |
| Server sync | `ResumeUploaded` (optional backend mirror) |

---

## Alert Thresholds

| Alert | Condition | Action |
|-------|-----------|--------|
| Low CTR | `recommendation_ctr` < 3% for 7 days | Pause rollout |
| No lift | `fit_availability` carousel ≤ main_feed | Investigate pool |
| High unavailable | `fit_availability` < 25% on carousel | Review family coverage |
