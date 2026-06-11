# Feed Personalization — Dashboard & KPI Runbook

**Sprint:** Growth Activation Week 1  
**Spec source:** `scripts/audit/phase8c-dashboard-spec.md`

---

## Primary KPIs

### 1. `recommendation_ctr`

```
RecommendedJobClicked / RecommendedJobsViewed
```

| Filter | Value |
|--------|-------|
| Segment | `experiment_variant = carousel` |
| Target | ≥ 3% after ≥ 500 `RecommendedJobsViewed` |

### 2. `fit_check_rate`

```
ResumeFitViewed WHERE surface=recommended_carousel
/ RecommendedJobClicked
```

### 3. `fit_availability`

```
ResumeFitViewed / (ResumeFitViewed + ResumeFitUnavailable)
WHERE surface=recommended_carousel
```

Compare vs `surface=main_feed` for lift measurement.

### 4. `application_rate`

```
JobApplyClicked WHERE surface=recommended_carousel
/ ResumeFitViewed WHERE surface=recommended_carousel
```

PostHog parallel: `job_apply_clicked` WHERE `surface=recommended_carousel`.

### 5. `upgrade_rate`

```
ResumeMatchUpgradeClick WHERE fit_surface=recommended_carousel
/ ResumeFitViewed WHERE surface=recommended_carousel
```

**Week 1 fix:** `ResumeMatchUpgradeClick` now includes `fit_surface` (carousel attribution) and `experiment_variant`.

---

## Event field checklist (post Week 1)

| Event | Required fields |
|-------|-----------------|
| `RecommendedJobsViewed` | `candidate_family`, `job_count`, `surface`, `experiment_variant` |
| `RecommendedJobClicked` | `candidate_family`, `job_family`, `job_id`, `surface`, `experiment_variant` |
| `ResumeFitViewed` | `job_id`, `score`, `surface`, `experiment_variant` |
| `ResumeFitUnavailable` | `reason`, `surface`, `experiment_variant` |
| `JobApplyClicked` | `job_id`, `surface`, `source`, `experiment_variant` |
| `ResumeMatchUpgradeClick` | `surface` (UI location), `fit_surface`, `experiment_variant` |

---

## Staging validation steps

1. Set `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` on staging client build
2. Sign in with resume uploaded; open `/jobs`
3. Confirm carousel renders ("Recommended for your background")
4. Meta Pixel / PostHog live events:
   - `RecommendedJobsViewed` once per mount
   - Click job link → `RecommendedJobClicked`
   - Check fit → `ResumeFitViewed` with `surface=recommended_carousel`
   - Apply → `JobApplyClicked` with `surface=recommended_carousel`
5. Open fit drawer as free user → `ResumeMatchUpgradeClick` with `fit_surface=recommended_carousel`

---

## Daily monitoring template

See `scripts/audit/growth-activation-daily-kpi.md` (create when ops cadence starts).
