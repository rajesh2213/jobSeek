# Phase 8 — Feed Personalization UX Design

**Status:** Design only — not implemented  
**Generated:** 2026-06-09

---

## Overview

Add a **"Recommended for your background"** section to the jobs feed for logged-in users with an uploaded resume. The section surfaces same-family and adjacent-family jobs using `candidateFamily` derived from existing resume data, without changing Resume Fit scoring.

---

## Eligibility

| Requirement | Check |
|-------------|-------|
| User is logged in | Clerk session present |
| Resume uploaded | `resumeText` or `resumeFileName` on User |
| `candidateFamily` derivable | `deriveCandidateRoleFamily()` returns non-null family |
| Feature flag enabled | `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION` |

**Not shown when:**
- Anonymous visitor
- No resume uploaded
- `candidateFamily` is null (e.g. `functionalsample.pdf` pattern)
- Feature flag off

---

## Placement

### Primary: Jobs feed (`/jobs`)

Insert **above** the main job list (below search filters / sort controls), as a horizontal scrollable carousel or 3–5 card row.

```
┌─────────────────────────────────────────────────────────┐
│  [Search filters]  [Sort: Latest ▾]                     │
├─────────────────────────────────────────────────────────┤
│  ★ Recommended for your background                      │
│  Based on your software engineering experience          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │
│  │ Job  │ │ Job  │ │ Job  │ │ Job  │ │ Job  │  →      │
│  │ Card │ │ Card │ │ Card │ │ Card │ │ Card │         │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         │
├─────────────────────────────────────────────────────────┤
│  All jobs (latest)                                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Job Card + ResumeScorePill                       │  │
│  └──────────────────────────────────────────────────┘  │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

### Secondary (future): Job detail page

Below similar jobs — "More jobs for your background" using same ranking logic.

---

## Section Header Copy

### Title
**Recommended for your background**

### Subtitle (dynamic by `candidateFamily`)

| candidateFamily | Subtitle |
|-----------------|----------|
| `software.engineering` | Based on your software engineering experience |
| `engineering.backend` | Based on your backend engineering experience |
| `engineering.frontend` | Based on your frontend engineering experience |
| `engineering.devops` | Based on your DevOps experience |
| `engineering.data` | Based on your data engineering experience |
| `engineering.ml` | Based on your machine learning experience |
| `design` | Based on your design experience |
| `product` | Based on your product management experience |
| `marketing` | Based on your marketing experience |
| `sales` | Based on your sales experience |
| `customer_success` | Based on your customer success experience |
| `operations` | Based on your operations experience |
| `finance` | Based on your finance experience |
| `healthcare.clinical` | Based on your healthcare experience |
| `legal` | Based on your legal experience |
| *default* | Based on your professional background |

Implementation: map `RoleFamily` → human-readable label in a small lookup table (client-side, no server change to scoring).

---

## Card Behavior

- Reuse existing `JobCard` component with `ResumeScorePill` enabled
- Cards ordered by: family boost (same > adjacent) → freshness tie-break
- Show 5 cards initially; "See more" expands to 10 or navigates to filtered view
- Each card click → standard job detail page
- Resume Fit pill behaves identically to main feed (scoring unchanged)

---

## Interaction with Main Feed

| Behavior | Design decision |
|----------|----------------|
| Main feed order | **Unchanged** — stays freshness-first |
| Recommended section | Separate ranked slice from same job pool |
| Deduplication | Jobs in recommended section are **excluded** from first page of main feed to avoid repetition |
| Sort toggle | Recommended section persists regardless of latest/salary sort |
| Filters | Recommended section respects active filters (location, remote, etc.) |

**Rationale:** Keeps SEO/crawler paths deterministic; personalization is an additive module, not a replacement ranking.

---

## Empty States

| State | UX |
|-------|-----|
| No same-family jobs in pool | Show adjacent-family jobs with subtitle: "Related roles for your background" |
| No same or adjacent jobs | Hide section entirely (do not show empty carousel) |
| Resume parsing in progress | Hide section; show after `candidateFamily` resolves |

---

## Accessibility

- Section uses `<section aria-label="Recommended for your background">`
- Horizontal scroll: keyboard-navigable with arrow buttons
- Subtitle text is plain language (not raw `candidateFamily` enum)

---

## Analytics Events

Extend existing Resume Fit funnel (`apps/client/lib/analytics/resumeMatchFunnel.ts`):

| Event | Properties |
|-------|-----------|
| `ResumeFeedPersonalizationShown` | `candidate_family`, `job_count`, `same_family_count`, `adjacent_family_count` |
| `ResumeFeedPersonalizationClicked` | `candidate_family`, `job_family`, `job_id`, `position_in_carousel` |
| `ResumeFeedPersonalizationHidden` | `reason` (no_family, no_jobs, flag_off) |

Existing events (`ResumeFitViewed`, `ResumeFitUnavailable`) continue on card interaction — enables before/after availability measurement.

---

## Visual Design Notes

- Subtle left border or star icon to distinguish from main feed
- Muted background (`bg-muted/30`) to separate without heavy chrome
- No badge on individual cards saying "Recommended" — section header provides context
- Mobile: single-column stack or horizontal snap-scroll

---

## Out of Scope (this phase)

- Changing Resume Fit weights, gates, or confidence
- Reordering the main "All jobs" feed (deferred to Phase 9 if carousel proves insufficient)
- Saved jobs / bookmark integration
- Email alert personalization (separate worker change)
