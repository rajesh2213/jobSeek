# Phase 7.5 — Unavailable UX Audit

Generated: 2026-06-09

---

## Current Unavailable States

| State | Title | Body |
|-------|-------|------|
| `insufficient_job_signals` | "Fit estimate unavailable" | Job lacks extractable signals / empty listing data |
| `insufficient_evidence` | "Insufficient evidence for a reliable fit estimate" | Generic thin-evidence message + signal count |

**Panel note:** "Re-uploading your resume usually won't change this result for this specific posting."  
**Hint:** "Try another role, or check back on this job later."

---

## Audit Finding: 93.4% of Unavailable = Title Mismatch

Users overwhelmingly hit unavailable because **their career field doesn't match the job** — not because the job lacks data.

Current copy says "not enough for a dependable percentage" — this is **misleading** for title mismatch cases. Users infer:
- Their resume is bad
- The product is broken
- They should re-upload (note says otherwise, but title doesn't reinforce)

---

## Can Users Understand Why Unavailable Happened?

| Cause (actual) | Current copy explains? |
|----------------|------------------------|
| Title/career field mismatch (93%) | **No** — lumped into "insufficient evidence" |
| Low job signal count (5%) | **Partially** — signal count shown in panel |
| Job listing data issue (2%) | **Yes** — specific copy for empty title/description |

**Verdict:** Users cannot distinguish "wrong career field" from "bad data" from "thin posting."

---

## Can Users Understand What To Do Next?

| Current guidance | Adequate? |
|------------------|-----------|
| "Try another role" | Too vague — doesn't say *what kind* of role |
| "Re-upload won't help" | Correct for mismatch but buried in panel note |
| Profile completion CTA | **Missing** |
| Browse filtered jobs CTA | **Missing** |

---

## Recommended Copy (No Internal Scoring Exposure)

### Title mismatch (new primary unavailable type)

**Title:** "This role is in a different career field"

**Body:** "Your background aligns with a different type of work than this posting. Fit scores work best when you check roles in your field."

**Actions:**
- "Browse jobs in your field →" (link to category/filter)
- "Update your current title in profile" (if title missing)

### Thin job signals (keep current, sharpen)

**Title:** "This posting doesn't have enough detail"

**Body:** "We couldn't extract enough requirements from this listing to estimate fit. This is a data issue with the job post—not your resume."

### Low signal match (tier 3/4)

**Title:** "Limited overlap detected"

**Body:** "We found only a few matching signals between your resume and this role. Try a posting with clearer requirements or a closer field match."

---

## UX Principles

1. **Never expose** family names, gates, tiers, or blend weights
2. **Do expose** actionable user concepts: career field, job detail quality, overlap
3. **Separate** "wrong field" from "bad resume" from "bad listing"
4. **Promote** field-aligned browsing over re-upload for mismatch cases

---

## Priority

| Priority | Change | Impact |
|----------|--------|--------|
| P0 | Title-mismatch-specific copy | Addresses 93% of unavailable |
| P1 | "Browse your field" CTA | Reduces perceived brokenness |
| P2 | Profile title completion prompt | Helps null-family resumes |
| P3 | Sharpen thin-signal copy | Addresses remaining 5% |
