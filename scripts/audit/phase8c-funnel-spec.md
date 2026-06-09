# Phase 8C — Recommendation Conversion Funnel

**Generated:** 2026-06-09  
**Purpose:** Joinable Meta custom event funnel for feed personalization experiment

---

## Funnel Stages

```
RecommendedJobsViewed
        ↓
RecommendedJobClicked
        ↓
ResumeFitViewed  (surface = recommended_carousel)
        ↓
JobApplyClicked  (surface = recommended_carousel)
```

---

## Event Definitions

| Stage | Event | Transport | Required payload |
|-------|-------|-----------|------------------|
| 1 | `RecommendedJobsViewed` | Meta Pixel | `candidate_family`, `job_count`, `surface=recommended_carousel` |
| 2 | `RecommendedJobClicked` | Meta Pixel | `candidate_family`, `job_family`, `job_id`, `surface=recommended_carousel` |
| 3 | `ResumeFitViewed` | Meta Pixel | `job_id`, `score`, `confidence`, `fit_tier`, **`surface`** |
| 4 | `JobApplyClicked` | Meta Pixel + PostHog | `job_id`, **`surface`**, `source` |

Legacy parallel: PostHog `job_apply_clicked` includes `surface` for warehouse joins.

---

## Surface Propagation

| User path | How `surface` is set |
|-----------|---------------------|
| Fit check on carousel card | `JobCard surface="recommended_carousel"` → `ResumeScorePill` |
| Click job title → job detail → fit | `rememberFitSurface(jobId, recommended_carousel)` → `resolveFitSurface` on detail |
| Apply from carousel card | `ApplyJobButton surface="recommended_carousel"` |
| Apply from job detail after carousel | `resolveFitSurface(jobId)` → `recommended_carousel` |

Session key: `jobseek:fit-surface:{jobId}` (tab-scoped, cleared on browser close).

---

## Funnel Join Keys

| Join | Keys |
|------|------|
| View → Click | Same session, `surface=recommended_carousel`, click within 30 min of view |
| Click → Fit | `job_id` match, `surface=recommended_carousel` |
| Fit → Apply | `job_id` match, `surface=recommended_carousel` |

---

## Conversion Formulas

```
recommendation_ctr = RecommendedJobClicked / RecommendedJobsViewed

fit_check_rate = ResumeFitViewed (surface=recommended_carousel)
                 / RecommendedJobClicked

fit_availability = ResumeFitViewed / (ResumeFitViewed + ResumeFitUnavailable)
                   WHERE surface = recommended_carousel

application_rate = JobApplyClicked (surface=recommended_carousel)
                   / ResumeFitViewed (surface=recommended_carousel)
```

---

## Control Group (experiment)

Users in **control** variant:
- No `RecommendedJobsViewed` events
- Main feed fit/apply events use `surface=main_feed`
- Compare `fit_availability` and `fit_check_rate` between variants

---

## Implementation Files

| Concern | File |
|---------|------|
| Surface types | `apps/client/lib/analytics/fitSurface.ts` |
| Event trackers | `apps/client/lib/analytics/resumeMatchFunnel.ts` |
| Carousel | `apps/client/components/job/RecommendedJobsSection.tsx` |
| Fit pill | `apps/client/components/resume/ResumeScorePill.tsx` |
| Apply | `apps/client/components/job/ApplyJobButton.tsx` |

---

## Validation Checklist (post-deploy)

- [ ] `RecommendedJobsViewed` fires once per carousel render
- [ ] `RecommendedJobClicked` includes correct `job_id`
- [ ] `ResumeFitViewed` on carousel cards has `surface=recommended_carousel`
- [ ] Job detail fit after carousel click inherits `recommended_carousel`
- [ ] `JobApplyClicked` fires on Apply with matching `surface`
- [ ] No PII in payloads
