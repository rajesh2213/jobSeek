# Growth Activation Sprint — Implementation Plan

**Generated:** 2026-06-10  
**Sprint window:** 4 weeks (Day 2 baseline)  
**Status:** Plan only — do not deploy until reviewed and approved

---

## Sprint objective

Maximize **resume uploads**, **signed-in users**, **saved searches**, **job alert adoption**, and **paid conversions** while collecting production data on Feed Personalization before investing in ATS Checker or major new features.

### Explicit non-goals

- ATS Checker / ATS SEO pages
- Resume rewriter / cover letter generator
- Server-side feed reranking (Phase 8b)
- Resume Match scoring changes

---

## Executive summary

| Workstream | Build vs activate | Est. effort | Ship target |
|------------|-------------------|-------------|-------------|
| **1 — Feed Personalization** | ~90% built; enable flag + measurement | 3–4 eng-days | Week 1 |
| **2 — Saved Search Phase 1** | Backend shipped; UX + analytics + email fix | 4–5 eng-days | Week 1–2 |
| **3 — Company SEO Wave 1** | Foundation shipped; FAQ + CTAs + validation | 4–5 eng-days | Week 2–3 |

**Recommended parallelization:** One engineer on Workstream 1 + dashboard (Week 1), second on Workstream 2 (Week 1), Workstream 3 starts Week 2 after FAQ component pattern is clear.

**Deployment policy:** Manual staged rollout — staging → production. No automatic deploy.

---

## Pre-flight checklist (before any code merge)

- [ ] Record Day-2 baseline: unique visitors, signups, resume uploads, saved searches created, alerts enabled, paid subs (PostHog + billing)
- [ ] Confirm staging has `REDIS_URL`, `JOB_ALERT_HMAC_SECRET`, growth email worker running
- [ ] Confirm production Meta Pixel + PostHog project IDs match staging event names
- [ ] Run `npm run seo:check-sitemap` against staging origin

---

# Workstream 1 — Feed Personalization Rollout

**Goal:** Validate production engagement and recommendation quality.

**Current state:** `RecommendedJobsSection` is wired in `JobsSearchClient.tsx`, gated by `isResumeFeedPersonalizationEnabled()`. Flag is **off** (commented in `.env.example`). Phase 8D static audit **passes** instrumentation.

---

## 1.1 Enable rollout

### Task

Set `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` for eligible users.

**Eligibility (already enforced in code):**

- Signed in (Clerk)
- Resume uploaded (`useResume().hasResume`)
- `deriveCandidateRoleFamily()` returns non-null
- At least one ranked job in pool

### Files / config

| Item | Action |
|------|--------|
| `apps/client/.env.example` | Uncomment flag; document threshold env |
| Staging deploy env | `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` |
| Production deploy env | Same after staging validation (manual promote) |

### Decision: bucketing

Phase 8D recommends `userId % 100` before claiming a "10% experiment." Sprint success criteria (CTR ≥ 3%) still need a control baseline.

**Recommended approach (ship in Week 1, same PR as flag):**

| Env | Purpose |
|-----|---------|
| `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` | Master switch |
| `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION_THRESHOLD=100` | Initial full rollout to eligible users |

Add optional bucketing for later dial-back:

```typescript
// resumeFeedPersonalizationFlag.ts — proposed
export function isUserEligibleForFeedPersonalization(userId: string | null | undefined): boolean {
  if (!isResumeFeedPersonalizationEnabled()) return false;
  if (!userId) return false;
  const threshold = parseInt(process.env.NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION_THRESHOLD ?? "100", 10);
  if (threshold >= 100) return true;
  // Stable bucket: hash userId to 0–99
  const bucket = stableUserBucket(userId);
  return bucket < threshold;
}
```

### Files to modify

