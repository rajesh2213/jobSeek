# Growth Activation Sprint — Week 1 Implementation Report

**Generated:** 2026-06-10  
**Scope:** P0.1 (Saved Search Email Fix) · P0.2 (Feed Personalization Analytics) · P0.5 (KPI Baseline)  
**Deployed:** Not deployed — awaiting staging validation

---

## Summary

| Deliverable | Status |
|-------------|--------|
| P0.1 Saved-search email relevance fix | **Implemented** |
| P0.2 Feed personalization analytics + flag ready | **Implemented** |
| P0.5 KPI baseline document | **Created** (fill before prod) |
| Production deploy | **Pending** staging sign-off |

---

## P0.1 — Saved Search Email Relevance Fix

### Audit trace

| Step | Current behavior (pre-fix) | Data available |
|------|---------------------------|----------------|
| `POST /saved-searches` | Creates row; enqueues growth email | `SavedSearch.id`, `query`, `userId` |
| `enqueueGrowthEmailEvent` | Payload: `userId`, `campaignType`, `source` only | No `savedSearchId` |
| `growthEmail.worker.ts` | Calls `runGrowthEmailCampaign({ userId })` | No saved search context |
| `runGrowthEmailCampaign` | `jobService.list({ postedAfter: 24h })` | **Generic** latest jobs |
| Template | Subject: "More suggestions for your new search"; CTA: `/jobs` | Not query-specific |

**Filter source (correct, unused):** `discoveryFiltersFromSavedSearchQuery()` in `savedSearch.service.ts` — same function used by `jobAlerts.worker.ts` for Pro alerts.

### Implementation

| File | Change |
|------|--------|
| `apps/server/src/queues/growthEmail.queue.ts` | Added `savedSearchId` to `GrowthEmailEventPayload` |
| `apps/server/src/modules/saved-search/savedSearch.routes.ts` | Pass `savedSearchId: created.id` on enqueue |
| `apps/server/src/modules/growthEmail/growthEmail.service.ts` | Branch for `event_saved_search_suggestions`: load saved search, `savedSearchSuggestionsFilters()`, CTA = saved query URL |
| `apps/server/src/modules/growthEmail/growthEmail.worker.ts` | Forward `savedSearchId` to campaign runner |
| `apps/server/src/modules/growthEmail/growthEmail.templates.ts` | Subject includes search name + job count |

**Job selection logic:**

```typescript
savedSearchSuggestionsFilters(query, now) = {
  ...discoveryFiltersFromSavedSearchQuery(query),
  postedAfter: now - 7 days,
}
```

**Empty email handling:** Skips send with `status: skipped`, error `"No jobs matching saved search filters"` — same pattern as other campaigns.

**Other campaigns:** Unchanged — still use global `postedAfter` window.

### Validation

| Check | Method |
|-------|--------|
| Filters respect saved query | Unit test `savedSearchSuggestions.test.ts` |
| `companyId` preserved | Unit test |
| Missing `savedSearchId` skips safely | Code path in `runGrowthEmailCampaign` |
| Existing campaigns unaffected | No branch change for non-suggestions types |

**Staging manual test:**

1. Create saved search with narrow filter (e.g. `role` + `remote`)
2. Trigger growth email worker / wait for queue
3. Verify email jobs match `/jobs?...` filter results
4. Verify CTA links to saved search URL, not generic `/jobs`

### Success criterion

✅ A saved-search suggestion email contains only jobs that would appear in that saved search (within 7-day posting window).

---

## P0.2 — Feed Personalization Rollout

### Code status

Carousel was **already implemented** (`RecommendedJobsSection.tsx`, `RecommendedJobCard.tsx`). Week 1 work:

1. **Analytics attribution** — `experiment_variant` on carousel + fit + apply events
2. **Upgrade attribution** — `fit_surface` on `ResumeMatchUpgradeClick`
3. **Flag documentation** — `.env.example` sets `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` (enable on staging/prod deploy env)

### Files changed

| File | Change |
|------|--------|
| `apps/client/lib/analytics/resumeMatchFunnel.ts` | `feedExperimentFields()` → `experiment_variant`; `fit_surface` on upgrade |
| `apps/client/components/resume/ResumeScorePill.tsx` | Pass `fitSurface` to upgrade events + panel |
| `apps/client/components/resume/ResumeScorePanel.tsx` | Accept `fitSurface`; forward to upgrade clicks |
| `apps/client/.env.example` | Flag enabled with staging note |

