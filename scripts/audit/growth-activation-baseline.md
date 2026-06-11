# Growth Activation Sprint — Day 2 Baseline

**Recorded:** 2026-06-10 (before Week 1 P0 deploy)  
**Purpose:** Pre-change reference for KPI movement during Feed Personalization + Saved Search email fix rollout  
**Status:** Template — fill production values before enabling `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=1` in production

---

## Instructions

Capture **7-day trailing** and **prior-day** values from:

| Source | Metrics |
|--------|---------|
| PostHog | `signup_completed`, `saved_search_created`, `ResumeUploaded` |
| Meta Events Manager | `RecommendedJobsViewed` (will be 0 until flag on), `ResumeFitViewed`, `ResumeMatchUpgradeClick`, `UpgradePromptShown`, `UpgradePromptClick`, `CheckoutStarted`, `SubscriptionActivated` |
| Clerk Dashboard | Total users, new sign-ups |
| Billing (PayPal/Dodo) | Active Pro subscriptions, new subs in period |
| Google Analytics / server logs | Unique visitors (if available) |
| Database (read-only) | `SavedSearch` count, `alertEnabled=true` count |

---

## Baseline snapshot

| Metric | Prior day | 7-day avg | 7-day total | Notes |
|--------|-----------|-----------|-------------|-------|
| Unique visitors | _fill_ | _fill_ | _fill_ | |
| Signups (`signup_completed`) | _fill_ | _fill_ | _fill_ | |
| Resume uploads (`ResumeUploaded`) | _fill_ | _fill_ | _fill_ | |
| Saved searches created | _fill_ | _fill_ | _fill_ | PostHog `saved_search_created` |
| Alert-enabled saved searches | _fill_ | — | _fill_ | DB: `SavedSearch.alertEnabled=true` |
| Paid subscribers (active Pro) | _fill_ | — | _fill_ | |
| New paid conversions | _fill_ | _fill_ | _fill_ | |
| `RecommendedJobsViewed` | 0 | 0 | 0 | Expected 0 pre-flag |
| `ResumeFitViewed` (all surfaces) | _fill_ | _fill_ | _fill_ | |
| `ResumeFitViewed` (`recommended_carousel`) | 0 | 0 | 0 | Expected 0 pre-flag |

---

## Funnel baselines (pre-carousel)

| KPI | Formula | Baseline value |
|-----|---------|----------------|
| `recommendation_ctr` | `RecommendedJobClicked / RecommendedJobsViewed` | N/A (no views) |
| `fit_check_rate` | `ResumeFitViewed (carousel) / RecommendedJobClicked` | N/A |
| `fit_availability` | `ResumeFitViewed / (ResumeFitViewed + ResumeFitUnavailable)` on carousel | N/A |
| `application_rate` | `JobApplyClicked (carousel) / ResumeFitViewed (carousel)` | N/A |
| `upgrade_rate` | `ResumeMatchUpgradeClick / ResumeFitViewed` | _fill_ |
| `header_pricing_ctr` | `UpgradePromptClick (surface=header_nav) / unique visitors` | _fill_ |
| `drawer_conversion` | `SubscriptionActivated (browse_limit\|resume_match_quota) / UpgradePromptShown (same)` | _fill_ |
| `overall_upgrade_rate` | `SubscriptionActivated / UpgradePromptClick (all surfaces)` | _fill_ |

---

## Saved search email (pre-fix)

| Metric | Value | Notes |
|--------|-------|-------|
| `event_saved_search_suggestions` job selection | Generic latest jobs (24h) | Fixed in P0.1 |
| Growth email sends last 7d | _fill_ | `GrowthEmailSend` where campaignType = `event_saved_search_suggestions` |

---

## Sign-off

- [ ] Baseline values filled from production analytics
- [ ] Reviewed by growth owner
- [ ] Safe to proceed with staging deploy

**Do not enable production feed flag until this row is checked.**
