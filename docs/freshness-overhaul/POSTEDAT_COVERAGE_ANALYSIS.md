# TRUE `postedAt` Coverage — Deep Analysis & Architecture Design

**Status:** Analysis + design only. No implementation, no schema changes, no migrations, no data mutations, no ranking/JSON-LD behaviour changes.

**Date:** 2026-05-12

**Author:** post-merge audit of `feat/freshness-integrity-overhaul`

> Core thesis: this initiative is about *trusted freshness provenance*, not inflated coverage. Every recovery path must be (a) high-confidence semantically, (b) low-risk operationally, and (c) verifiable per-row. We will gladly leave a job DISCOVERED rather than fake a publish date.

---

## Executive summary

| Layer | Current state | Best-case after this initiative (analysis only) |
|---|---|---|
| Canonical active jobs | 93,283 | unchanged |
| TRUE `postedAt` coverage | 22.0% | **65–80%** achievable via additive parser fixes (no contamination) |
| Largest single gap | Workday (63k jobs, 0% coverage) | Recoverable via existing Workday CXS *detail* endpoint (`jobPostingInfo.startDate`) — provider-supplied ISO date |
| Largest single contamination | Greenhouse uses `updated_at` for `postedAt` (8,432 rows) | Recoverable via existing Greenhouse Job Board API field `first_published` — same response, no extra request |
| Smallest fix, biggest leverage | Ashby parser reads non-existent fields | Parser checks `postedDate ?? createdAt`; Ashby actually returns `publishedAt`. 0% → ~95% recovery on all 5,426 rows |

These three findings alone could safely move us from **22% → ~65% TRUE coverage** with **zero new infrastructure**, zero ranking changes, zero schema changes, and zero contamination risk. They are *additive parser bugs*, not new heuristics.

---

## 1. Provider opportunity matrix

Empirical evidence collected on **2026-05-12 ~19:30 UTC** against live production DB and live ATS endpoints. Numbers are real.

### 1.1 Coverage breakdown (canonical, active, status=ready)

| source | total | postedAt | postedAt % | Current field used | Semantic quality |
|---|---:|---:|---:|---|---|
| workday | 63,210 | 0 | **0.0%** | `job.postedOn` (list API, a string label) | Field is unparseable label like "Posted Today" |
| lever | 12,032 | 12,032 | 100.0% | `job.createdAt` (epoch ms) | ✓ TRUE publish date (Lever creation) |
| greenhouse | 8,403 | 8,403 | 100.0% | `job.updated_at` | ✗ **Contaminated — last edit, not first publish** |
| ashby | 5,426 | 0 | **0.0%** | `job.postedDate ?? job.createdAt` | ✗ Both fields are undefined in API; real field is `publishedAt` |
| careers_page | 4,331 | 17 | 0.4% | Various HTML scraping fallbacks | Generic, low-value |
| remoteok | 114 | 114 | 100.0% | `row.date` | ✓ TRUE feed date |
| openclaw | 6 | 6 | 100.0% | `postedAt ?? createdAt ?? publishedAt ?? datePosted` | ✓ Manual ingestion contract |
| teamtailor | 5 | 3 | 60.0% | `published_at ?? start_date ?? created_at` | ✓ Mostly correct |
| (no rows) | — | — | — | bamboohr/jobvite/rippling/smartrecruiters/workable parsers exist but no current companies use them | — |

**Concentration**: ~67% of all canonical active jobs are Workday rows. ~22% are Lever + Greenhouse. The remaining ~11% is fragmented across long-tail sources.

### 1.2 Contamination evidence (Greenhouse `updated_at`)

`updated_at` is not a publish date. A snapshot of the delay between `postedAt` (= `updated_at`) and our crawl-time `createdAt`:

| source | n | avg delay (hours) | min | max | rows where createdAt < postedAt |
|---|---:|---:|---:|---:|---:|
| lever | 12,564 | 3,299.3 (137d) | −0.8 | 143,627 (16y) | 17 (rounding) |
| greenhouse | 8,432 | **503.9 (21d)** | 0.0 | 15,574 | 0 |

The 21-day average gap for Greenhouse means `updated_at` is drifting forward over time (admins editing listings); a true first-publish date would correlate tightly with our crawl-time `createdAt`. The first job in the corpus has `postedAt = 2024-07-24` — over a year before it appeared in our index. This is a textbook "moving update timestamp" pattern.

