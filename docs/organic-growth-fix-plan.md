# Organic Growth Fix Plan — Path to 50K Monthly Visitors

**Prepared:** 2026-07-27
**Status:** Diagnosis complete — see implementation specs for build work
**Scope:** Why indexed pages / impressions / clicks regress once paid promotion stops, and the concrete fix plan toward durable organic growth.
**Implementation specs (authoritative for engineering):**
- [`organic-growth-implementation-spec.md`](./organic-growth-implementation-spec.md) — SEO + social path to **20k monthly visitors in ~30 days**
- [`ats-jobs-expansion-spec.md`](./ats-jobs-expansion-spec.md) — why 7.7% companies have jobs, OpenClaw 403, verified ATS seeding to 1,000 boards

This document is grounded in a direct audit of the production database and the live SEO code path (`apps/client/lib/seoIndexability.ts`, `apps/server/src/services/jobRetentionPolicy.service.ts`, `apps/server/src/workers/jobPurge.worker.ts`, `apps/client/lib/sitemap/*`), not just the Search Console screenshots. Numbers below are real production numbers pulled at audit time.

---

## 1. Root cause: why organic falls off without paid promotion

### 1.1 The core finding

The site's indexed-page ceiling (~817 pages, per GSC) is not an accident or an algorithmic penalty. It is the **structural output of a page-churn rate that is faster than Google's index-and-trust cycle for a young domain.**

Production data (queried directly, 2026-07-27):

| Metric | Value |
|---|---|
| Total job rows ever created | 106,282 |
| Currently active jobs | 28,483 (26.8% of all-time rows) |
| Median job lifespan (`createdAt` → `expiresAt`) | **32.3 days** |
| Jobs on the 21-day ATS TTL (workday/greenhouse/lever/ashby/teamtailor) | 26,657 of 28,483 active (**93.6%**) |
| Jobs on the 45-day non-ATS TTL (remoteok/careers_page/openclaw) | 1,826 of 28,483 active (6.4%) |
| Companies in DB | 12,035 |
| Companies with ≥1 currently active job | **927 (7.7%)** |
| Earliest job record | 2026-04-22 → the domain's real content history is **~13 weeks old** |
| New jobs added, last 7 days | 2,388 (~341/day) |
| Sitemap job cap (`MAX_SITEMAP_JOBS`) | 25,000 — already **below** the 28,483 active/eligible job count |

### 1.2 The causal chain

1. **The domain is ~3 months old.** Google is inherently slow and conservative about indexing and ranking new, unproven domains — this alone would suppress organic performance even with perfect technical SEO.
2. **93.6% of the job inventory expires in 21 days**, then is hard-deleted 14–30 days after that (`jobPurge.worker.ts`). That gives most job detail pages a **total lifespan of roughly 35–50 days** from creation to either `noindex` or outright `404`.
3. Google typically needs **weeks** to discover, crawl, evaluate, and decide to promote a URL into the index on a new/low-authority domain. For the majority of job pages, **the page is noindexed or deleted before Google ever finishes evaluating it.** This is exactly what GSC shows: `Discovered – currently not indexed` (6,728) and `Crawled – currently not indexed` (4,829) dominate the "why pages aren't indexed" report — these are pages caught mid-evaluation when they expire.
4. Because new pages enter and expire at roughly the same rate, **the indexed base cannot compound.** It stays flat near ~800 pages no matter how many new jobs are ingested, because nothing sticks around long enough to accumulate trust.
5. **Company pages — the one page type that could be durable and evergreen — are almost entirely suppressed.** `decideCompanySeoPolicy()` in `apps/client/lib/seoIndexability.ts` unconditionally returns `noindex_company_no_visible_jobs` whenever a company's live job count is 0, regardless of the `SEO_COMPANY_QUALITY_GATE_ENABLED` flag (which is currently `false` in production and, on inspection, doesn't actually gate this check at all — it's dead code; both branches return the same `allow()`). With only 7.7% of companies currently showing an active job, **~11,100 company pages are noindexed at any given moment**, even though a company profile (logo, careers link, Organization schema, historical roles) doesn't need to disappear just because it has zero open roles this week.
6. **Content marketing is minimal** — 3 blog posts total. There is no meaningful evergreen, non-job content engine that could earn backlinks or rank for non-job long-tail queries independent of job churn.
7. **Conclusion:** whatever traffic the site previously saw was almost certainly driven by paid acquisition (ads/social), because the organic system was never structurally capable of compounding. When paid spend stops, traffic reverts to the tiny organic baseline that the churn-dominated, company-page-suppressed, content-thin system can support. This is not a penalty — it's the natural result of an acquisition model that was 100% paid-dependent by construction.