1. `apps/client/lib/resumeFeedPersonalizationFlag.ts` — add `isUserEligibleForFeedPersonalization()`, wire `getFeedPersonalizationVariant()`
2. `apps/client/components/job/RecommendedJobsSection.tsx` — use eligibility helper with Clerk `userId`
3. `apps/client/components/job/JobsSearchClient.tsx` — align outer render gate
4. `apps/client/.env.example` — document `THRESHOLD`

### Optional polish (P2, not blocking)

- Dedupe carousel job IDs from main `JobList` page 1 (`JobsSearchClient.tsx`)

**Effort:** 0.5 day (flag only) · 1 day (flag + bucketing + variant)

---

## 1.2 Analytics verification

### Events to verify in production

| Event | Emitter | Required fields |
|-------|---------|-----------------|
| `RecommendedJobsViewed` | `RecommendedJobsSection.tsx` | `candidate_family`, `job_count`, `surface` |
| `RecommendedJobClicked` | `RecommendedJobsSection.tsx` | `candidate_family`, `job_family`, `job_id`, `surface` |
| `ResumeFitViewed` | `ResumeScorePill.tsx`, `ResumeMatchSection.tsx` | `job_id`, `score`, `surface` |
| `ResumeFitUnavailable` | Same | `reason`, `surface`, `job_id` |
| `JobApplyClicked` | `ApplyJobButton.tsx` | `job_id`, `surface`, `source` |

**Surface attribution:** `fitSurface.ts` — sessionStorage `jobseek:fit-surface:{jobId}`; carousel uses `recommended_carousel`.

### Gaps to close in implementation

| Gap | Fix |
|-----|-----|
| `experiment_variant` not on events | Add to `resumeMatchFunnel.ts` payloads; pass `getFeedPersonalizationVariant()` from carousel |
| `upgrade_rate` uses drawer surfaces, not `FitSurface` | Pass `surface` prop through to `trackResumeMatchUpgradeClick` in `ResumeScorePill.tsx` |
| No production verification script | Add staging smoke test checklist (below) |

### Staging verification script (manual)

1. Sign in with resume uploaded (engineering-family resume preferred)
2. Open `/jobs` — confirm "Recommended for your background" section visible
3. Meta Pixel helper / PostHog live events:
   - `RecommendedJobsViewed` fires once per mount
   - Click job title → `RecommendedJobClicked` + `surface=recommended_carousel`
   - Click "Check fit" → `ResumeFitViewed` with `surface=recommended_carousel`
   - Click Apply → `JobApplyClicked` with `surface=recommended_carousel`
4. Confirm `ResumeFitUnavailable` does **not** dominate recommended surface (target: high availability)

### Files to modify

1. `apps/client/lib/analytics/resumeMatchFunnel.ts` — add optional `experiment_variant` to carousel + fit events
2. `apps/client/components/job/RecommendedJobsSection.tsx` — pass variant to trackers
3. `apps/client/components/resume/ResumeScorePill.tsx` — include `surface` on upgrade click

**Effort:** 1 day

---

## 1.3 Dashboard

Create dashboard per `scripts/audit/phase8c-dashboard-spec.md`.

### KPIs

| KPI | Formula |
|-----|---------|
| `recommendation_ctr` | `RecommendedJobClicked` / `RecommendedJobsViewed` |
| `fit_check_rate` | `ResumeFitViewed` (surface=`recommended_carousel`) / `RecommendedJobClicked` |
| `fit_availability` | `ResumeFitViewed` / (`ResumeFitViewed` + `ResumeFitUnavailable`) where surface=`recommended_carousel` |
| `application_rate` | `JobApplyClicked` (surface=`recommended_carousel`) / `ResumeFitViewed` (surface=`recommended_carousel`) |
| `upgrade_rate` | `ResumeMatchUpgradeClick` / `ResumeFitViewed` (segment by surface after fix) |

### Implementation deliverable

**Option A (recommended):** PostHog dashboards + Meta Events Manager custom conversions

