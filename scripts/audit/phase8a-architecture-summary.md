# Phase 8A — Architecture Audit Summary

**Generated:** 2026-06-09  
**Status:** Pre-implementation audit (completed before coding)

---

## Surfaces Traced

| Surface | Route | Listing component | Ranking |
|---------|-------|-------------------|---------|
| Home / jobs feed | `/jobs` | `JobsSearchClient` → `JobList` | Server SQL freshness (`postedAt DESC`) |
| SEO slug listings | `/jobs/[...slug]` | Same `JobsSearchClient` | Same pipeline + filters |
| Job detail similar jobs | `/job/[id]` | `SimilarJobsSection` | Client `rankSimilarJobs` |
| Company hub | `/company/[slug]` | `CompanyHubClient` | Latest order via API |

There is **no separate home feed API**. `/jobs` is the primary discovery surface.

---

## Best Insertion Point

**`JobsSearchClient.tsx` → `resultsMain` block, immediately above `<JobList>`**

Why:
- Single client component powers `/jobs` and SEO slug pages
- Auth state (`useAuth`) and resume state (`useResume` via `ResumeProvider`) already available in tree
- Additive render — main feed order, pagination, and load-more unchanged
- Dynamic import (`ssr: false`) avoids bundle/SSR impact for anonymous users

Guard conditions at call site:
```tsx
isResumeFeedPersonalizationEnabled() && isSignedIn
```

Component internally gates on `hasResume` and `candidateFamily !== null`.

---

## Card Reuse

| Component | Path | Used for |
|-----------|------|----------|
| `JobCard` | `components/job/JobCard.tsx` | Full card with `ResumeScorePill` (mobile + desktop) |
| `JobList` | `components/job/JobList.tsx` | Virtualized main feed — **not modified** |
| `SimilarJobsSection` | `components/job/SimilarJobsSection.tsx` | Grid layout reference — carousel differs |

---

## Pagination Interactions

Main feed pagination is **unchanged**:
- `onLoadMore` appends to `listJobs` in server order
- `JobList` virtualizes appended rows
- Recommended section fetches its **own** 100-job pool once on mount — independent of main feed page/offset

---

## APIs Used

| API | Purpose | When called |
|-----|---------|-------------|
| `GET /jobs?limit=100` | Recommendation pool | Signed-in + resume + flag only |
| `GET /account/apply-profile` | `currentTitle`, `resumeStructuredV1`, `applyProfileSummary` | Same conditions |
| `GET /account/resume/text` | `resumeText` for family derivation | Already loaded by `ResumeProvider` |

No new server endpoints. No changes to `GET /jobs` ranking.

---

## Family Derivation (Single Source of Truth)

`deriveCandidateRoleFamily()` from `lib/resumeFitTitle.ts` — same cascade as Resume Fit:
1. `currentTitle`
2. `resumeStructuredV1.experience[].role`
3. `applyProfileSummary.titles[0]`
4. Resume text line heuristics
5. `applyProfileSummary.highlights[0]`

---

## Recommendation Ranking

`getRecommendedJobsForCandidate()` in `lib/recommendedJobsForCandidate.ts`:
- Same family: +100
- Adjacent family: +40 (via existing `titleFitRelation` / `ADJACENT_PAIRS`)
- Sort: boost DESC → freshness DESC
- Limit: 5

Does not modify `scoreResume`, reliability gates, or main feed SQL.

---

## Regression Boundaries

| Boundary | How preserved |
|----------|---------------|
| Anonymous users | Flag off + `isSignedIn` guard + dynamic import |
| SEO / crawlers | No SSR for section; JSON-LD unchanged |
| Main feed order | `JobList` untouched |
| Resume Fit scoring | No changes to scorer modules |
| Users without resume | Component returns null before API calls |
