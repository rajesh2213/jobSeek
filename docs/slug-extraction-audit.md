# ATS Board Slug Extraction Audit (Phase 1–2)

## Phase 1 — Existing code paths

### Enrichment pipeline

`companyEnrichment.service.ts` → `extractAtsBoardToken()` dispatches by `atsType`:

| ATS | Extractor | Called when |
|-----|-----------|-------------|
| greenhouse | `extractGreenhouseToken(html, careersUrl)` | After `detectATS()` sets type |
| lever | `extractLeverToken` | Same |
| ashby | `extractAshbyToken` | Same |
| workday | `extractWorkdayToken` | Same |

Token is stored on `Company.atsBoardToken`, then `parseCrawlableBoard(type, token, careersUrl)` builds `AtsEndpoint` slug.

### Ashby — **root cause of `posting-api`**

**File:** `ashby.extractor.ts` (before fix)

```typescript
const m = text.match(/ashbyhq\.com\/([a-z0-9\-]+)/i);
```

**Problem:** Matches the **first** path segment after `ashbyhq.com` in **any** URL, including:

- `https://api.ashbyhq.com/posting-api/...` → token `posting-api`
- NOT `https://jobs.ashbyhq.com/vanta` → token `vanta`

**Detection path:** `detectATS()` in `ats.detector.ts` finds Ashby in HTML, then `extractAtsToken(url, 'ashby')` only handles `jobs.ashbyhq.com/{slug}` — but enrichment uses **`extractAshbyToken`**, not `extractAtsToken`, for persistence.

### Greenhouse — **root cause of `embed`**

**File:** `greenhouse.extractor.ts` (before fix)

```typescript
const m = text.match(/boards\.greenhouse\.io\/([a-z0-9\-]+)/i);
```

**Problem:** Many boards load via:

```html
<script src="https://boards.greenhouse.io/embed/job_board?for=figment"></script>
```

Regex captures path segment **`embed`**, not query param `for=figment`.

`extractAtsToken()` in `ats.detector.ts` **did** handle `embed/job_board?for=` — but enrichment ignored that and used the broken extractor.

### Lever

**File:** `lever.extractor.ts` — `jobs.lever.co/{slug}` — generally correct; failures when slug only in JS without full URL in HTML.

### Workday

**File:** `workday.extractor.ts` — parses last path segment as `site`. Careers pages linking to `.../login` produced `site: "login"` → invalid board.

### `parseCrawlableBoard` fallback

**File:** `atsUrlParser.ts`

```typescript
const slug = fromUrl ?? asciiSafeLower(token.split(/[/\s]+/g).pop() ?? token);
```

If `boardToken` is already `posting-api` or `embed`, fallback **reinforces** the bad slug.

---

## Phase 2 — Real slug rules

### Ashby

| Rule | Pattern | Example |
|------|---------|---------|
| Primary | `https://jobs.ashbyhq.com/{org-slug}` | `jobs.ashbyhq.com/vanta` → `vanta` |
| Secondary | `.../job-board/{org-slug}` | API embed paths |
| Reject | `posting-api`, `api`, `jobs` as slug | INVALID_TOKENS |
| Fallback | `null` + log — **never** store generic segment |

### Greenhouse

| Rule | Pattern | Example |
|------|---------|---------|
| Primary | `boards.greenhouse.io/{token}` | `boards.greenhouse.io/figment` |
| Primary | `job-boards.greenhouse.io/{token}` | same |
| Embed | `boards.greenhouse.io/embed/job_board?for={token}` | `for=figment` |
| Reject | path segment `embed` without `for=` | INVALID |

### Lever

| Rule | Pattern |
|------|---------|
| Primary | `jobs.lever.co/{company-slug}` |
| Fallback | `null` |

### Workday

| Rule | Pattern |
|------|---------|
| Primary | `{tenant}.wdN.myworkdayjobs.com/{site}` |
| Reject sites | `login`, `signin`, `introduceyourself` |
| Token | JSON `{host, tenant, site}` |

### Validation (all ATS)

```typescript
INVALID_ATS_BOARD_TOKENS = [
  'posting-api', 'embed', 'login', 'jobs', 'careers',
  'api', 'job_board', 'job-board', ...
]
```

If extracted token ∈ INVALID → do not store → `invalid_ats_board_token_rejected` log.

---

## Phase 4 — Multi-company → one endpoint (design only)

Post-fix, some companies will still share a board (e.g. acquisition → `harnessinc`).

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **a) M:N join table** | `CompanyAtsEndpoint(companyId, endpointId)` | Clean, many companies per board | Migration + query changes |
| **b) canonicalCompanyId + aliases** | One owner, `aliasCompanyIds[]` | Simple reads | Array updates, size limits |
| **c) Keep unique (type,slug), link via join only** | Endpoint row shared; coverage metric uses join | Minimal schema change | `companyId` on endpoint becomes optional canonical |

**Recommendation:** **(a) M:N join table** — `CompanyAtsEndpoint` with unique `(companyId, endpointId)`. Keep `AtsEndpoint.companyId` as optional primary/canonical for backwards compatibility. Coverage counts companies with **any** join row.

Do **not** implement until reviewed.