| Panel | Source |
|-------|--------|
| Carousel funnel | Meta: `RecommendedJobsViewed` → `RecommendedJobClicked` → `ResumeFitViewed` |
| Availability by surface | Meta: filter `surface` = `recommended_carousel` vs `main_feed` |
| Apply after fit | PostHog `job_apply_clicked` WHERE `surface=recommended_carousel` |

**Option B:** Documented ops runbook only (no new code) — `scripts/audit/feed-personalization-dashboard-runbook.md`

**Option C:** Static formula validator script — extend `phase8d-analytics-verification.mjs` with post-deploy event count thresholds

### Files to create

1. `scripts/audit/feed-personalization-dashboard-runbook.md` — PostHog/Meta setup steps, filters, screenshots placeholders
2. (Optional) `scripts/audit/feed-personalization-daily-report.mjs` — reads PostHog API if key available; else prints manual query template

**Effort:** 0.5–1 day (runbook) · 1–2 days (automated daily script)

---

## 1.4 Monitoring — daily report

### Daily report template

| Metric | Source | Alert threshold |
|--------|--------|-----------------|
| `recommendation_ctr` | Meta | < 3% after ≥500 views |
| `fit_availability` (carousel) | Meta | < 40% |
| `fit_check_rate` | Meta | < 10% |
| Resume uploads (7d rolling) | PostHog `ResumeUploaded` | — |
| Signups | Clerk / PostHog `signup_completed` | — |
| Paid conversions | Billing webhooks / plan changes | — |
| Cross-family recs | Manual sample / quality audit | > 5% |
| Client error rate | Sentry / logs | +10% vs baseline |

### Deliverable

`scripts/audit/feed-personalization-daily-report.md` — copy-paste template for ops (or automated script output).

**Effort:** 0.5 day

---

## 1.5 Success criteria mapping

| Criterion | How measured | Rollback trigger |
|-----------|--------------|------------------|
| CTR ≥ 3% | `recommendation_ctr` after ≥500 `RecommendedJobsViewed` | CTR < 1% for 3 consecutive days |
| Fit check lift ≥ 15% | Compare carousel `fit_check_rate` vs baseline main_feed (pre-flag cohort or surface split) | No lift after 14 days |
| No error rate increase | Sentry / client logs | +10% error rate |
| Cross-family < 5% | Re-run `resumeFeedPersonalizationAudit.mjs` on production sample | > 5% wrong-family |

**Rollback:** Set `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=0` — instant, no migration.

---

# Workstream 2 — Saved Search Phase 1

**Goal:** Increase alert adoption and repeat visits.

**Current state:** Full backend + UI shipped. Gaps: post-save onboarding, analytics, growth email uses generic jobs, no nav entry.

---

## 2.1 Analytics

### Events to add

| Event | Trigger | Payload |
|-------|---------|---------|
| `save_search_clicked` | User clicks "Save search" (before API) | `query`, `is_signed_in` |
| `alert_toggle_clicked` | User clicks alert checkbox (Pro) | `saved_search_id`, `enabled`, `threshold` |
| `alert_enabled` | Successful `patchSavedSearchAlert` enabled=true | `saved_search_id`, `threshold` |
| `alert_disabled` | Successful patch enabled=false | `saved_search_id` |
| `post_save_modal_shown` | Post-save onboarding panel appears | `saved_search_id`, `query` |
| `post_save_modal_completed` | User clicks "Enable alerts" or dismisses | `saved_search_id`, `action`: `enable` \| `dismiss` \| `upgrade` |

**Retain existing:** `saved_search_created` (after API success) — do not remove.

### Files to modify

1. `apps/client/lib/posthog.ts` — add event types
2. `apps/client/components/job/JobsSearchClient.tsx` — wire save click, post-save modal events
3. `apps/client/components/job/SavedSearchManageBody.tsx` — alert toggle events
4. `apps/client/app/(app)/saved-searches/page.tsx` — alert toggle events (duplicated handler)
5. (Optional server) `apps/server/src/workers/jobAlerts.worker.ts` — log `job_alert_sent` for ops metrics

**Effort:** 1.5 days

