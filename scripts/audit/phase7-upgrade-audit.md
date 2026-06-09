# Phase 7 — Upgrade Funnel Audit

Generated: 2026-06-09

---

## Current Free User Journey

```
Upload Resume (ResumeUploadModal)
  → Check Fit (ResumeScorePill on list / ResumeMatchSection on detail)
  → View Result (score % visible to all tiers)
  → Upgrade CTA (blurred breakdown, semantic quota, gap analysis)
```

---

## V2 Improvements to Upgrade Motivation

| V2 Feature | Upgrade impact |
|------------|----------------|
| **Dimensional breakdown** (Experience, Seniority, Title) | Visible to all tiers in panel — *reduces* keyword-only paywall urgency but increases trust |
| **Confidence tiers** | "Low-confidence estimate" label creates curiosity about full breakdown |
| **Reliability gating** | 80% unavailable on diverse resume×job matrix — users may perceive product as broken, *hurting* conversion |
| **Gap quality** | Cleaner gap chips (Pro) — higher perceived value when unlocked |
| **Taxonomy hardening** | More credible scores — users trust score enough to want details |

**Net assessment:** V2 improves score *credibility* (motivates Pro for "why") but high unavailable rate risks *abandonment* before upgrade CTA.

---

## Existing Upgrade Surfaces

| Surface | Trigger | CTA |
|---------|---------|-----|
| `resume_score_panel_working` | Free user opens panel | "Upgrade to Pro →" (blurred chips) |
| `resume_score_panel_gaps` | Free user sees gap count | "Upgrade to Pro →" |
| `resume_score_pill_semantic` | AI quota exhausted | "Upgrade for semantic matching" |
| `resume_match_section_semantic` | AI quota exhausted | "Upgrade for semantic matching →" |
| `resume_score_pill_drawer` / `resume_match_section_drawer` | Preview breakdown | "Details (Pro) →" |

---

## Recommendations (audit only — do not implement)

### Option A: Keep current ✅ Recommended for launch

**Rationale:**
- Pro gating unchanged; free users still see score
- V2 dimensional panels visible without upgrade — builds trust
- Blurred keyword breakdown remains primary paywall
- Lowest deployment risk

**Risk:** Unavailable users never reach upgrade CTA.

---

### Option B: Add fit breakdown paywall

Show dimension scores (skills/experience/seniority/title) to free users but gate keyword chips and suggestions.

**Pros:** More upgrade hooks without hiding score  
**Cons:** Already partially implemented — panels are open; would need to gate sub-panels  
**Priority:** Medium (post-launch A/B)

---

### Option C: Add missing-skill insights paywall

Free users see top 3 gap keywords (not full list) with "Unlock all N gaps with Pro."

**Pros:** Strongest conversion hook for low-score users  
**Cons:** Requires UI change; may feel too aggressive  
**Priority:** High for conversion optimization sprint

---

### Option D: Add fit-history paywall

Track fit scores over time; Pro sees history and trends.

**Pros:** Retention feature  
**Cons:** New backend work; not needed for launch  
**Priority:** Low (future feature)

---

## Upgrade Funnel Verdict

**Keep current gating for launch.** Monitor `ResumeMatchUpgradeClick` by surface post-deploy.

Post-launch priority: Option C (partial gap preview) to convert low-score free users who currently only see a count.

Watch: unavailable rate impact on funnel — if >50% of fit checks return unavailable, add profile-completion CTAs before upgrade CTAs.
