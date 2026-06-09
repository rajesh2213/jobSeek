# Phase 7.5 — Business Impact (Directional)

Generated: 2026-06-09  
**Directional analysis only — not measured, not a forecast model.**

---

## Baseline (Current V2)

| Metric | Value |
|--------|-------|
| Availability | **19.9%** |
| Unavailable | **80.1%** |
| Dominant cause | Title mismatch (93.4% of unavailable) |
| Human Quality | GO (0 false-high, 0 HQ risk at current gating) |

---

## Scenario Modeling

Recovery simulation (same 3,000 evaluations, no scoring changes):

| Scenario | Availability | False-high | HQ risk |
|----------|-------------|------------|---------|
| **A — Current** | 19.9% | 0.00% | 0.00% |
| **B — Score + mismatch warning** | 94.7% | 0.00% | 0.74% |
| **C — Score + very_low confidence** | 95.0% | 0.00% | 0.81% |
| **D — Skills ≥70 only** | 20.4% | 0.00% | 0.00% |
| **Feed personalization** (est.) | 40–60% | <1% | <2% |

---

## If Availability Rises to 20% → 40% → 60%

Assumptions:
- Fit checks correlate with jobs browsed
- Unavailable results reduce repeat checks and session depth
- Score visibility drives upgrade curiosity (breakdown paywall)
- Human Quality GO maintained (false-high <2%, HQ risk <3%)

### Fit Checks (directional)

| Availability | Est. change | Rationale |
|-------------|-------------|-----------|
| **20%** (current) | Baseline | 80% of checks return dead-end unavailable |
| **40%** | **+50–80%** more meaningful checks | Users see scores on ~2× jobs; less "broken" bounce |
| **60%** | **+100–150%** | Majority of checks produce actionable output |

Feed personalization to 40% without relaxing gates is achievable by surfacing same/adjacent-family jobs (currently only **2.2%** same-family in top 100 feed).

### Resume Uploads (directional)

| Availability | Est. change | Rationale |
|-------------|-------------|-----------|
| **20%** | Baseline | Upload motivation tied to perceived fit value |
| **40%** | **+10–20%** | Users who get scores return and upload tailored resumes |
| **60%** | **+20–35%** | Fit becomes reliably useful across browsing session |

Unavailable-heavy experience suppresses word-of-mouth and repeat uploads (Seán: 100% unavailable on marketing resume vs engineering feed).

### Upgrades (directional)

| Availability | Est. change | Rationale |
|-------------|-------------|-----------|
| **20%** | Baseline | Upgrade CTA only reached on 20% of checks |
| **40%** | **+25–40%** upgrade impressions | More users see score → want breakdown |
| **60%** | **+50–70%** upgrade impressions | Score + dimension panels drive Pro curiosity |

**Caveat:** Scenario B/C raise availability to ~95% but add 0.74–0.81% HQ risk — monitor conversion *quality*, not just volume.

---

## Revenue Quality vs Quantity

| Path | Availability | Upgrade volume | Trust risk |
|------|-------------|----------------|------------|
| Relax all gates (C) | 95% | Highest | Medium — cross-domain scores visible |
| Mismatch warning (B) | 95% | High | Low — 0% false-high |
| Feed personalization | 40–60% | Moderate | **Lowest** — scores on relevant jobs |
| Current | 20% | Lowest | None |

**Best business outcome:** Feed personalization + mismatch-specific UX (hybrid) — raises availability on *relevant* jobs without flooding users with cross-domain scores.

---

## Key Insight

80% unavailable is **not** primarily a model calibration problem. It is a **user-job alignment** problem:

- Feed is **75.6% cross-domain** vs candidate families
- Only **2.2%** same-family jobs in top 100 listings
- Reliability gate correctly blocks misleading cross-domain percentages

Improving availability without hurting trust means **showing users the right jobs**, not **lowering the bar on wrong jobs**.