---

## 2.2 Post-save onboarding

### Current UX

Button changes to disabled **"Saved ✓"** after successful save (`JobsSearchClient.tsx` ~1411).

### Target UX

After save success, show inline panel (or small modal on mobile):

```
Search saved.

Get notified when new matching jobs are posted.

[Enable alerts]   [Not now]
```

**Behavior:**

| User | "Enable alerts" |
|------|-----------------|
| **Pro** | Call `patchSavedSearchAlert(id, { enabled: true, threshold: 5 })` → fire `alert_enabled` |
| **Free** | Fire `post_save_modal_completed` action=`upgrade` → `/pricing?source=saved_search_alert` |

### Implementation approach

1. Add state `postSavePromptId: string | null` set after `createSavedSearch` success
2. Render prompt below save button (desktop) or bottom sheet fragment (mobile)
3. Auto-dismiss on navigate away or after 30s (fire `dismiss`)
4. Fire `post_save_modal_shown` when prompt renders

### Files to modify

1. `apps/client/components/job/JobsSearchClient.tsx` — primary implementation
2. New component (recommended): `apps/client/components/job/PostSaveAlertPrompt.tsx` — keeps `JobsSearchClient` smaller

**Effort:** 1.5 days

---

## 2.3 Saved-search email fix

### Problem

`event_saved_search_suggestions` enqueues on `POST /saved-searches` but `runGrowthEmailCampaign()` lists **global latest jobs** (last 24h) — ignores saved query.

```225:234:apps/server/src/modules/growthEmail/growthEmail.service.ts
    const listing = await jobService.list({
      page: 1,
      limit: 40,
      sort: "latest",
      filters: {
        postedAfter: campaignType === "weekly_digest"
          ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          : new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    });
```

### Fix

1. Pass `savedSearchId` in growth email queue payload
2. Branch in `runGrowthEmailCampaign` when `campaignType === "event_saved_search_suggestions"`:
   - Load `SavedSearch` by id
   - `discoveryFiltersFromSavedSearchQuery(row.query)` (same as `jobAlerts.worker.ts`)
   - List jobs with those filters + `postedAfter: last 7d` (suggestions, not alert threshold)
   - CTA link: saved search URL (`row.query`)
   - Subject: `"Jobs matching your saved search"` (update `growthEmail.templates.ts`)

### Files to modify

1. `apps/server/src/queues/growthEmail.queue.ts` — add `savedSearchId?: string` to `GrowthEmailEventPayload`
2. `apps/server/src/modules/saved-search/savedSearch.routes.ts` — pass `savedSearchId: created.id` to `enqueueGrowthEmailEvent`
3. `apps/server/src/modules/growthEmail/growthEmail.service.ts` — query-aware branch
4. `apps/server/src/modules/growthEmail/growthEmail.templates.ts` — subject/label copy
5. `apps/server/src/modules/growthEmail/growthEmail.worker.ts` — forward `savedSearchId`

**Effort:** 1 day

**Note:** This is a **marketing** email (not Pro alert). Pro alerts remain in `jobAlerts.worker.ts` with 5/10 threshold.

---

## 2.4 Navigation

Add **Saved Searches** to signed-in navigation.

### Insertion points

| Component | Path |
|-----------|------|
| `apps/client/components/layout/SiteSideRail.tsx` | Desktop rail — add pill after Applications |
| `apps/client/components/layout/MobileSectionsMenu.tsx` | Mobile menu — same |
| (Optional) `apps/client/components/layout/SiteHeader.tsx` | Signed-in text link |

**Route:** `/saved-searches` (exists; handles unsigned state client-side)

**Icon:** Bell or bookmark — match Applications pill style

### Files to modify

1. `apps/client/components/layout/SiteSideRail.tsx`
2. `apps/client/components/layout/MobileSectionsMenu.tsx`

**Effort:** 0.5 day

---

## 2.5 Success criteria mapping