### Analytics verification checklist

| Event | Status |
|-------|--------|
| `RecommendedJobsViewed` | ✅ + `experiment_variant` |
| `RecommendedJobClicked` | ✅ + `experiment_variant` |
| `ResumeFitViewed` | ✅ + `experiment_variant` |
| `ResumeFitUnavailable` | ✅ + `experiment_variant` |
| `JobApplyClicked` | ✅ + `experiment_variant` |
| `ResumeMatchUpgradeClick` | ✅ + `fit_surface` + `experiment_variant` |

**Dashboard runbook:** `scripts/audit/feed-personalization-dashboard-runbook.md`

### KPI formulas (unchanged)

| KPI | Formula |
|-----|---------|
| `recommendation_ctr` | `RecommendedJobClicked / RecommendedJobsViewed` |
| `fit_check_rate` | `ResumeFitViewed (carousel) / RecommendedJobClicked` |
| `fit_availability` | `ResumeFitViewed / (ResumeFitViewed + ResumeFitUnavailable)` on carousel |
| `application_rate` | `JobApplyClicked (carousel) / ResumeFitViewed (carousel)` |
| `upgrade_rate` | `ResumeMatchUpgradeClick (fit_surface=carousel) / ResumeFitViewed (carousel)` |

---

## P0.5 — KPI Baseline

**Document:** `scripts/audit/growth-activation-baseline.md`

Fill production values **before** enabling feed flag in production.

---

## Rollback plan

| Change | Rollback |
|--------|----------|
| Feed personalization | Redeploy client with `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=0` or unset — instant |
| Saved search email fix | Server redeploy previous build; queued jobs with `savedSearchId` are backward-compatible |
| Analytics fields | Additive only — no rollback required |

**Monitoring triggers (rollback feed flag):**

- `recommendation_ctr` < 1% for 3 consecutive days (after ≥500 views)
- Client error rate +10% vs baseline
- Cross-family recommendations > 5% (re-run `resumeFeedPersonalizationAudit.mjs`)

---

## Staging deploy sequence

```
1. Deploy server (growth email fix)
2. Deploy client with NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1 on staging only
3. Run feed staging checklist (dashboard runbook)
4. Create test saved search → verify suggestion email jobs match filters
5. Fill growth-activation-baseline.md from production
6. Promote to production (manual)
```

**No automatic deployment.**

---

## Week 2 recommendations

| Priority | Item | Rationale |
|----------|------|-----------|
| P0 | Saved Search post-save alert prompt | Highest alert adoption lever; not in Week 1 scope |
| P0 | Saved Search analytics events (`save_search_clicked`, `alert_enabled`, etc.) | Measure Phase 1 funnel |
| P0 | Saved Searches nav entry | Discovery + return visits |
| P1 | `userId % 100` bucketing | True 10% experiment if full flag exposure too risky |
| P1 | Company SEO Wave 1 (FAQ + company alert CTA) | Acquisition surface |
| P2 | Carousel/main-feed dedupe | UX polish |

**Do not start:** ATS Checker, server rerank, Resume Match scoring changes.

---

## Files created / modified

### New

- `apps/server/tests/unit/modules/growthEmail/savedSearchSuggestions.test.ts`
- `scripts/audit/growth-activation-baseline.md`
- `scripts/audit/feed-personalization-dashboard-runbook.md`
- `scripts/audit/growth-activation-week1-implementation-report.md`

### Modified

- `apps/server/src/queues/growthEmail.queue.ts`
- `apps/server/src/modules/saved-search/savedSearch.routes.ts`
- `apps/server/src/modules/growthEmail/growthEmail.service.ts`
- `apps/server/src/modules/growthEmail/growthEmail.worker.ts`
- `apps/server/src/modules/growthEmail/growthEmail.templates.ts`
- `apps/client/lib/analytics/resumeMatchFunnel.ts`
- `apps/client/components/resume/ResumeScorePill.tsx`
- `apps/client/components/resume/ResumeScorePanel.tsx`
- `apps/client/.env.example`
