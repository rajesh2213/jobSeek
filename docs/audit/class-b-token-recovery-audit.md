# Class B ATS Token Recovery Audit

Generated: 2026-06-04  
Script: `apps/server/scripts/audit/classBTokenRecoveryAudit.ts`  
Data: `docs/audit/class-b-token-recovery-audit.json`

## Definition (Class B)

Companies where:

- `atsType IS NOT NULL`
- `atsBoardToken IS NULL` or empty
- No active `AtsEndpoint` linked to the company

---

## Population

### By ATS type

| atsType | Count |
|---------|------:|
| workable | 102 |
| greenhouse | 55 |
| bamboohr | 52 |
| lever | 24 |
| smartrecruiters | 14 |
| workday | 12 |
| ashby | 6 |
| jobvite | 1 |
| **Total** | **266** |

### Crawlable subset (GH / Lever / Ashby / Workday)

**97 companies** — in scope for this project (no new ATS vendors).

### Status breakdown

| status | Count |
|--------|------:|
| enriching | 264 |
| ready | 2 |

Almost all Class B rows are stuck in `enriching` with partial ATS detection (type set, token missing).

---

## Sample analysis

Stratified random sample (target 175; actual **92** due to population caps):

| ATS | Target | Sampled |
|-----|-------:|--------:|
| Greenhouse | 50 | 50 |
| Lever | 50 | 24 |
| Workday | 50 | 12 |
| Ashby | 25 | 6 |

For each company: fetch `careersUrl`, run production extractors, classify failure bucket.

### Bucket counts (exact)

| Bucket | Count | % of sample |
|--------|------:|------------:|
| greenhouse_no_signal | 37 | 40.2% |
| lever_company_slug_hidden | 20 | 21.7% |
| fetch_failed | 12 | 13.0% |
| **recoverable_today** | **8** | **8.7%** |
| workday_site_in_json | 6 | 6.5% |
| ashby_org_hidden | 3 | 3.3% |
| workday_board_url_present | 2 | 2.2% |
| greenhouse_board_link_hidden | 1 | 1.1% |
| greenhouse_script_json | 1 | 1.1% |
| ashby_no_signal | 1 | 1.1% |
| ashby_posting_api_only | 1 | 1.1% |

### By ATS type (sample)

**Greenhouse (50)**

| Bucket | Count |
|--------|------:|
| greenhouse_no_signal | 37 |
| recoverable_today | 8 |
| fetch_failed | 3 |
| greenhouse_board_link_hidden | 1 |
| greenhouse_script_json | 1 |

**Lever (24)**

| Bucket | Count |
|--------|------:|
| lever_company_slug_hidden | 20 |
| fetch_failed | 4 |

**Workday (12)**

| Bucket | Count |
|--------|------:|
| workday_site_in_json | 6 |
| fetch_failed | 4 |
| workday_board_url_present | 2 |

**Ashby (6)**

| Bucket | Count |
|--------|------:|
| ashby_org_hidden | 3 |
| fetch_failed | 1 |
| ashby_no_signal | 1 |
| ashby_posting_api_only | 1 |

### Recoverable today (extractor already works; DB empty)

| Company | ATS | Token found live |
|---------|-----|------------------|
| Mentimeter | greenhouse | mentimeter |
| ResProp Management | greenhouse | resprop |
| Brandwatch | greenhouse | brandwatch |
| Correlation One | greenhouse | correlationone |
| saas.group | greenhouse | saasgroup |
| PolyAI | greenhouse | polyai |
| Airship | greenhouse | airship |
| Sigma Computing | greenhouse | sigmacomputing |

These 8 are **immediate migration wins** (persist token only).

### Why extractors failed (representative)

| Bucket | Root cause | Where token hides |
|--------|------------|-------------------|
| greenhouse_no_signal | DB `atsType=greenhouse` but careers page has no GH URL (wrong ATS or marketing page) | N/A — detection false positive |
| lever_company_slug_hidden | `lever.co` string in HTML (detector) but no `jobs.lever.co/{slug}` link | Embed JSON, `api.lever.co/v0/postings/{slug}`, data attributes |
| workday_site_in_json | Workday references in `__NEXT_DATA__` / config JSON, not anchor href | Script JSON: host, tenant, site |
| workday_board_url_present | `myworkdayjobs.com` in page; parser misses path shape | Full WD URL in script/src |
| greenhouse_board_link_hidden | `boards.greenhouse.io/{slug}` in HTML; extractor order miss | Board URL in bare URL scan |
| ashby_org_hidden | Ashby host without parseable slug path | `ashbyhq.com` org paths, job-board API URLs |
| fetch_failed | Empty `careersUrl`, timeout, or short HTML | Fix careers URL separately |

---

## Quantified opportunity

| Estimate | Companies | Basis |
|----------|----------:|-------|
| **Immediate (migration only)** | **8** | `recoverable_today` rate × 97 crawlable |
| **After extractor fixes (conservative)** | **25–35** | Implementable buckets × 97 × 0.35–0.45 |
| **After extractor fixes (optimistic)** | **32–43** | Sample implementable rate 44.6% × 97 |
| **Endpoint gain (post-token)** | **~25–40** | Requires enrichment wiring + no slug collision; not all tokens create unique endpoints |

### ATS-type distribution (expected recoveries)

| ATS | Pop | Est. recoverable |
|-----|----:|-----------------:|
| Greenhouse | 55 | 12–18 (8 immediate + board/JSON fixes) |
| Lever | 24 | 8–14 (embed/JSON slug) |
| Workday | 12 | 4–8 (JSON + URL parser) |
| Ashby | 6 | 2–4 (org path expansion) |

### Success criteria check (pre-implementation)

| Tier | Target | Audit projection |
|------|-------:|-----------------:|
| Minimum | +25 | **Achievable** with migration + extractor work |
| Good | +50 | Unlikely on crawlable 97 alone; needs workable/BambooHR out of scope |
| Excellent | +80+ | Not supported for crawlable subset |

**Note:** Prior estimate of ~215 Class B referred to a slightly different query (included companies with inactive endpoints). Current DB count is **266** total / **97** crawlable.

### ROI vs other projects

| Project | Est. companies | This audit |
|---------|---------------:|------------|
| Class B token recovery | **25–43** (crawlable) | Highest for GH/Lever/WD/Ashby |
| Orphan linker (conf 3) | 2 | Exhausted |
| Slug fix migration | 15 | Completed |
| Playwright | — | Out of scope |

---

## Phase 0 verdict

**Proceed to implementation.** Priority order:

1. Idempotent migration for `recoverable_today` (8+ companies).
2. Lever JSON / API URL extraction (`lever_company_slug_hidden`).
3. Workday JSON config parsing (`workday_site_in_json`).
4. Greenhouse JSON / `job-boards` / grnhse config (`greenhouse_script_json`, `greenhouse_board_link_hidden`).
5. Ashby org path expansion (`ashby_org_hidden`).

Do **not** expand scope to workable (102) or bamboohr (52) in this project.
