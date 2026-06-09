# Phase 8 — Feed Personalization Rollout Plan

**Status:** Design only — not implemented  
**Generated:** 2026-06-09

---

## Feature Flag

```
NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION
```

| Value | Behavior |
|-------|----------|
| unset / `0` | Off — current freshness-first feed only |
| `1` | On — show "Recommended for your background" section |

**Client-only flag** — no server deploy required for initial carousel. Server-side re-rank (Phase 9) would use a separate `RESUME_FEED_PERSONALIZATION` server env.

**Rollout mechanism:** Percentage rollout via existing feature-flag infra or simple `userId % 100 < threshold` in client when no flag service exists.

---

## Phased Rollout

| Phase | Traffic | Duration | Gate |
|-------|---------|----------|------|
| **0%** | Off | Pre-deploy | Flag unset; baseline metrics collected |
| **10%** | Logged-in users with resume, `candidateFamily != null` | 1 week | No increase in `ResumeFitUnavailable` rate on recommended cards vs main feed |
| **50%** | Same eligibility | 1 week | Availability on recommended section ≥ 25%; no HQ risk regression |
| **100%** | All eligible users | Ongoing | Availability target 40%+ on recommended slice; engagement lift confirmed |

**Eligibility filter (all phases):**
- Authenticated
- Resume uploaded
- `deriveCandidateRoleFamily()` returns non-null
- Feature flag on for user's bucket

**Excluded from all phases:**
- Anonymous users
- SEO/crawler paths
- Users without resume
- `functionalsample.pdf`-class resumes (null family)

---

## Implementation Sequence

### Phase 8a — Client carousel (recommended first ship)

1. Add `NEXT_PUBLIC_RESUME_FEED_PERSONALIZATION` to client env
2. On `/jobs` mount: fetch apply profile → derive `candidateFamily`
3. Fetch job pool (reuse `fetchJobs` with larger limit or dedicated endpoint)
4. Client-side rank: Scenario B boosts (same +100, adjacent +40) with freshness tie-break
5. Render carousel above main feed; dedupe from page 1
6. Emit analytics events

**Estimated complexity:** Medium (3–5 client files, no scoring changes)

### Phase 8b — Server post-fetch re-rank (optional follow-up)

1. Hook in `runMeteredJobsList` for auth users
2. Apply family boost to page slice
3. Keep anon/SEO paths untouched

**Estimated complexity:** Medium-high (server + cache invalidation concerns)

---

## Success Metrics

### Primary (availability)

| Metric | Baseline (Phase 7.5) | Target (Phase 8) | Measurement |
|--------|---------------------|------------------|-------------|
| Blended availability | 19.9% | Maintain (no regression on main feed) | `ResumeFitViewed / (ResumeFitViewed + ResumeFitUnavailable)` |
| Recommended section availability | ~2.3% (top-100 baseline) | **40–60%** | `ResumeFitViewed` on carousel cards only |
| `ResumeFitUnavailable` rate | 80.1% overall | ↓ on recommended cards | Segment by `surface=recommended` |

### Secondary (engagement)

| Metric | Baseline | Target | Source |
|--------|----------|--------|--------|
| Resume uploads | Current rate | +10–20% | Upload events post-rollout |
| Job applications | Current rate | +15–25% from recommended | Application funnel |
| Session depth (jobs viewed) | Current | +20–30% for flag-on users | Page view analytics |
| Upgrade conversion | Current | +25–40% impressions | `ResumeFitViewed` → upgrade CTA |

### Guardrail (quality)

| Metric | Threshold | Action if breached |
|--------|-----------|-------------------|
| False-high scores (≥80 on cross-domain) | < 2% | Roll back to 10% |
| Human quality risk (score ≥75 on mismatch) | < 3% | Roll back to 10% |
| Main feed availability | No decrease | Pause rollout |
| Page load latency (carousel) | < 200ms added | Lazy-load carousel |

---

## Monitoring Dashboard

Track daily during rollout:

```
ResumeFitViewed          (by surface: main | recommended)
ResumeFitUnavailable     (by surface: main | recommended)
ResumeFitUnavailableReason (title_mismatch % on recommended should drop)
ResumeFeedPersonalizationShown
ResumeFeedPersonalizationClicked
Resume uploads (7-day rolling)
Applications (7-day rolling)
Upgrade CTA impressions
```

**Segment by:** `candidate_family`, rollout bucket (10/50/100), resume presence.

---

## Rollback Plan

| Trigger | Action |
|---------|--------|
| Recommended section HQ risk > 3% | Set flag to `0` (instant) |
| Main feed latency p95 +50% | Disable carousel fetch |
| Negative user feedback / support tickets | Pause at current % |
| Availability on recommended < 15% at 50% | Investigate job pool size before rollback |

Rollback is instant — client flag off restores current behavior with no data migration.

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Resume Fit V2 deployed | ✅ Done | Do not modify scoring |
| `deriveCandidateRoleFamily` | ✅ Ready | 83.3% coverage (N=6) |
| `deriveJobRoleFamily` | ✅ Ready | 100% job coverage |
| Apply profile API | ✅ Exists | `fetchApplyProfile()` includes `resumeStructuredV1` |
| Feature flag infra | ⚠️ Client env only | Percentage rollout needs simple hash or flag service |
| Dedicated API endpoint | Optional | Can client-rank from existing `fetchJobs` response |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Small same-family pool for niche resumes (marketing) | Medium | Fall back to adjacent; hide if empty |
| Carousel duplicates main feed jobs | Low | Dedupe page 1 |
| SEO impact | None | Section auth-only; main feed unchanged |
| Stale recommended jobs | Low | Freshness tie-break within boosted set |
| functionalsample-class null family | Low | Hide section; 16.7% of current sample |

---

## Timeline Estimate

| Week | Activity |
|------|----------|
| 1 | Implement carousel (Phase 8a); 0% deploy |
| 2 | 10% rollout; monitor metrics |
| 3 | 50% rollout if guardrails pass |
| 4 | 100% rollout; evaluate Phase 8b server re-rank |