| Criterion | Measurement | Notes |
|-----------|-------------|-------|
| Save rate +25% | `saved_search_created` / signed-in job search sessions | Needs baseline Week 1 |
| Alert enable rate +50% | `alert_enabled` / `saved_search_created` | New events required |
| Return visits increase | PostHog retention on users with saved search | 7-day cohort |
| Alert emails within 24h | `jobAlerts.worker` logs + `alertLastSentAt` | Scheduler runs every 30 min; threshold 5/10 new jobs |

---

# Workstream 3 — Company SEO Wave 1

**Goal:** Convert company pages into acquisition + signup surfaces.

**Current state:** Company hubs live with Organization + ItemList JSON-LD, related companies SSR, no FAQ schema, no alert/follow CTAs.

---

## 3.1 FAQ schema

### Pattern to follow

`apps/client/components/seo/JobsListingFaq.tsx` — `buildFaqJsonLd()` + visible FAQ section.

### New component

**Create:** `apps/client/components/seo/CompanyHubFaq.tsx`

**Deterministic FAQs (from company + job stats):**

| Question template | Answer inputs |
|-------------------|---------------|
| How many jobs does {company} have? | `visibleJobCount` |
| Are remote jobs available at {company}? | Count remote jobs in initial listing sample |
| How do I apply to jobs at {company}? | Standard copy + link to listings |

```typescript
// Proposed signature
export function buildCompanyFaqJsonLd(input: {
  companyName: string;
  jobCount: number;
  remoteCount: number;
  slug: string;
}): Record<string, unknown>
```

### Files to modify

1. **Create** `apps/client/components/seo/CompanyHubFaq.tsx`
2. `apps/client/app/(app)/company/[slug]/page.tsx` — render FAQ JSON-LD + UI (SSR)
3. (Optional) `apps/client/lib/seo.ts` — export builder if preferred over colocated component

**Indexability:** FAQ is supplementary content on already-indexable company pages (`decideCompanySeoPolicy`).

**Effort:** 1 day

---

## 3.2 Company alert CTA

### UI

Above job listings in `CompanyHubClient.tsx`:

```
Get alerts for new jobs at {company}
[Save alert]  (Pro: enable alert · Free: upgrade)
```

### Implementation

1. Build saved search query: `/jobs?companyId={company.id}`
2. On click (signed in):
   - If no saved search for this query → `createSavedSearch`
   - If Pro → `patchSavedSearchAlert({ enabled: true })`
   - If free → `/pricing?source=company_alert`
3. Unsigned → sign-in with return URL

### Files to modify

1. `apps/client/components/company/CompanyHubClient.tsx` — CTA UI + handlers
2. **Create** `apps/client/components/company/CompanyAlertCta.tsx` (recommended)
3. `apps/client/lib/api.ts` — no changes if using existing APIs
4. Extend `buildSavedSearchDetails()` in `JobsSearchClient.tsx` to show company name for `companyId` filter (consistency)

**Analytics:** Fire `save_search_clicked` + `post_save_modal_*` or dedicated `company_alert_cta_clicked`

**Effort:** 1.5 days

---

## 3.3 Company follow CTA

### UI

```
Follow {company}
```

Uses same saved search infrastructure as 3.2 (`/jobs?companyId={id}`) **without** requiring alert enabled — distinguish copy:

- **Follow** = save search (free, all users)
- **Get alerts** = save + enable alert (Pro)

Can be one component with two buttons or stepped flow.

### Files

Same as 3.2 — `CompanyAlertCta.tsx` or `CompanyFollowCta.tsx`

**Effort:** 0.5 day (incremental on 3.2)

---

## 3.4 Related companies — validate SSR

### Current state

**Already shipped:**

- `loadRelatedCompanies()` in `jobsPageData.ts` (SSR)
- `CompanyHubClient.tsx` — "More companies hiring" grid

### Validation tasks (not greenfield build)

