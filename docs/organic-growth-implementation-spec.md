# Organic Growth Implementation Spec

**Prepared:** 2026-07-27  
**Status:** Implementation-ready  
**Companion:** [`organic-growth-fix-plan.md`](./organic-growth-fix-plan.md) (diagnosis), [`ats-jobs-expansion-spec.md`](./ats-jobs-expansion-spec.md) (supply side)  
**Near-term visitor goal:** **≥20,000 monthly visitors within ~30 days** via **paid/social + SEO fixes** (not pure organic alone).  
**Longer-term goal:** compounding toward 50k+/mo organic.

---

## 0. Honest constraint for the 20k / 30-day goal

The domain is ~13 weeks old, indexed base is ~817 pages, and last-28-day GSC clicks were essentially zero without paid. **SEO alone cannot deliver 20k visitors in 30 days.**

Required blend:

| Channel | Role in next 30 days | Rough share of 20k |
|---|---|---|
| Instagram / TikTok / YouTube / Reddit / Facebook | Demand generation to durable landing pages | **70–85%** |
| SEO fixes (indexability, sitemaps, company pages) | Raise conversion of that traffic + start compounding | **15–30%** |
| ATS inventory expansion | Make landings feel stocked / trustworthy | Prerequisite |

If social posts deep-link only to ephemeral `/job/{uuid}` pages that expire in 21 days, paid/social spend will also “fall off” after posts age — same structural failure as organic. **All campaigns must land on durable URLs.**

---

## 1. Implementation backlog (ordered)

### Phase 0 — Config / ops (same week)

| ID | Change | File / surface | Spec |
|---|---|---|---|
| OG-0.1 | Raise sitemap job cap to ≥30k | `.env` `SEO_SITEMAP_MAX_JOBS=30000` + default in `apps/client/lib/sitemap/config.ts` | Must exceed active inventory (~28.5k+) |
| OG-0.2 | Confirm sitemap revalidation on job create/expire | `jobSeoCacheInvalidation.service.ts` → `/api/internal/revalidate/sitemap` | Log hit rate; no silent failures |
| OG-0.3 | GSC Indexing API: request index for top 500 hubs + top 200 companies | Growth ops | Track acceptance in GSC |
| OG-0.4 | Audit `SEO_SITEMAP_PRUNING_ENABLED=false` | sitemap generate path | Either enable pruning or document why not |

### Phase 1 — Structural SEO (highest leverage, days 1–14)

#### OG-1.1 Company indexability unlock

**File:** `apps/client/lib/seoIndexability.ts` → `decideCompanySeoPolicy`

**Current bug/behavior:** `visibleJobCount < 1` → `noindex_company_no_visible_jobs`. `gateEnabled` is dead code.

**New contract:**

```ts
export function decideCompanySeoPolicy(input: {
  company: { id?: string | null; name?: string | null; slug?: string | null } | null;
  requestedSlug: string;
  visibleJobCount?: number | null;
  /** true if company ever had ≥1 Job row */
  hasEverHadJobs?: boolean | null;
}): SeoPolicyDecision {
  // broken record → noindex
  // hasEverHadJobs === false → noindex (junk / never-hired placeholder)
  // else → allow (including visibleJobCount === 0)
}
```

**Loader change:** `loadCompanyBySlug` must return `hasEverHadJobs` (cheap `EXISTS` on `Job`).

**UI change:** zero-open-roles company page must show:
- Honest empty state (“No open roles right now”)
- Email/notify capture
- Related companies + role hubs (internal links)

**Acceptance:**
- Companies with historical jobs but 0 open roles emit `robots: index,follow`
- GSC “Excluded by noindex” for `/company/*` trends down over 2–4 weeks
- Indexed company pages rise (leading indicator)

#### OG-1.2 Job SEO grace window

**Files:**  
- `apps/server/src/services/jobSeoLifecycle.service.ts`  
- `apps/client/lib/jobLifecycle.ts`  
- job detail page copy when expired-but-grace

**Rule:**

```ts
const SEO_GRACE_DAYS = Number(process.env.SEO_JOB_GRACE_DAYS ?? "12");
// isJobSeoActive = !inactive && (expiresAt + grace) > now
// business Apply CTA still uses real expiresAt / isActive
```

**Acceptance:** expired jobs within grace remain indexable; UI labels them as possibly closed + links similar live roles.

#### OG-1.3 Redirect on purge instead of hard 404

**Files:**  
- new `JobRedirect` table (or Redis + DB)  
- `jobPurge.worker.ts` writes redirect before delete  
- `app/(app)/job/[id]/page.tsx` checks redirect before `notFound()`

**Target resolution order:** same role+location hub → company hub → `/jobs`.

**Acceptance:** purged job URLs return **301**, not 404; GSC 404 count does not spike after purge runs.

#### OG-1.4 Decouple business TTL vs SEO TTL

Document in code + env:
- `JOB_BUSINESS_TTL_DAYS` (Apply CTA / “open” badge) — keep current ATS 21 / other 45  
- `SEO_JOB_GRACE_DAYS` — additive buffer for robots/index only  

