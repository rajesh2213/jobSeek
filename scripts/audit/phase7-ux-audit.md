# Phase 7 — Conversion UX Audit

Generated: 2026-06-09

Components reviewed: `ResumeScorePill`, `ResumeMatchSection`, `ResumeScorePanel`

---

## Can users understand why they scored high?

**Partially yes (Pro users); limited for free users.**

| Surface | High-score explanation |
|---------|------------------------|
| **ResumeScorePanel** | Grade label ("Strong fit"), confidence line, Experience/Seniority/Title sub-panels with percentages |
| **ResumeMatchSection** | Subtitle + confidence line; Pro sees matched/gap counts |
| **ResumeScorePill** | Score % or "Low-confidence estimate" label only on card |

**Strengths:**
- Phase 4–6 sub-panels (Experience, Seniority, Title Alignment) give dimensional breakdown
- Confidence tier explained via `resumeFitConfidenceLine()`
- Low-confidence tier 4 jobs get explicit "Based primarily on job title" warning

**Gaps:**
- Free users see overall score but blurred keyword chips — no explanation of *which* dimensions drove the high score
- No plain-language summary (e.g. "Strong skills match + aligned title")
- Sub-panels show raw percentages without explaining how they combine into final score

---

## Can users understand why they scored low?

**Partially yes (Pro); weak for free.**

| Surface | Low-score explanation |
|---------|----------------------|
| **ResumeScorePanel** | Gap chips with suggestions (Pro); experience gap cap warning; grade "Needs work" |
| **ResumeMatchSection** | Grade subtitle only |
| **ResumeScorePill** | Score % only |

**Strengths:**
- Pro gap chips include `Try: "suggestion"` tooltips
- Experience gap cap panel explains year mismatch
- "Copy missing keywords" CTA (Pro)

**Gaps:**
- Free users see gap *count* but not *which* gaps — weak motivation to improve
- No guidance on whether low score is skills vs experience vs title vs seniority without opening panel
- Title mismatch cap (45%) not surfaced in UI copy

---

## Can users understand why unavailable happened?

**Partially — copy exists but lacks specificity.**

| State | Copy | Clarity |
|-------|------|---------|
| `insufficient_job_signals` | "We couldn't extract enough job signals…" | Good — explains listing data issue |
| `insufficient_evidence` | "Insufficient evidence for a reliable fit estimate" + signal count | Moderate — doesn't explain *why* (family mismatch, thin signals, tier 3) |
| Empty title/description | Specific copy for data issue | Good |

**Gaps:**
- No distinction between "wrong career field" vs "thin job posting" vs "resume title not detected"
- `resumeMatchInsufficientPanelNote`: "Re-uploading won't change this" — correct for signals but may confuse users with wrong title family
- No CTA for unavailable beyond "Try another role" — missed opportunity to suggest profile completion

---

## Can users understand what to improve?

| Tier | Improvement guidance |
|------|---------------------|
| **Pro + scored** | Gap suggestions, copy-missing-keywords, re-upload resume |
| **Free + scored** | Score only; upgrade CTA for breakdown |
| **Unavailable** | "Try another role" hint only |

**Gaps:**
- No actionable checklist for unavailable users (add current title, complete profile)
- Experience/Seniority sub-panels don't suggest *actions* (only show numbers)
- No link to Smart Apply or profile editor from fit panel

---

## Flagged Issues

### Missing explanations
1. Final score blend formula not explained anywhere in UI
2. Title mismatch cap invisible to user
3. Unavailable due to cross-family mismatch not explained

### Confusing wording
1. "Low-confidence estimate" vs "Insufficient evidence" — similar tone, different causes
2. "Fit estimate unavailable" used for both `insufficient_job_signals` and generic fallback
3. Free tier message: "keyword breakdown and semantic matching are Pro features" — doesn't mention dimensional breakdown is visible

### Weak CTA opportunities
1. Unavailable state: add "Complete your profile" / "Add current job title"
2. Low score: add "See what to improve" paywall with dimension preview (not just keyword blur)
3. High score: add "Apply now" or "Save job" conversion hook

---

## UX Verdict

**Adequate for Pro power users; needs improvement for free users and unavailable states.**

Priority post-deploy UX fixes (no implementation in Phase 7):
1. Unavailable reason-specific copy (family mismatch vs thin signals)
2. Free-tier dimension summary (skills/experience/title scores without keyword chips)
3. Surface title mismatch cap when applied