1. Confirm SSR HTML contains related company links (view-source on staging)
2. Fix client refresh divergence: client refetch omits `hiring: true` — align with SSR in `CompanyHubClient.tsx`
3. Re-run `companySeoFoundationAudit.mjs` on sample
4. Confirm links are indexable (`/company/{slug}`)

**Effort:** 0.5 day QA + 0.5 day fix

---

## 3.5 Search Console

### Ops tasks (no code required)

1. Verify domain in GSC (`docs/monitoring-seo.md`)
2. Submit `https://<domain>/sitemap.xml` (index includes `sitemap-companies.xml`)
3. Request indexing for top 10 company hubs by job count
4. Run `npm run seo:check-sitemap` post-deploy
5. Monitor Coverage → Page indexing for `/company/*` week over week

### Deliverable

Checklist section in `scripts/audit/company-seo-wave1-gsc-checklist.md`

**Effort:** 0.5 day ops

---

## 3.6 Success criteria mapping

| Criterion | Measurement |
|-----------|-------------|
| Increased company page engagement | PostHog pageview duration on `/company/*`; GSC clicks |
| Increased signups from company pages | `signup_completed` with `utm` or referrer `/company/` |
| Increased saved-search creation | `saved_search_created` WHERE query contains `companyId` |

**Add event property:** `source: "company_hub"` on save from company CTAs.

---

# Cross-workstream: Analytics dashboards & daily KPI report

## Unified sprint dashboard (PostHog)

| Panel | Metrics |
|-------|---------|
| **Activation** | Signups, resume uploads, saved searches created |
| **Feed** | 5 KPIs from Workstream 1 |
| **Saved search** | Save rate, alert enable rate, `post_save_modal_completed` breakdown |
| **Company SEO** | Company page views, saves with `source=company_hub` |
| **Revenue** | Pro upgrades by `source` param |

## Daily KPI report (all workstreams)

**Create:** `scripts/audit/growth-activation-daily-kpi.md`

| Section | Metrics |
|---------|---------|
| Traffic | Unique visitors, company page views |
| Activation | Signups, resume uploads |
| Saved search | Saves, alerts enabled, emails sent |
| Feed | CTR, fit availability, fit check rate |
| Revenue | New paid subs, upgrade clicks |

**Cadence:** Manual daily for Week 1–2; automate if PostHog API key available.

---

# 4-week implementation schedule

## Week 1 (Days 3–9) — Ship activation core

| Day | Workstream 1 | Workstream 2 | Workstream 3 |
|-----|--------------|--------------|--------------|
| 1–2 | Flag + bucketing + `experiment_variant` | Analytics events in `posthog.ts` | — |
| 2–3 | Staging verification + enable flag | `PostSaveAlertPrompt` component | — |
| 3–4 | Dashboard runbook | Growth email saved-query fix (server) | — |
| 4–5 | **Staging sign-off** | Nav links (SideRail + Mobile) | GSC checklist prep |

**Week 1 deliverables:**

- [ ] Feed personalization live on staging → production (manual)
- [ ] Saved search analytics + post-save prompt + nav
- [ ] Growth email query fix deployed
- [ ] Baseline dashboard live

**Expected KPI movement (incremental, realistic):** +20–60 resume uploads, +30–80 signups, +5–15 paid, +200–800 visitors

---

## Week 2 (Days 10–16) — Company SEO Wave 1 build

| Day | Workstream 1 | Workstream 2 | Workstream 3 |
|-----|--------------|--------------|--------------|
| 1–2 | Daily monitoring | Iterate post-save copy from data | `CompanyHubFaq.tsx` + page wire-up |
| 2–4 | CTR gate review (≥500 views) | Alert email UTM tracking | `CompanyAlertCta` + Follow CTA |
| 4–5 | Fix upgrade_rate attribution if needed | `/saved-searches` upgrade band | Related companies SSR validation + fix |

**Week 2 deliverables:**

- [ ] Company FAQ schema live
- [ ] Company alert + follow CTAs live
- [ ] GSC sitemap submitted
- [ ] First feed personalization weekly report