### Phase 2 — Durable content & hubs (days 7–30)

| ID | Work |
|---|---|
| OG-2.1 | Expand high-intent hub coverage for roles that social will promote (remote SWE, product, data, design, customer success) |
| OG-2.2 | Ship ≥8 new blog/guides that link into hubs + companies |
| OG-2.3 | One linkable free asset (e.g. “companies hiring most this week”) |
| OG-2.4 | Footer/internal linking from job detail → company → hubs |

### Phase 3 — Authority (days 30–90)

Backlink outreach, concentrate on best-converting categories from GSC + social landing data.

---

## 2. Social / paid acquisition spec (for 20k / 30 days)

### 2.1 Landing URL policy (non-negotiable)

| Allowed campaign destinations | Forbidden as primary CTA |
|---|---|
| `/jobs/{canonical-slug}` hubs | Random `/job/{uuid}` only |
| `/company/{slug}` with open roles | Expired job deep links |
| Marketing pages: `/`, Smart Apply, blog posts that link to hubs | Filter URLs with `noindex` |

UTM standard:

```
utm_source=instagram|tiktok|youtube|reddit|facebook
utm_medium=social|paid_social|organic_social
utm_campaign=YYYYMM_channel_theme
utm_content=creative_id
```

### 2.2 Channel plan (minimum viable)

| Channel | Cadence (30 days) | Content angle | Primary CTA |
|---|---|---|---|
| TikTok | 4–7 posts/week | “Jobs hiring this week at X”, screen-record apply flow | Hub or company page |
| Instagram Reels + Stories | 4–7/week | Same + carousel of top roles | Hub |
| YouTube Shorts | 3–5/week | Longer “how to find jobs before LinkedIn” | Blog → hub |
| Reddit | 3–5 value posts/week (no spam) | Niche career subs; answer first, soft link | Hub / blog |
| Facebook | 3–5/week + optional boosts | Retarget site visitors | Hub |

### 2.3 Funnel math sketch for 20k monthly visitors

Assumptions (tune with real analytics):

| Step | Conservative | Aggressive |
|---|---|---|
| Social impressions | 800k | 2.0M |
| CTR to site | 1.5% | 2.5% |
| Sessions | 12k | 50k |
| Returning + SEO lift | +3–8k | +5–15k |

**Implication:** ~1–2M social impressions with ~1.5–2% CTR is the realistic path to 20k sessions in month 1, while SEO is still warming up.

### 2.4 Product readiness for social traffic

Before scaling spend/posts:

1. Landing hubs must show **fresh job counts** (ATS expansion feeds this).  
2. Browse-cap / upgrade UX must not soft-block first-time visitors aggressively on first job view (kills paid CTR→activation).  
3. PostHog events: `landing_view`, `job_list_view`, `job_detail_view`, `apply_click`, with UTM props.  
4. Weekly dashboard: visitors by `utm_source`, bounce, apply CTR, signup.

### 2.5 KPI tree (track weekly)

| KPI | Week 1 | Week 2 | Week 4 |
|---|---|---|---|
| Total sessions (GA/PostHog) | 3k | 8k | **20k / month run-rate** |
| Indexed pages (GSC) | ≥1.2k | ≥2.5k | ≥4k |
| Non-branded impressions | rising | rising | ≥3× baseline |
| Companies with active jobs | ≥1.1k | ≥1.4k | ≥1.8k |
| Social → Apply CTR | ≥8% | ≥10% | ≥12% |

---

## 3. Test plan (engineering)

| Test | Expected |
|---|---|
| Unit: `decideCompanySeoPolicy` historical-but-empty → index | pass |
| Unit: never-had-jobs → noindex | pass |
| Unit: `isJobSeoActive` within grace → true; after grace → false | pass |
| Unit: purge writes redirect; job route 301 | pass |
| Integration: sitemap includes >25k jobs when env raised | pass |
| Manual: GSC URL Inspection on 10 unlocked company pages | “Indexing allowed” |
| Manual: social UTM landings hit hubs, not 404 | pass |

---

## 4. Rollout sequence (recommended)

1. **Day 0–2:** OG-0.1 sitemap cap; ATS batches continue; social landing URL sheet locked.  
2. **Day 2–7:** Ship OG-1.1 company indexability + empty-state UI; start social posting to hubs.  
3. **Day 7–14:** OG-1.2 grace window + OG-1.3 redirects; raise social cadence.  
4. **Day 14–30:** Content hubs + measure; double down on best `utm_campaign` creatives.  
5. **In parallel:** OpenClaw subscription fix (optional upside, not blocker).

---

## 5. Definition of success (30 days)

- [ ] ≥20,000 sessions in the trailing 30 days (or clear run-rate by day 28)  
- [ ] ≥70% of social traffic lands on durable hubs/companies (not expired jobs)  
- [ ] Indexed pages ≥3× current (~817 → ≥2.5k)  
- [ ] Companies with active jobs ≥1.5k  
- [ ] GSC “Excluded by noindex” for companies trending down  
- [ ] OpenClaw either fixed or explicitly parked (`SYNC_ENABLED=false`)
