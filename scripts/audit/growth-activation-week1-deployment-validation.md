# Growth Activation Week 1 — Deployment Validation

**Validated:** 2026-06-11  
**Commit:** `71e43b1` — feat(growth): Week 1 activation — saved-search email fix and feed analytics

---

## Deploy steps executed

| Step | Result |
|------|--------|
| `git push origin main` | ✅ `9a1c6f1..71e43b1` |
| `npm run build:server` | ✅ TypeScript compile pass |
| `npm run test:unit` (growth email) | ✅ 319 tests pass |
| `sudo deploy/restart-jobseek.sh` | ✅ All services restarted |
| Vercel production (GitHub hook) | ✅ Ready — `jobseek-e9zs6e4ak` → www.jobloom.tech |

---

## Production health checks

| Check | Result |
|-------|--------|
| `https://api.jobloom.tech/health` | **200** `{"status":"ok"}` |
| `http://127.0.0.1:8001/health` (inference) | **200** `model_loaded: true` |
| `jobseek-api.service` | **active** |
| `jobseek-growth-email-worker.service` | **active** |
| `https://www.jobloom.tech/` | **200** |
| `https://www.jobloom.tech/jobs` | **200** |
| Sitemap smoke (`npm run seo:check-sitemap`) | **PASS** (sitemap.xml, companies, jobs, robots) |

---

## Server code verification

Built `apps/server/dist` contains:

- `savedSearchSuggestionsFilters()` in `growthEmail.service.js`
- `savedSearchId` passed from `savedSearch.routes.js` → queue → worker

---

## Client / feed personalization

| Check | Result |
|-------|--------|
| `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION` on Vercel Production | **`=1`** (confirmed via `vercel env pull`) |
| Vercel deployment status | **Ready** (production alias www.jobloom.tech) |
| Carousel in anonymous HTML | Not expected (auth + resume gated) |

**Manual validation required (signed-in user with resume):**

1. Open `/jobs` → confirm "Recommended for your background" section
2. Meta/PostHog: `RecommendedJobsViewed` with `experiment_variant=carousel`
3. Click job → `RecommendedJobClicked` with `surface=recommended_carousel`
4. Check fit → `ResumeFitViewed` with `experiment_variant` + `surface=recommended_carousel`

---

## Saved search email fix

**Manual validation required:**

1. Sign in → save a filtered search (e.g. role + remote)
2. Confirm growth email queue processes with `savedSearchId`
3. Verify email jobs match the saved search filters (not generic latest)

**Automated:** `savedSearchSuggestions.test.ts` passes filter preservation for role/remote and `companyId`.

---

## Rollback (if needed)

```bash
# Client: set NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION=0 in Vercel, redeploy
# Server: git revert 71e43b1 && npm run build:server && sudo deploy/restart-jobseek.sh
```

---

## Week 2 next steps

1. Fill `growth-activation-baseline.md` from PostHog/Meta production data
2. Post-save alert onboarding prompt (Saved Search Phase 1 continuation)
3. Monitor `recommendation_ctr` after ≥500 `RecommendedJobsViewed` (target ≥3%)