**Expected cumulative KPI movement:** +60–150 uploads, +120–300 signups, +20–45 paid, +1.5K–4K visitors

---

## Week 3 (Days 17–23) — Measure & iterate

| Focus | Actions |
|-------|---------|
| Feed | Review CTR vs 3% gate; consider `THRESHOLD` dial if issues |
| Saved search | A/B post-save copy; promote alerts on `/saved-searches` |
| Company SEO | Internal links hub → job slugs; monitor GSC impressions |
| All | Mid-sprint KPI review against OR goals |

**Expected cumulative:** +120–280 uploads, +350–750 signups, +45–95 paid, +2.5K–6.5K visitors

---

## Week 4 (Days 24–30) — Harden & document

| Focus | Actions |
|-------|---------|
| Feed | GO/NO-GO on keeping carousel; document learnings |
| Saved search | Final alert adoption metrics |
| Company SEO | Top-10 hub performance report |
| All | **Rollout summary** (template below) |

---

# Ranked backlog

## P0 — Must ship Week 1

| ID | Item | Workstream |
|----|------|------------|
| P0-1 | Enable `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` (staging → prod) | Feed |
| P0-2 | Sprint KPI baseline + dashboard runbook | All |
| P0-3 | Saved search analytics (6 events) | Saved Search |
| P0-4 | Post-save alert onboarding prompt | Saved Search |
| P0-5 | Growth email saved-query fix | Saved Search |
| P0-6 | GSC sitemap submit | Company SEO |

## P1 — Ship Week 1–2

| ID | Item | Workstream |
|----|------|------------|
| P1-1 | `experiment_variant` + bucketing on feed events | Feed |
| P1-2 | Saved Searches nav entry | Saved Search |
| P1-3 | Company FAQ schema + UI | Company SEO |
| P1-4 | Company alert + follow CTAs | Company SEO |
| P1-5 | Related companies SSR validation/fix | Company SEO |
| P1-6 | `source=company_hub` on company saves | Company SEO |

## P2 — Ship Week 2–3

| ID | Item | Workstream |
|----|------|------------|
| P2-1 | Upgrade click surface attribution fix | Feed |
| P2-2 | `/saved-searches` upgrade band | Saved Search |
| P2-3 | Alert email UTM click tracking | Saved Search |
| P2-4 | Carousel/main-feed dedupe | Feed |
| P2-5 | Automated daily KPI script | All |

## P3 — Defer past sprint

| ID | Item |
|----|------|
| P3-1 | ATS Checker MVP |
| P3-2 | Server-side feed rerank |
| P3-3 | ATS programmatic SEO |
| P3-4 | AI resume rewrite |

---

# GO / NO-GO (this sprint)

| Initiative | Decision | Notes |
|------------|----------|-------|
| **Feed Personalization rollout** | **GO** | Code complete; 8D audit pass; enable Week 1 with monitoring |
| **Saved Search Phase 1** | **GO** | Low effort; direct Pro path; analytics is the work |
| **Company SEO Wave 1** | **GO** | FAQ + CTAs; GSC ops; Week 2 ship |
| **ATS Checker MVP** | **NO-GO** | Explicit non-goal this sprint |

---

# Deployment sequence (manual)

```
1. Merge PRs to main (no auto-deploy)
2. Deploy server (growth email fix) → staging
3. Deploy client (feed flag OFF) → staging
4. Run staging verification checklist
5. Enable NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1 on staging
6. Validate events 24h on staging
7. Deploy server → production
8. Deploy client → production with flag ON
9. Submit sitemap in GSC
10. Begin daily KPI report
```

**Rollback:** Client redeploy with flag `0`. Server email fix is backward-compatible.

---

# Testing plan