### 1.3 Secondary, compounding technical issues

- **Sitemap job cap (25,000) is already smaller than active inventory (28,483).** At least ~3,300–3,500 currently indexable job URLs are silently excluded from the sitemap today.
- **`SEO_SITEMAP_PRUNING_ENABLED=false`** — stale/expired URLs are not being actively pruned from sitemap generation logic, which can leave dead URLs in sitemaps longer than useful, wasting crawl budget (worth auditing further, see Phase 0).
- **JobPosting structured data is currently healthy** (0 invalid items per GSC) — this is not a contributing cause today and should not be a work focus.
- **Sitemaps are all reading successfully** in GSC — submission mechanics are not the problem either.

---

## 2. Fix plan (phased)

### Phase 0 — This week: stop leaving indexable content on the floor (config/low-risk)

| # | Action | Why | Owner |
|---|---|---|---|
| 0.1 | Raise `SEO_SITEMAP_MAX_JOBS` from 25,000 to at least 30,000 (headroom above current 28,483 active) | Currently ~3,500 real, live, indexable job URLs are excluded from the sitemap by a hardcoded cap | Eng |
| 0.2 | Verify `/api/internal/revalidate/sitemap` fires immediately on job create/expire, not just on the 300s TTL | Reduces the lag between "URL exists" and "URL discoverable," which matters most when pages only live ~32 days | Eng |
| 0.3 | Use GSC's URL Inspection / Indexing API to manually request indexing for the ~1,000 highest-value evergreen pages (top category/skill/location hubs, top 200 companies by job count) | Jump-starts the pages that are actually worth Google's limited crawl trust on a new domain | Growth |
| 0.4 | Audit `SEO_SITEMAP_PRUNING_ENABLED=false` — confirm expired/duplicate URLs aren't lingering in generated sitemaps | Wasted crawl budget compounds the "discovered but not indexed" problem | Eng |

**Expected effect:** small, immediate increase in indexable inventory surfaced to Google; no structural change yet.

### Phase 1 — 2–4 weeks: stop throwing away durable pages (structural fix, highest leverage)

This is the highest-leverage phase because it directly targets the root cause in §1.2.

| # | Action | Why |
|---|---|---|
| 1.1 | **Change company indexability policy.** Stop noindexing a company page purely because `visibleJobCount < 1`. Keep `noindex_company_broken` for genuinely invalid records (missing id/name/slug). For a company with 0 current openings but a valid profile, serve an evergreen page: company profile, "notify me when X hires again," historical role types, similar/related companies. Only fall back to noindex if the company has **never** had any job history at all (i.e., a placeholder/junk record). | Unlocks up to ~11,100 pages that are currently always suppressed by design, not by an accident. This is the single largest lever available — company entities don't churn the way job postings do. |
| 1.2 | **Add a post-expiry SEO grace window for jobs.** Instead of flipping `index: false` the instant `expiresAt` passes, keep the page indexable (clearly labeled "may no longer be accepting applications — see similar live roles") for an additional 10–14 days after expiry. This gives Google's crawl/evaluate cycle a real chance to catch the page at least once before it's demoted. | Median job lifespan is 32 days; Google frequently needs longer than that on a new domain. A short buffer materially raises the odds a page is actually evaluated before it dies. |
| 1.3 | **Replace hard-delete-to-404 with redirect-to-equivalent-hub.** When `jobPurge.worker.ts` is about to hard-delete a job row, 301-redirect its detail URL to the best-matching live hub (same role + location + skill combination, or the company hub) instead of leaving a 404/orphan. | Preserves whatever crawl/link equity a URL accumulated instead of throwing it away; concentrates authority onto durable hub pages rather than losing it entirely. |
| 1.4 | Distinguish **"business TTL"** (when to stop showing an Apply CTA / treat as stale for users) from **"SEO TTL"** (when the URL stops being useful to keep indexable). These do not need to be the same number. | Currently one TTL drives both; decoupling lets you protect SEO equity without misleading users about apply-ability (the page already shows job details either way — timing when to change robots directives is the change). |