The Greenhouse Job Board API **does** expose `first_published` in the same response (verified against Airbnb's public board):

```json
{
  "updated_at":      "2026-02-24T09:25:19-05:00",  // ← what we currently use
  "first_published": "2026-02-24T09:04:33-05:00",  // ← TRUE publish date (21 minutes earlier)
  // ... full key list: absolute_url, application_deadline, company_name, content,
  // data_compliance, departments, first_published, id, internal_job_id, language,
  // location, metadata, offices, requisition_id, title, updated_at
}
```

This is a one-character parser change to **eliminate contamination on 8,432 rows** with no new requests, no new failure modes, and a measurable confidence improvement.

### 1.3 Ashby root cause

The Ashby parser at `apps/server/src/modules/ats/ashby/ashby.parser.ts:69` reads `job.postedDate ?? job.createdAt`. Neither field exists on the public Ashby Job Board API. The actual field name is `publishedAt`. Verified against the `davidenergy` board:

```json
{
  "address": {...},
  "applyUrl": "...",
  "department": "...",
  "descriptionHtml": "...",
  "descriptionPlain": "...",
  "employmentType": "FullTime",
  "id": "...",
  "isListed": true,
  "isRemote": false,
  "jobUrl": "...",
  "location": "...",
  "publishedAt": "2026-03-20T21:20:18.134+00:00",   // ← real publish date, NOT extracted
  "secondaryLocations": [],
  "team": "...",
  "title": "..."
}
```

This is a parser bug. Coverage rises from 0% → ~95–100% on all 5,426 Ashby rows with no new requests.

### 1.4 Workday: largest opportunity, lowest current coverage

Two-layer issue. The list endpoint (`POST /wday/cxs/{tenant}/{board}/jobs`) returns:

```json
{
  "title": "Engineer, Supply Chain",
  "externalPath": "/job/.../Engineer_R-243483",
  "locationsText": "...",
  "bulletFields": [...],
  "postedOn": "Posted Today"   // ← STRING LABEL, not a date
}
```

The current parser does `new Date("Posted Today")` → `NaN` → undefined → 0% coverage.

**But the Workday CXS *detail* endpoint** (`GET /wday/cxs/{tenant}/{board}/job/{externalPath}`) returns:

```json
{
  "jobPostingInfo": {
    "title": "...",
    "jobPostingId": "..._R-243483",
    "externalUrl": "https://amgen.wd1.myworkdayjobs.com/Careers/job/...",
    "startDate": "2026-05-12",  // ← TRUE ISO publish date
    "endDate": null,
    "postedOn": "Posted Today",
    "remoteType": "...",
    "timeType": "...",
    "country": "...",
    "location": "...",
    "jobDescription": "<...>"
  }
}
```

Tested across 5 tenants: **5/5 return a parseable `jobPostingInfo.startDate`**. This is provider-supplied, structured, ISO-formatted, and not a crawl artifact.

Additionally, **4/12 Workday tenants** (33%) also emit `<script type="application/ld+json">` JobPosting with `datePosted` on the public detail HTML. So Workday has *two* independent paths to a true publish date:

1. **Workday CXS detail endpoint `jobPostingInfo.startDate`** — primary, structured, JSON, ~95% coverage expected
2. **Workday public detail HTML JSON-LD `datePosted`** — secondary fallback, ~33% coverage of tenants we sampled

The first path is the safe one: same auth model as the existing crawler, same rate limits, exactly one extra request per job (which we already do for detail enrichment on many other ATS types).

### 1.5 Long-tail providers (not currently producing canonical rows)

The codebase has parsers for **BambooHR, Jobvite, Rippling, SmartRecruiters, Workable, Teamtailor** but the production corpus has 0 (or near-0) rows from each. These represent *potential* coverage — if we acquired companies on these ATSes — but are not part of the current corpus, so they are not part of this initiative's near-term coverage gains. Their parsers are already reasonably correct (Jobvite, Rippling, BambooHR already use JSON-LD path).

### 1.6 Provider opportunity matrix

| Provider | Active jobs | Current coverage | Recoverable coverage | Confidence (max) | ROI rank | Difficulty | Risk |
|---|---:|---:|---:|---|---:|---|---|
| **Workday** | 63,210 | 0% | **~95% via CXS detail endpoint** | HIGH (provider-supplied ISO) | **1** | Medium (per-job detail fetch already common pattern) | Low |
| **Ashby** | 5,426 | 0% | **~95% via `publishedAt` field** | HIGH (provider-supplied ISO) | **2** | **Trivial (1-line parser fix)** | Negligible |
| **Greenhouse** | 8,403 | 100% (contaminated) | **~100% via `first_published`** (semantic correctness) | HIGH (replaces contaminated `updated_at`) | **3** | **Trivial (1-line parser fix)** | Negligible — *replaces* a contaminated field, no new rows |
| careers_page | 4,331 | 0.4% | ~25% via JSON-LD scraping on detail pages | MEDIUM (depends on site quality) | 4 | High (heterogeneous sites) | Medium (unknown schemas) |
| Workday JSON-LD fallback | (subset of 63,210) | n/a | ~33% of tenants (covers tenants where CXS detail is 404) | HIGH | 5 | Low (parser already exists for other providers) | Low |
| BambooHR / Jobvite / Rippling | <5 | mostly 100% in parsers | — | n/a | n/a | already correct | n/a |
| SmartRecruiters / Workable / Teamtailor | <5 | n/a | already correct in parsers | HIGH | n/a | n/a | n/a |
| Lever | 12,032 | 100% | (no change needed) | HIGH | — | — | — |
| RemoteOK | 114 | 100% | — | MEDIUM (feed-supplied) | — | — | — |

**Total recoverable** (conservative, additive only): Workday 63,210 × 0.95 = ~60,000 + Ashby 5,426 × 0.95 = ~5,150 = **~65,000 new TRUE postedAt rows** on top of the existing 20,575, for a corpus-level coverage of `(20,575 + 65,000) / 93,283 ≈ 92%`. Greenhouse fix is a *semantic correctness* gain, not a coverage gain.

This is achievable with **zero schema changes** and three small parser edits.

---

## 2. Extraction source hierarchy

In strict descending order of confidence. Implementation work must respect this order so that a higher-confidence source can never be overridden by a lower one (no silent backslide).

| Tier | Source | Reliability | False-positive risk | Parser complexity | Runtime cost | Maintenance | Scalability |
|---|---|---|---|---|---|---|---|
| **T0** | ATS API documented publish-date field (e.g. `first_published`, `publishedAt`, `published`, `releasedDate`) | Very high | Very low | Trivial (key access) | Zero (already in response) | Low | Excellent |
| **T1** | ATS API publish-date field on *detail* endpoint (e.g. Workday `jobPostingInfo.startDate`) | Very high | Very low | Low | +1 HTTP per job (already done for descriptions) | Low | Good (limited by rate caps) |
| **T2** | JSON-LD `JobPosting.datePosted` on provider's public detail HTML | High *if valid ISO*; medium otherwise | Low–medium (some sites emit `datePosted: "Today"` strings) | Medium (already implemented for Jobvite/Rippling/BambooHR) | +1 HTTP if not already fetching detail | Medium (per-site HTML drift) | Good |
| **T3** | Hydration payload (`__NEXT_DATA__`, Apollo state, Redux state) when JSON-LD absent | Medium-high | Medium (payload key names drift) | High (per-site discovery; fragile to bundler changes) | Same as T2 (HTML fetch) | High | Moderate |
| **T4** | Semantic HTML / micro-formats (`<time datetime="...">`, `<meta property="article:published_time">`) | Medium | Medium-high (often `last_modified`, not `published`) | Medium | Same as T2 | High | Moderate |
| **T5** | Sitemap `<lastmod>` for the job URL | Low | Very high (almost always `last_modified`, drifts with re-crawls) | Low | Bulk sitemap fetch | Low | Excellent (cheap) |
| ❌ | `updated_at`, `lastModified`, `lastSeen`, `indexedAt`, ATS internal sync timestamps | None | **Very high** | n/a | n/a | n/a | n/a |
| ❌ | `createdAt` mirrors (crawl-time row creation) | None | **Catastrophic** — that was the original `createdAtProxy` contamination | n/a | n/a | n/a | n/a |

We only emit `postedAt` for T0–T2. T3–T5 may inform a separate `freshnessConfidence: LOW` *if* we ever add per-provider HTML parsers for them — but they should **never** be promoted to T0 confidence without a paired provider-specific schema.

**Hard rule**: a higher-confidence source ingested for a job MUST NOT be overwritten by a lower-confidence source on subsequent re-crawls. Persisting `postedAtSource` enforces this (see §6).

---

## 3. Confidence model proposal

A three-tier discrete confidence scalar. Discrete is preferable to a continuous score because:
1. It maps directly to tiers above (no fuzzy thresholds).
2. It is observable in logs/metrics/UI.
3. It supports a deterministic comparator for "is this source better than what's already stored?".

### 3.1 Values

```
freshnessConfidence:
  HIGH    — provider-supplied first-publish date (T0, T1) OR validated JSON-LD datePosted (T2 strict ISO)
  MEDIUM  — JSON-LD datePosted that parses to an ISO but failed sanity checks (older than 5 years, future)
            OR hydration payload publish date (T3)
  LOW     — semantic HTML / sitemap / heuristic (T4, T5).
  (null)  — no postedAt extracted; freshness.source = "DISCOVERED" (unchanged behaviour)
```

### 3.2 `postedAtSource` enum (additive)

A separate column distinguishing *where* the date came from, independent of confidence (for observability and SEO debugging):

```
postedAtSource:
  ATS_API           — list endpoint field
  ATS_API_DETAIL    — detail endpoint field (e.g. Workday jobPostingInfo)
  JSON_LD           — public HTML JSON-LD JobPosting
  HYDRATION_PAYLOAD — __NEXT_DATA__ / Apollo / Redux blob
  ATS_HTML          — provider HTML (semantic tags, not JSON-LD)
  SITEMAP           — sitemap.xml <lastmod>
  FEED              — RSS / aggregator feed (RemoteOK, WeWorkRemotely)
  MANUAL            — OpenClaw ingestion contract
  UNKNOWN           — legacy rows before this attribution was added
```

### 3.3 Why two columns and not one

A single composite enum (`HIGH_ATS_API`, `MEDIUM_JSON_LD`, …) explodes cardinality and couples concerns. Keeping `postedAtSource` (the *origin*) separate from `freshnessConfidence` (the *trust*) means:

- The same source can have different confidence at different sites (e.g. JSON-LD with valid ISO = HIGH, JSON-LD with `"Today"` string = MEDIUM).
- The same confidence can come from different sources.
- It's a denormalized observability triple `(timestamp, source, confidence)` that is trivially indexable and trivially auditable.

---

## 4. Workday deep-dive

### 4.1 Where Workday actually exposes publish dates

| Surface | Field | Value semantics | Coverage (sample) | Confidence | Extraction cost |
|---|---|---|---:|---|---|
| **CXS list API** `POST /wday/cxs/{t}/{board}/jobs` | `postedOn` | Human label: `"Posted Today"`, `"Posted Yesterday"`, `"Posted 7+ Days Ago"`, `"Posted 30+ Days Ago"` | 100% (in 5/5 tested tenants) | LOW (string, lossy) | 0 (already fetched) |
| **CXS detail API** `GET /wday/cxs/{t}/{board}/job{externalPath}` | `jobPostingInfo.startDate` | **ISO date** `"2026-05-12"` (true first-publish) | 100% (in 5/5 tested tenants) | **HIGH** | +1 HTTP per job |
| **Public detail HTML** | `<script type="application/ld+json">` `datePosted` | ISO datetime | 33% (4/12 tenants tested; remainder return 404 on the stored sourceUrl shape) | HIGH if present | +1 HTTP per job (or reused from detail enrichment) |
| **Workday GraphQL** (internal `/recruiting/api`) | not publicly accessible | — | 0% | n/a | n/a |
| Sitemaps | `<lastmod>` | always = last crawl/index time | n/a | NONE — DO NOT USE | n/a |

### 4.2 What we're currently discarding

Everything in the detail endpoint. The list endpoint's `postedOn` label is currently the only field we try to parse, and it fails 100% of the time because it's a label, not a date.

### 4.3 Are existing fields actually the publish date?

- `jobPostingInfo.startDate` → **TRUE first-publish.** Verified against Workday product docs: this is the "Job Posting → Start Date" field which is set when a recruiter clicks "Publish" in Workday. Workday tenants can edit job postings without changing this field. Confirmed: not a crawl/sync/index timestamp.
- `jobPostingInfo.postedOn` → human label derived from `startDate`. Lossy.
- `jobPostingInfo.endDate` → expiration date (often null), not relevant to `postedAt`.
- The list-endpoint `postedOn` is the same label, redundantly emitted.

### 4.4 Coverage gain estimate

- Population: 63,210 active canonical Workday jobs.
- Detail endpoint reachability (estimated from 5/5 tenant sample): ≥95%.
- Tenants where detail endpoint 404s (estimate): ~5%. JSON-LD fallback on those tenants' public HTML covers ~33% → marginal additional gain ~1.5k jobs.
- **Net expected:** ~60,000 rows move from DISCOVERED → POSTED with HIGH confidence.

### 4.5 Implementation difficulty

- **Low.** Workday parser already structures `parseWorkdayJob` cleanly. Adding a detail-endpoint fetch is the same pattern Jobvite / Rippling / BambooHR already use for description enrichment. Existing throttling (`throttleByAts("workday")`) caps request rate. The fetch is read-only, idempotent, and Workday is permissive with unauthenticated `cxs` GETs.
- The list endpoint's `externalPath` is already in our pipeline (it builds the listing URL), so no new field tracking is needed.

### 4.6 Parser reliability concerns

- `startDate` is sometimes null on rare draft/republished states. Treat null as "no postedAt", not as a contamination.
- Some tenants serialize `startDate` as `YYYY-MM-DD` (no time), others as full ISO. Normalize to UTC midnight when only date provided.
- Cache the externalPath → startDate mapping per crawl cycle so we don't re-fetch on every reconcile.

---

## 5. JSON-LD opportunity analysis

### 5.1 Quantified by provider (live samples)

| Provider | JSON-LD JobPosting present? | `datePosted` valid ISO? | Sample evidence |
|---|---|---|---|
| Workday public detail | Yes (when 200) | Yes (when present) | 4/12 tenants 200 + JSON-LD datePosted; otherwise 404. |
| Ashby public detail | Yes (single blob) | Yes (`2025-06-17`) | 1/1 sampled |
| Jobvite public detail | Yes (already wired) | Yes | parser exercised live |
| Rippling public detail | Yes (already wired) | Yes | parser exercised live |
| BambooHR public detail | Yes (already wired) | Yes | parser exercised live |
| Greenhouse iframe / detail | Mostly absent (the public page is the customer's careers site, not a GH page) | n/a | sample returned 301 + no JSON-LD; not a reliable source for GH |
| Lever public detail | Variable; ~50% emit JSON-LD | Yes when present | not strictly needed (API already correct) |
| Custom React/Next career sites | Highly variable | Often `datePosted: "Today"` or `datePosted: "{{date}}"` template literals (bad) | requires per-site validation |

### 5.2 Malformed schema prevalence

Real failures observed in spot-checks of generic sites:
- `datePosted` emitted as a relative human string (`"Today"`, `"Yesterday"`, `"7 days ago"`).
- `datePosted` emitted as template placeholders (`"{{ posting.published_at }}"`).
- `datePosted` emitted with timezone confusion (`"2026-05-12T08:30:00"` with no TZ).
- `@type` set to `["JobPosting", "WebPage"]` — must still match.
- Multiple JSON-LD blocks on the same page; the JobPosting one is not always first.

The Workday/Ashby/Jobvite/Rippling/BambooHR vendor pages are well-formed. The risk concentrates on the custom careers_page bucket (4,331 rows).

### 5.3 Parser complexity & extraction overhead

- Multi-blob detection: cheap (regex on `<script type="application/ld+json">`, parse JSON, search for `@type`).
- `@graph` traversal: cheap (BambooHR already does this).
- Validation: must enforce `T0–T2` quality (ISO 8601 only, post-1980, ≤ today + 1 year).
- Memory: a single JobPosting JSON-LD is typically <2KB; HTML body is the dominant memory cost (already in the existing detail-page fetch path).

### 5.4 Extraction safety

- **Validate ISO strictly.** Reject anything that isn't a valid `Date` *and* isn't `YYYY-MM-DD` *and* isn't full ISO 8601.
- **Reject `"Today"`, `"Yesterday"`, `"\\d+ days ago"`** — treat them as no-signal, not as low-confidence dates. The Workday list `postedOn` is the canonical case.
- **Hard sanity bounds**: `1980-01-01 ≤ datePosted ≤ now + 366d` (already enforced in OpenClaw's `safeOpenClawPostedAt`; generalize this helper).
- **Reject when `datePosted` equals provider-known crawl-time proxies** (`indexedAt`, `crawledAt`, `feedDate`).

---

## 6. Hydration payload analysis

### 6.1 Per-provider findings

| Provider | Hydration source | Contains publish date? | Notes |
|---|---|---|---|
| Workday public HTML | No `__NEXT_DATA__`; SPA loads via XHR | n/a | Use CXS detail endpoint instead — same data, simpler |
| Ashby public HTML | No `__NEXT_DATA__`; client-only React | n/a | JSON-LD path is sufficient |
| Greenhouse iframe page | No predictable hydration; customer's site varies | n/a | Use Job Board API `first_published` |
| Custom React/Next career sites | Variable: `__NEXT_DATA__`, `__APOLLO_STATE__`, `window.__INITIAL_STATE__` | Sometimes | Highly fragile; brittle to bundler changes |
| Lever | No hydration needed | n/a | API is sufficient |
| Workable, SmartRecruiters | Use SSR with sane HTML; APIs are sufficient | n/a | n/a |

### 6.2 Cost / benefit

Hydration extraction is the *worst* extraction path:
- Highest parser complexity (per-site key naming).
- Highest maintenance burden (silent breakage on customer's frontend redeploy).
- Highest memory cost (must hold the full JSON blob in memory).
- Lowest confidence (no provenance — the field name and meaning are inferred).

**Recommendation:** do not pursue hydration extraction. The careers_page generic bucket (4,331 rows, 5% of corpus) is not worth the operational risk of per-site hydration parsers. Stick to JSON-LD with strict validation.

---

## 7. Source attribution architecture (additive)

### 7.1 Schema proposal (read-only design — not implementing)

Two additive nullable columns on `Job`:

```prisma
model Job {
  // ... existing fields ...
  postedAt              DateTime?
  effectivePostedAt     DateTime?           // existing
  listingFreshnessAt    DateTime?           // existing
  createdAt             DateTime            @default(now())  // existing

  // ▼ new (nullable, default null, no backfill)
  postedAtSource        PostedAtSource?     // ATS_API | ATS_API_DETAIL | JSON_LD | HYDRATION_PAYLOAD | ATS_HTML | SITEMAP | FEED | MANUAL | UNKNOWN
  freshnessConfidence   FreshnessConfidence?// HIGH | MEDIUM | LOW
}

enum PostedAtSource {
  ATS_API
  ATS_API_DETAIL
  JSON_LD
  HYDRATION_PAYLOAD
  ATS_HTML
  SITEMAP
  FEED
  MANUAL
  UNKNOWN
}

enum FreshnessConfidence {
  HIGH
  MEDIUM
  LOW
}
```

### 7.2 Compatibility strategy

- Both columns **nullable, default null** → zero impact on legacy rows.
- API `freshness` payload extended with `freshness.confidence` and `freshness.attribution` (optional, omitted when null). Older clients continue to work.
- JSON-LD generation unchanged. Strategy A (emit `datePosted` for POSTED-only) still gated on `freshness.source`, which itself depends on `postedAt` non-null. We deliberately do NOT change which rows emit `datePosted` based on confidence — that would couple ranking and SEO to a confidence model, which is over-coupling.
- Sorting unchanged in this phase. Ranking still treats every non-null `postedAt` equally. (Future phase may de-rank LOW confidence below DISCOVERED, but that requires its own analysis.)

### 7.3 Migration proposal

- Single migration: `ADD COLUMN ... NULL` on the Job table. PostgreSQL adds nullable columns without a table rewrite → near-instant on 93k rows.
- No backfill required initially. New rows get the value at ingestion time. Old rows remain null.
- A separate read-only audit query at any time:
  `SELECT source, COUNT(*) FILTER (WHERE postedAtSource IS NOT NULL) FROM "Job" GROUP BY source;`

### 7.4 Indexing considerations

- **No new index initially.** The current `idx_jobs_canonical_latest_v2` is sufficient. `postedAtSource` and `freshnessConfidence` are diagnostic columns, not query keys.
- *If* in a future phase we want to surface "HIGH-confidence first" sorting, we'd add a partial composite index on `(freshnessConfidence DESC, postedAt DESC NULLS LAST, ...)` — but that's a separate proposal.

### 7.5 Rollout sequencing

1. Land schema columns (nullable). No code change yet. Zero impact.
2. Update one parser at a time (Ashby → Greenhouse → Workday) to set `postedAt + postedAtSource + freshnessConfidence` together. Each parser ships behind a feature flag.
3. Observe metrics: contamination rate, attribution distribution, daily HIGH-confidence growth.
4. After ≥7 days of stable data: enable a follow-up phase that adds the attribution to the API freshness payload (UI changes deferred).

---

## 8. Extraction pipeline design (centralized)

### 8.1 Pipeline goals

- **Single per-row outcome**: one `(postedAt, postedAtSource, freshnessConfidence)` triple per job, set by exactly one extractor at ingestion time.
- **Deterministic precedence**: the first qualifying extractor wins; no "best of N".
- **Parser isolation**: each provider parser is independent and returns the triple directly; the pipeline does not aggregate or guess across providers.
- **Observable**: every extractor emits a structured `freshness_extraction` log with the source, confidence, and reason.

### 8.2 Precedence order (per row)

```
1. ATS_API           — list endpoint documented publish field
   (Lever createdAt, Ashby publishedAt, Greenhouse first_published,
    Workable published, SmartRecruiters publishedAt/releasedDate, etc.)
2. ATS_API_DETAIL    — detail endpoint structured field
   (Workday jobPostingInfo.startDate; fallback for any provider whose
    list endpoint omits the field)
3. JSON_LD           — strict ISO datePosted from public detail HTML
   (Jobvite, Rippling, BambooHR already; Ashby fallback;
    Workday fallback for 404s on detail endpoint)
4. HYDRATION_PAYLOAD — DEFERRED — not in scope, not safe
5. ATS_HTML          — DEFERRED — not in scope, too brittle
6. SITEMAP           — REJECTED — lastmod is not publish
7. (no signal)       — leave postedAt null; freshness.source = "DISCOVERED"
```

Each level must succeed *strict validation* before being accepted. If level N fails validation, the pipeline falls to N+1; if all fail, leave the row DISCOVERED.

### 8.3 Validation (applied uniformly at each level)

```
Accept date d iff:
  d is a valid Date
  AND d >= 1980-01-01
  AND d <= now() + 366 days
  AND d is parseable from ISO 8601 OR YYYY-MM-DD OR epoch ms
  AND d is not within ±60s of crawl-time (filters createdAt mirrors)
  AND d's string representation is not one of:
     "Today", "Yesterday", "\\d+ days ago", "\\d+\\+ days ago",
     "{{...}}", "(null)", "", placeholder-like values
```

Sub-rule for the "createdAt mirror" check: any candidate within ±60s of `now()` is suspicious and downgraded to MEDIUM confidence (or rejected if confidence is LOW). This catches feeds that emit "indexed at = now" as `datePosted`.

### 8.4 Timezone handling

- All persisted timestamps are stored as UTC. Parsers must accept tz-naive ISO strings (treat as UTC) and tz-aware strings (convert). The existing `parseDate` in `apps/server/src/modules/ats/ats.interface.ts` already does this — verify no provider currently inverts the sign.
- For date-only values (`YYYY-MM-DD`), interpret as that date at 00:00 UTC. Not the tenant's local timezone. This is consistent with our existing storage and Strategy A JSON-LD.

### 8.5 Normalization

- Reject `datePosted` strings shorter than 10 chars.
- Reject `datePosted` values older than the oldest `createdAt` for that company (sanity check).
- Round detail-endpoint date-only values to UTC midnight to avoid spurious "freshly posted" pulses at the boundary.

### 8.6 Observability

Every ingestion path emits:

```
{
  "event": "freshness_extraction",
  "company_id": "...",
  "source_url": "...",
  "ats": "workday",
  "tier": "ATS_API_DETAIL",
  "confidence": "HIGH",
  "postedAt": "2026-05-12T00:00:00.000Z",
  "rejection_reasons": [],   // populated only on rejection
  "fallback_to": null         // populated when promoting to next tier
}
```

A dashboard built on these logs replaces the ad-hoc DB queries used during this analysis.

---

## 9. Validation + safety design

Layered guards. Each catches a specific failure class.

### 9.1 Per-row contamination guards

| Guard | Check | Action on fail |
|---|---|---|
| **G1 future date** | `postedAt > now() + 366d` | Reject; log `future_date` |
| **G2 ancient date** | `postedAt < 1980-01-01` | Reject; log `ancient_date` |
| **G3 createdAt mirror** | `abs(postedAt - now()) < 60s` AND source ∈ {JSON_LD, HYDRATION, ATS_HTML} | Downgrade to MEDIUM; log `createdat_mirror_suspected` |
| **G4 string placeholder** | regex match `^(today\|yesterday\|recent\|just\|\\{\\{)` | Reject; log `placeholder_string` |
| **G5 timezone corruption** | hour ∈ {0,12} AND minute = 0 AND second = 0 AND source was an ISO datetime field (not a date-only field) | Downgrade to MEDIUM (likely TZ-stripped) |
| **G6 identical provider-wide timestamp** | per-crawl-batch: ≥80% of rows for a single company have identical `postedAt` | Reject the batch; quarantine for manual review; log `provider_timestamp_spike` |
| **G7 fake freshness spike** | per-hour: surge in `freshness_eligible_count` ≥ 3σ above 14-day rolling mean | Alert; do not auto-reject (could be a real publication event) |
| **G8 updated_at promotion** | provider attempted to promote a known `updated_at` / `last_modified` / `lastIndexed` field as postedAt | Reject; this is structurally a Greenhouse-style contamination |

### 9.2 Provider anomaly detection

Per-day, per-provider, per-tenant rolling KPIs:

- `% rows with postedAtSource = ATS_API_DETAIL succeeding` — if Workday's detail endpoint starts 404'ing tenant-wide, this drops fast.
- `median(postedAt) per tenant` — if a tenant's median jumps by >7 days week-over-week, something changed in their Workday config or our parser.
- `Δ between postedAt and createdAt` (the metric we used in §1.2 to detect Greenhouse contamination) — should be ≥ 0 (we crawl after publish), small (we crawl within hours of publish), and stable. A widening delta means the postedAt field is drifting (= `updated_at`-style contamination).

### 9.3 Quality gates

A new postedAt extraction path may not promote rows to HIGH confidence until it passes:

1. **Shadow run for ≥48 hours**: parser writes to a parallel `postedAtShadow` column (or only-log mode), comparing against the existing `postedAt` value.
2. **Sample audit**: 50 random rows manually checked against the provider's actual published-on text.
3. **Sanity Δ stable**: median Δ between new candidate and `createdAt` is small (<24h) and stable across the shadow window.
4. **No G1–G8 violations** during the shadow window.

### 9.4 Rollback strategy

- All new `postedAtSource` / `freshnessConfidence` writes are reversible: set them back to null and the row reverts to legacy behaviour. No row's `postedAt` is mutated — only newly-ingested values carry the new triple.
- For Greenhouse `updated_at → first_published`: this is a *semantic correctness* change. The fallback if anything goes wrong is to flip a feature flag back to `updated_at`. No data destruction.
- For Ashby: trivially flagged.
- For Workday detail-endpoint fetches: if the endpoint starts failing at scale, the feature flag turns off the extra request — coverage drops back to current 0%, no regression.

---

## 10. Performance + scale analysis

### 10.1 Cost model per provider

| Provider | Existing requests | New requests for postedAt | Net latency impact |
|---|---|---|---|
| Workday | 1 list request per page × N pages | **+1 detail request per job** for postedAt | Significant: 63k jobs × 1 extra request. Mitigation: piggyback on existing description-enrichment detail fetch where applicable. |
| Ashby | 1 list request per company | 0 (field already in response) | None |
| Greenhouse | 1 list request per company | 0 (field already in response) | None |
| careers_page | 1 list + N detail HTML | 0 if we already fetch the detail HTML; else +1 | Marginal |
| Workday JSON-LD fallback | n/a yet | +1 detail HTML per 404'd CXS detail | Bounded by 404 rate (~5%) |

### 10.2 Throughput considerations

- Workday's CXS detail endpoint is the bottleneck. At our current throttle (`throttleByAts("workday")` ≈ 2 req/s aggregate), 63k jobs would take ~9 hours to backfill if every detail fetch is sequential.
- A safer pattern: only fetch detail-endpoint dates for jobs missing `postedAtSource`. Once a job has it, never re-fetch unless content hash changes. This naturally backfills over the crawl cycle (a few days), avoiding a one-shot spike.
- Workday is permissive on these endpoints; we are not paying real-world auth/quota costs.

### 10.3 DB storage impact

- Two new nullable enum columns: ~5 bytes/row × 93k rows = ~470 KB. Negligible.
- No new index needed initially (see §7.4).
- Index Only Scan on `idx_jobs_canonical_latest_v2` continues to hit the visibility map fast; adding columns doesn't change that path.

### 10.4 Ingestion throughput

- Pipeline-side: extraction is in-memory on already-fetched payloads → essentially free.
- The only new wall-clock cost is the Workday detail fetch. Pre-fetching it in parallel with description enrichment (which we already do for some providers) hides the latency in the existing crawl budget.

### 10.5 Recommended priorities (lowest cost, highest yield first)

| Rank | Change | Cost | Yield (coverage) | Risk |
|---|---|---|---|---|
| 1 | Ashby parser: also accept `publishedAt` | 1-line code | +5,150 rows (5.5%) | Negligible |
| 2 | Greenhouse parser: use `first_published` not `updated_at` | 1-line code | 0 new rows, but **fix 8,432 contaminated rows** | Negligible |
| 3 | Workday: add detail-endpoint fetch + parse `jobPostingInfo.startDate` | Moderate (new pattern, but consistent with other providers) | +60,000 rows (64% of corpus) | Low |
| 4 | Workday JSON-LD fallback when CXS detail 404s | Low (reuse existing JSON-LD extractor) | +1,500 rows (1.6%) | Low |
| 5 | careers_page JSON-LD scraping | High maintenance | +1,000 rows (1.1%) | Medium |
| 6 | Hydration payload extractors | Very high maintenance | +500 rows (0.5%) | High |
| 7 | Sitemap lastmod | n/a | semantically wrong | Reject |

---

## 11. Implementation roadmap (sequenced, with metrics & rollback per step)

> Each phase MUST land independently, validate independently, and observe for at least the listed window before moving on.

### Phase A — Schema scaffolding (additive, no data change)

- Add `postedAtSource` + `freshnessConfidence` nullable columns + enums.
- No code reads them yet.
- Verify migration is no-op for existing rows.
- Observe DB perf for 24h: query latency, write throughput unchanged.
- Rollback: drop the columns (no row depends on them).

### Phase B — Greenhouse semantic fix (highest leverage, lowest risk)

- Switch the Greenhouse parser from `updated_at` → `first_published`.
- Set `postedAtSource = ATS_API`, `freshnessConfidence = HIGH`.
- Feature-flag `GH_USE_FIRST_PUBLISHED=true`. Off → revert to `updated_at`.
- Watch: per-row Δ between new `postedAt` and our `createdAt` should be close to zero on freshly-ingested rows.
- Watch: any GH row in which Δ becomes negative (postedAt > createdAt) by more than 5min is a hard alert (G1 future date / G3 createdAt mirror).
- Observe ≥7 days. SEO impact: Strategy A continues to emit `datePosted` for POSTED rows; no JSON-LD shape change.
- Rollback: flip flag off. Existing rows that were re-ingested under the new field can either be left as-is (still semantically better) or reverted via a one-shot re-ingest.

### Phase C — Ashby parser fix (1-line)

- Add `job.publishedAt` to the priority chain in `parseAshbyJobs`.
- Set `postedAtSource = ATS_API`, `freshnessConfidence = HIGH`.
- Feature-flag `ASHBY_USE_PUBLISHED_AT=true`.
- Coverage of Ashby rows should jump from 0% → ~95% within one crawl cycle.
- Observe ≥3 days.
- Rollback: flip flag off; Ashby returns to 0% coverage. No row is destroyed.

### Phase D — Workday CXS detail endpoint extraction

- Add `fetchWorkdayJobDetail(externalPath)` returning `{ startDate, jobDescription, externalUrl }`.
- Integrate into `workdayCrawler.fetchJobs` as a per-job enrichment step (parallel-limited to existing throttle).
- Parser sets `postedAtSource = ATS_API_DETAIL`, `freshnessConfidence = HIGH`.
- Feature-flag `WORKDAY_FETCH_START_DATE=true`.
- Canary: enable on ≤3 small tenants first (≤500 jobs each). Verify HTTP 200 rate, Δ distribution, no G6 spikes.
- Then ramp to all tenants over ~3 days.
- Observe ≥7 days at full rollout.
- Rollback: flip flag off. Coverage drops back to current 0% for Workday. No regression.

### Phase E — Workday JSON-LD fallback for 404 tenants

- For Workday rows where CXS detail returns 404, fall back to fetching the public detail HTML and parsing JSON-LD `datePosted`.
- Set `postedAtSource = JSON_LD`, `freshnessConfidence = HIGH` only if strict ISO validates; else `MEDIUM` or reject.
- Feature-flag `WORKDAY_JSONLD_FALLBACK=true`.

### Phase F — careers_page generic JSON-LD scraping (optional)

- For the 4,331 careers_page rows where we already fetch detail HTML, add a strict JSON-LD `datePosted` extractor.
- Set `postedAtSource = JSON_LD`, `freshnessConfidence ∈ {HIGH, MEDIUM}` depending on validation.
- Per-site allow-list to avoid the malformed-schema sites we know about.
- Observe ≥14 days because of heterogeneity.

### Phase G — Attribution in API freshness payload (additive)

- Extend `freshness` to `{ source, label, timestamp, relative, confidence, attribution }`.
- Older clients ignore the new keys.
- Client UI changes deferred to a separate UI proposal.

### Phase H — Decide on confidence-aware ranking

- *Out of scope for the current initiative.* Once Phases A–G are stable, write a separate analysis on whether LOW confidence should de-rank below DISCOVERED. The current rollout deliberately decouples "do we know the publish date?" from "how do we rank known publish dates".

---

## 12. Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Greenhouse `first_published` is missing on some old GH boards | Low | Low | Fallback to no-postedAt (DISCOVERED). Never fall back to `updated_at` (that's the contamination we're removing). |
| Workday detail endpoint returns 4xx at scale | Low (sampled 5/5 success) | Medium | Feature flag off. JSON-LD fallback for 404 tenants. |
| Workday detail-endpoint rate-limits us tenant-wide | Low | Medium | Existing throttle holds. Add per-tenant exponential backoff. |
| Ashby renames `publishedAt` in API | Very low | Low | Trivial parser update; field naming has been stable for years. |
| New extractor accidentally sets `postedAt = now()` | Medium (regression class) | High | G3 createdAt-mirror guard rejects. Shadow run for 48h. Pre-deploy sanity test: assert Δ distribution. |
| Per-tenant `provider_timestamp_spike` (all rows same time) | Low | High | G6 quarantine. Manual review before promotion. |
| API contract change breaks older clients | Low | Low | New fields are additive and optional; payload is upward-compatible. |
| SEO crawler reacts to attribution change | None | None | We do not change which rows emit `datePosted` in JSON-LD. Strategy A still gates on `freshness.source`. |
| Ranking change from coverage growth | Low | Low | Ranking already prioritizes POSTED over DISCOVERED. More HIGH-confidence POSTED rows is the intended outcome. Sub-tier ranking by confidence is deferred. |
| Workday CXS detail fetch doubles crawl time | Medium | Low | Parallel-fetch with description enrichment. Throttle holds. Backfill is gradual, not one-shot. |

---

## Final deliverable map (cross-reference)

| Deliverable                                | Section |
|--------------------------------------------|---------|
| 1. Provider opportunity matrix             | §1.6    |
| 2. Extraction source hierarchy             | §2      |
| 3. Confidence model proposal               | §3      |
| 4. Workday deep-dive findings              | §4      |
| 5. JSON-LD opportunity analysis            | §5      |
| 6. Hydration extraction analysis           | §6      |
| 7. Source attribution architecture         | §7      |
| 8. Validation strategy                     | §9      |
| 9. Performance analysis                    | §10     |
| 10. Implementation roadmap                 | §11     |
| 11. Risk matrix                            | §12     |
| 12. Estimated achievable coverage          | §1 + §10.5 |

---

## Decision summary — what to implement / what NOT to implement

### Implement (in order; each behind a feature flag, each observed independently)

1. **Schema scaffolding** for `postedAtSource` + `freshnessConfidence` (additive, nullable).
2. **Greenhouse: `updated_at` → `first_published`.** One-line parser fix. Eliminates contamination on 8,432 rows.
3. **Ashby: accept `publishedAt`.** One-line parser fix. Recovers ~5,150 rows.
4. **Workday: fetch CXS detail endpoint, parse `jobPostingInfo.startDate`.** Largest single coverage gain (~60,000 rows).
5. **Workday JSON-LD fallback** for tenants where CXS detail 404s.

### Defer (analyze later, do not implement now)

- careers_page generic JSON-LD scraping (medium yield, high maintenance).
- Hydration-payload extractors (high maintenance, low yield).
- Confidence-aware ranking changes.
- Bulk historical backfill of `postedAtSource` for legacy rows (let attribution fill naturally as rows are re-crawled).

### Reject (do not implement under any circumstances)

- Sitemap `<lastmod>` as a `postedAt` source — it's `last_modified`, never `first_published`.
- `updated_at` / `last_modified` / `lastIndexed` / `lastSeen` as `postedAt` (this is the contamination we just removed; G8 hard-rejects this class).
- `createdAt` mirrors (our own row creation as `postedAt`) — that was the original `createdAtProxy` contamination.
- Inferring postedAt from "Posted Today" / "Posted N days ago" string labels in the absence of a structured field — too lossy, breaks at the day boundary, and adds rolling-window contamination.

### Hard invariants this initiative must preserve

- Strategy A JSON-LD (`datePosted` only for `freshness.source === "POSTED"`) is unchanged.
- Ranking semantics (POSTED before DISCOVERED) is unchanged.
- The frontend freshness contract (POSTED jobs show "Posted N ago", DISCOVERED show "Added N ago") is unchanged.
- Pagination stability (`postedAt DESC NULLS LAST, listingFreshnessAt DESC, createdAt DESC, id ASC`) is unchanged.
- No row's `postedAt` is mutated by this initiative — only newly-ingested values write new `(postedAt, source, confidence)` triples.

**End of analysis.**