| Area | Tests |
|------|-------|
| Feed flag | Manual staging checklist; optional `recommendedJobsForCandidate.test.ts` unchanged |
| Saved search | API integration: create + alert patch; email worker unit test for query filters |
| Growth email | Server test: `event_saved_search_suggestions` uses `discoveryFiltersFromSavedSearchQuery` |
| Company FAQ | Snapshot test for `buildCompanyFaqJsonLd` deterministic output |
| SEO | `seoIndexability.test.ts` unchanged; `companySeoFoundationAudit.mjs` post-deploy |
| Analytics | PostHog live event debugger per event name |

---

# Rollout summary template (complete at Day 30)

```markdown
# Growth Activation Sprint — Rollout Summary

**Sprint:** [dates]
**Baseline (Day 2):** visitors ___ · signups ___ · uploads ___ · saves ___ · alerts ___ · paid ___

## KPI movement
| Metric | Baseline | Day 30 | Δ |
|--------|----------|--------|---|
| Unique visitors | | | |
| Signups | | | |
| Resume uploads | | | |
| Saved searches created | | | |
| Alerts enabled | | | |
| Paid subscribers | | | |

## Workstream results
### Feed Personalization
- CTR: ___% (target ≥3%)
- Fit availability (carousel): ___%
- Decision: KEEP / ROLLBACK

### Saved Search Phase 1
- Save rate Δ: ___%
- Alert enable rate Δ: ___%
- Post-save modal conversion: ___%

### Company SEO Wave 1
- Company page sessions Δ: ___%
- Saves from company hub: ___
- GSC impressions Δ: ___

## Conversion impact
- Top upgrade source: ___
- Feed → fit → upgrade funnel: ___

## Traffic impact
- Organic company page clicks (GSC): ___

## Recommended next sprint
1. ___
2. ___
3. ___
```

---

# File change index

## New files

| File | Workstream |
|------|------------|
| `apps/client/components/job/PostSaveAlertPrompt.tsx` | Saved Search |
| `apps/client/components/seo/CompanyHubFaq.tsx` | Company SEO |
| `apps/client/components/company/CompanyAlertCta.tsx` | Company SEO |
| `scripts/audit/feed-personalization-dashboard-runbook.md` | Feed |
| `scripts/audit/growth-activation-daily-kpi.md` | All |
| `scripts/audit/company-seo-wave1-gsc-checklist.md` | Company SEO |

## Modified files

| File | Changes |
|------|---------|
| `apps/client/lib/resumeFeedPersonalizationFlag.ts` | Bucketing, variant |
| `apps/client/lib/analytics/resumeMatchFunnel.ts` | `experiment_variant` |
| `apps/client/components/job/RecommendedJobsSection.tsx` | Eligibility + variant |
| `apps/client/components/job/JobsSearchClient.tsx` | Post-save prompt, save events, companyId in details |
| `apps/client/components/resume/ResumeScorePill.tsx` | Upgrade surface |
| `apps/client/lib/posthog.ts` | 6 new events |
| `apps/client/components/job/SavedSearchManageBody.tsx` | Alert events |
| `apps/client/app/(app)/saved-searches/page.tsx` | Alert events, upgrade band |
| `apps/client/components/layout/SiteSideRail.tsx` | Nav link |
| `apps/client/components/layout/MobileSectionsMenu.tsx` | Nav link |
| `apps/server/src/modules/growthEmail/growthEmail.service.ts` | Query-aware suggestions |
| `apps/server/src/modules/saved-search/savedSearch.routes.ts` | Pass savedSearchId |
| `apps/server/src/queues/growthEmail.queue.ts` | Payload type |
| `apps/client/app/(app)/company/[slug]/page.tsx` | FAQ schema |
| `apps/client/components/company/CompanyHubClient.tsx` | CTAs, related cos fix |
| `apps/client/.env.example` | Feed flag + threshold |

---

## Approval

- [ ] Engineering lead reviewed scope
- [ ] Non-goals acknowledged (no ATS, no server rerank, no scoring changes)
- [ ] Staging verification owner assigned
- [ ] Daily KPI report owner assigned
- [ ] Production deploy date scheduled (manual)

**Do not deploy until all boxes checked.**