**Expected effect:** the indexed-page count should start growing instead of oscillating flat, because company pages compound (they don't expire) and the job-page evaluation window is no longer strictly shorter than the pages' lifespan.

### Phase 2 — 1–3 months: build pages that are inherently durable (compounding organic assets)

| # | Action | Why |
|---|---|---|
| 2.1 | Expand and refresh category/skill/location hub pages (`/jobs/...` slugs). These already have solid indexability logic (`decideJobsListingSeoPolicy`, min-jobs threshold `NEXT_PUBLIC_SEO_MIN_JOBS_INDEX=3`) — the gap is coverage, not policy. Audit which combinations are currently below the 3-job threshold and either backfill inventory in those verticals or merge sparse combinations into a slightly broader hub. | These pages don't expire with any single job — they're the most durable page type already in the codebase. |
| 2.2 | Grow the blog/content program well beyond 3 posts: recurring "who's hiring right now in X" roundups, role-specific salary and negotiation guides, "how to get hired at [top hiring company]" guides tied to real company hub pages (internal linking flywheel), ATS/career-site comparison content. | Non-job evergreen content is what typically earns backlinks for a job board — job listings themselves rarely attract external links. This is currently the thinnest part of the system. |
| 2.3 | Ship at least one genuinely link-worthy free asset — e.g., a public "companies hiring the most this month" leaderboard/dashboard (the `ats-checker-*` audit scripts already in the repo suggest this idea has internal traction). | Free data tools are one of the few content types that reliably earn organic backlinks from blogs/newsletters without paid outreach spend. |
| 2.4 | Strengthen internal linking from job detail pages and category hubs toward company hubs and blog content (footer links, "similar jobs," "about this company" sections already exist — extend them to point at the now-indexable zero-job company pages from 1.1). | Concentrates authority on the pages designed to compound instead of leaving it stranded on pages that are about to expire. |

### Phase 3 — 3–6 months: deliberate backlink acquisition + compounding

| # | Action | Why |
|---|---|---|
| 3.1 | Targeted outreach for 20–50 quality referring domains: career-coaching blogs, university career centers, HR/recruiting newsletters, "best job boards for X" roundup posts. | A ~3-month-old domain has near-zero backlink profile; even a modest number of quality links measurably accelerates trust and ranking velocity. |
| 3.2 | Re-invest content/internal-linking budget into whichever categories show the best impressions→click conversion once Phase 0–2 data comes in (don't spread evenly — concentrate on what's working). | Avoids diluting effort; lets real GSC data (not guesses) drive where to double down. |
| 3.3 | Re-evaluate weekly: indexed-page count, non-branded query share, referring domain count, organic clicks by page type (job vs. company vs. hub vs. blog). | These are the leading indicators that predict whether the 50K/month target is on track, well before total traffic moves. |

---

## 3. Engineering specification

### 3.1 Company indexability policy change

**File:** `apps/client/lib/seoIndexability.ts`

```ts
export function decideCompanySeoPolicy(input: {
  gateEnabled: boolean;
  company: { id?: string | null; name?: string | null; slug?: string | null } | null;
  requestedSlug: string;
  visibleJobCount?: number | null;
  hasEverHadJobs?: boolean | null; // NEW: true if company has ≥1 historical job row
}): SeoPolicyDecision {
  if (!input.company) return noindex("noindex_company_broken");

  const id = input.company.id?.trim() ?? "";
  const name = input.company.name?.trim() ?? "";
  const slug = input.company.slug?.trim() ?? "";
  if (!id || !name || !slug) return noindex("noindex_company_broken");
  if (slug !== input.requestedSlug) return noindex("noindex_company_broken");

  // CHANGED: only noindex on zero jobs if the company has NEVER had a job.
  // A company with historical jobs but zero currently-open roles keeps a
  // durable evergreen profile page instead of flapping in/out of the index.
  if (input.hasEverHadJobs === false) {
    return noindex("noindex_company_no_visible_jobs");
  }

  return allow("allow_company_default");
}
```

- Add `hasEverHadJobs` (or reuse an existing `totalJobsEverSeen` counter if one exists on the `Company` aggregate) to the company loader (`loadCompanyBySlug`) so the policy has the signal it needs.
- Remove the dead `gateEnabled` branch or wire it to something real if a kill-switch is still wanted (e.g., temporarily force the old strict behavior via `SEO_COMPANY_QUALITY_GATE_ENABLED=true` during rollout monitoring).
- Company page copy for the zero-open-roles state should render a clear, honest UI: "No open roles at `{company}` right now — get notified when they hire" + related/similar companies, so the page has real user value and isn't thin/deceptive content.

### 3.2 Job SEO grace window

**Files:** `apps/server/src/services/jobSeoLifecycle.service.ts`, `apps/client/lib/jobLifecycle.ts`

Add a distinct `seoExpiresAt` (or a computed `SEO_GRACE_DAYS` offset applied at read time) separate from the existing `expiresAt` used for business/UX purposes:

```ts
const SEO_GRACE_DAYS = 12;

export function isJobSeoActive(fields: JobSeoLifecycleFields, now: Date = new Date()): boolean {
  if (fields.isActive === false) return false;
  const raw = fields.expiresAt;
  if (raw == null || raw === "") return true;
  const ts = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  if (Number.isNaN(ts)) return true;
  return ts + SEO_GRACE_DAYS * 86_400_000 > now.getTime();
}
```

Mirror the same change in the client `apps/client/lib/jobLifecycle.ts` (`isJobSeoActive`) so both stay in sync per the existing "single source of truth" contract in `freshness.ts`. Keep `isActive` (business/UX "is this really open") on the current, faster TTL — only the SEO/robots decision gets the grace window.

### 3.3 Redirect-on-delete instead of 404

**File:** `apps/server/src/workers/jobPurge.worker.ts`

Before a row is hard-deleted (in `duplicateDeleteBatch` / `canonicalDeleteBatch`), write a lightweight `JobRedirect` record (`fromJobId → toPath`) resolved to the best-matching live hub (role + location + skill slug, else the company hub, else `/jobs`). The client's job detail route (`apps/client/app/(app)/job/[id]/page.tsx`) already calls `notFound()` when `loadJobDetailPage` returns null — extend that path to check the redirect table first and issue a `permanentRedirect()` (301) instead of a hard 404, mirroring the existing `resolveJobAliasRedirectPath` pattern already used for canonical aliases.

### 3.4 Sitemap cap

**File:** `apps/client/lib/sitemap/config.ts`

```ts
export const MAX_SITEMAP_JOBS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_JOBS,
  30000, // was 25000 — raise above current active-job count (28,483) with headroom
  100,
  50000,
);
```

Set `SEO_SITEMAP_MAX_JOBS=30000` (or higher) in the production `.env` immediately as a zero-code-change stopgap while the code default is updated.

### 3.5 Monitoring/instrumentation

Add a lightweight weekly snapshot job (can build on the existing `scripts/audit/production-seo-health-audit.mjs` and `scripts/audit/gsc-crawled-not-indexed-audit.mjs`, which already exist in the repo but are currently uncommitted/unscheduled) that records:

- Indexed page count (from GSC API) vs. known-page count, trended weekly
- Company pages indexed vs. total companies (should climb sharply after §3.1 ships)
- Median/percentile job page lifespan actually observed vs. `SEO_GRACE_DAYS`
- Organic clicks/impressions split by page type: `/job/*`, `/company/*`, `/jobs/*` hubs, `/blog/*`
- Non-branded query share (queries not containing "jobloom")
- Referring domain count (new signal to start tracking — currently not tracked anywhere in the repo)

Commit these two existing audit scripts and wire one into a weekly cron/report rather than leaving them as untracked local files.

---

## 4. Milestones toward 50,000 monthly visitors

Be candid: the domain is ~3 months old with a near-zero backlink profile. A **pure-organic** path to 50K/month in under ~2 months is not realistic no matter what ships — search engines gate ranking velocity on trust signals that take time to accrue regardless of technical correctness. The plan below is phased accordingly; if 50K/month is needed sooner, it will need a blended paid+organic bridge while the organic base compounds.

| Timeframe | Indexed pages (est.) | Monthly organic sessions (est.) | Primary driver |
|---|---|---|---|
| Today | ~817 | low hundreds | Paid-dependent, no compounding base |
| +1 month (Phase 0–1 shipped) | 3,000–6,000 | 1,000–3,000 | Company-page unlock + sitemap/crawl fixes |
| +3 months (Phase 2 underway) | 8,000–15,000 | 5,000–12,000 | Hub-page coverage + content program + internal linking |
| +6 months (Phase 3 underway) | 15,000–30,000 | 15,000–30,000 | Backlinks landing, compounding hub/company/content pages |
| +9–12 months | 30,000+ | **40,000–60,000+** | Full compounding: domain trust matured, durable page base, earned links |

Track progress against the **indexed-page count and non-branded impression share** every week — these are the leading indicators. Total visitor count is a lagging indicator and will look flat for the first several weeks even if the fixes are working correctly.
