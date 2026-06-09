# Phase 7 — Resume Fit V2 Deployment Checklist

Generated: 2026-06-09  
Status: Pre-deploy audit complete. **Do not deploy until checklist signed off.**

---

## Files Changed (V2 Phases 3–6, uncommitted)

### Core scoring
- `apps/client/lib/resumeScorer.ts` — V2 blend, caps, reliability, cache `v8-taxonomy`
- `apps/client/lib/resumeFitExperience.ts` — Experience fit
- `apps/client/lib/resumeFitSeniority.ts` — Seniority fit + blend
- `apps/client/lib/resumeFitTitle.ts` — Title alignment + Phase 6 taxonomy
- `apps/client/lib/resumeFitReliability.ts` — Reliability gating
- `apps/client/lib/resumeFitGapQuality.ts` — Gap chip sanitization
- `apps/client/lib/resumeFitConfidence.ts` — `very_low` tier
- `apps/client/lib/jobMatchSignals.ts` — Signal resolution
- `apps/client/lib/resumeGradeLabel.ts` — UX copy helpers

### UI
- `apps/client/components/resume/ResumeScorePanel.tsx` — Dimension panels
- `apps/client/components/resume/ResumeScorePill.tsx` — List card scoring + analytics
- `apps/client/components/resume/ResumeMatchSection.tsx` — Detail page scoring + analytics

### Analytics
- `apps/client/lib/analytics/resumeMatchFunnel.ts` — All ResumeFit* events + `ResumeFitUnavailableReason`

### Tests
- `apps/client/lib/resumeFitTitle.test.ts`
- `apps/client/lib/resumeFitSeniority.test.ts`
- `apps/client/lib/resumeFitReliability.test.ts`
- `apps/client/lib/resumeScorer.test.ts`

### Audit scripts (no deploy needed)
- `scripts/audit/resumeFit*.mjs` — Phase 3–7 validation

---

## Pre-Deploy Verification

- [x] Unit tests pass (`npm run test:soft` — 89/89)
- [x] Human Quality Audit — GO
- [x] Real Resume Matrix — GO
- [x] Taxonomy Hardening — GO_WITH_NOTES
- [x] Phase 7 backward compat — PASS
- [x] Phase 7 analytics — PASS
- [x] Phase 7 cache — PASS
- [x] Phase 7 performance — PASS (avg 6.5ms, p95 21.5ms)
- [x] Phase 7 production simulation — PASS (no score/family anomalies)

---

## Rollback Procedure

### Fast rollback (scoring only)
```bash
# Set on client deployment env:
NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS=true
```
Restores legacy keyword scoring. Cache keys partition by `legacy=1` — no collision with V2.

### Full rollback (code revert)
```bash
git revert <v2-commit-sha>
# Restart API + redeploy client
```
Ensure `clearScoreCache()` runs on client load after revert (automatic on resume upload).

### Cache invalidation
- V2 cache prefix: `v8-taxonomy`
- Deploying V2 automatically uses new keys — no stale V1/V2 collision
- Users may see rescore on first fit check post-deploy (session cache empty)

---

## Analytics Verification (post-deploy, first 24h)

Confirm events firing in Meta/events dashboard:

| Event | Expected trigger |
|-------|------------------|
| `ResumeFitViewed` | Scored result displayed |
| `ResumeFitConfidence` | With Viewed |
| `ResumeFitUnavailable` | Unscored result |
| `ResumeFitUnavailableReason` | With Unavailable (family + signals) |
| `ResumeFitExperienceEvaluated` | When experience data present |
| `ResumeFitSeniorityEvaluated` | When seniority data present |
| `ResumeFitTitleEvaluated` | When title families resolved |

**PII check:** No resume text, email, or raw titles in payloads — only `candidate_family` / `job_family`.

---

## Cache Verification (post-deploy)

- [ ] Score same job twice — second call instant (session cache hit)
- [ ] Upload new resume — scores refresh (clearScoreCache on upload)
- [ ] Legacy env flag produces different scores than V2 (if testing rollback)

---

## Monitoring Plan (first 2 weeks)

### Dashboards / alerts

1. **Unavailable rate** — `ResumeFitUnavailable` / (`ResumeFitViewed` + `ResumeFitUnavailable`)
   - Alert if >70% sustained (may indicate gating too aggressive)

2. **Family mismatch top pairs** — group `ResumeFitUnavailableReason` by `candidate_family` + `job_family`
   - Watch for unexpected dominance

3. **Score distribution** — `ResumeFitViewed.score` histogram
   - Alert if >40% cluster in single bucket

4. **False high scores** — manual sample: score ≥80 + `title_fit` < 50
   - Weekly review of `ResumeFitTitleEvaluated`

5. **Performance** — client-side score latency (existing `logResumeFitHydrate` scoreMs)
   - Alert if p95 > 200ms

### Success metrics
- Human-quality reasonable rate ≥90% (weekly audit script)
- Zero gap violations
- Upgrade click rate stable or improved vs pre-V2 baseline

---

## Deploy Sequence

1. Deploy server (no scorer changes on server — client-only scoring)
2. Deploy client with V2 code
3. Verify analytics events in staging/production
4. Monitor unavailable rate for 48h
5. Do **not** enable `NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS` unless rollback needed

---

## Sign-off

| Area | Status |
|------|--------|
| Scoring correctness | ✅ GO |
| Taxonomy | ✅ GO |
| Performance | ✅ GO |
| Analytics | ✅ GO |
| UX | ⚠️ GO_WITH_NOTES |
| Unavailable rate | ⚠️ Monitor (80% in simulation) |

**Overall recommendation: GO_WITH_NOTES**
