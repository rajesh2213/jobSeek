# Class B Token Recovery — Implementation Plan

Based on: `docs/audit/class-b-token-recovery-audit.md` (2026-06-04)

## Goals

- Recover `atsBoardToken` for crawlable Class B companies (GH, Lever, Ashby, Workday).
- Target: **+25 minimum**, **+32–43 optimistic** on 97-company crawlable population.
- Production-safe: no schema, no Playwright, no new ATS vendors, no scheduler changes.

---

## Failure modes → strategy

### 1. `recoverable_today` (8 in sample)

| Field | Value |
|-------|-------|
| Root cause | Extractors work; enrichment never persisted token (cap/exhausted) |
| Strategy | `recoverClassBTokens.ts` migration: fetch + extract + UPDATE |
| Risk | **Low** |
| Expected gain | **8–12** |

### 2. `greenhouse_board_link_hidden` / `greenhouse_script_json`

| Field | Value |
|-------|-------|
| Root cause | Board URL or `for=` buried in scripts/JSON; bare URL regex misses |
| Strategy | Expand `extractGreenhouseToken`: `job-boards.greenhouse.io`, `grnhse`, `boardToken`, `GH_BOARD_TOKEN`, escaped embed URLs |
| Risk | **Low** — still reject `embed`, `job_board` |
| Expected gain | **2–5** |

### 3. `greenhouse_no_signal` (37 in sample)

| Field | Value |
|-------|-------|
| Root cause | Often wrong `atsType` (marketing careers, no GH embed) |
| Strategy | **No extractor change**; migration skips when live extract null |
| Risk | N/A |
| Expected gain | **0** (out of scope) |

### 4. `lever_company_slug_hidden` (20 in sample)

| Field | Value |
|-------|-------|
| Root cause | Lever detected via `lever.co` text; slug only in API/embed JSON |
| Strategy | `extractLeverToken`: `api.lever.co/v0/postings/{slug}`, `lever.co/v0/postings`, JSON `postingOrgSlug`, `leverAccount`, `data-lever-*` |
| Risk | **Medium** — validate slugs; reject `jobs`, `careers`, `apply` |
| Expected gain | **8–14** |

### 5. `workday_site_in_json` / `workday_board_url_present`

| Field | Value |
|-------|-------|
| Root cause | WD config in `__NEXT_DATA__` / inline JSON, not `<a href>` |
| Strategy | `extractWorkdayToken`: scan JSON for `myworkdayjobs.com` URLs and `{host,tenant,site}` objects; support `/en-US/{site}/` paths |
| Risk | **Medium** — reject `login`, `signin`, `auth`, `candidate-home` |
| Expected gain | **4–8** |

### 6. `ashby_org_hidden` / `ashby_posting_api_only`

| Field | Value |
|-------|-------|
| Root cause | Org slug in non-jobs paths; posting-api without job-board segment |
| Strategy | `app.ashbyhq.com/{org}`, `ashby_jid`, `ashbyBaseJobBoardUrl`; never return `posting-api`, `api`, `embed` |
| Risk | **Low** |
| Expected gain | **2–4** |

### 7. `fetch_failed`

| Field | Value |
|-------|-------|
| Root cause | Missing/empty `careersUrl`, bot block, timeout |
| Strategy | Skip in migration; log `class_b_token_recovery:fetch_failed` |
| Risk | **Low** |
| Expected gain | **0** (careers URL project) |

---

## Implementation phases (this project)

| Phase | Deliverable |
|-------|-------------|
| 2 | Extractor updates (4 files + `extractBoardUrls.ts`) |
| 3 | Unit tests in `atsBoardTokenExtractors.test.ts` |
| 4 | `scripts/audit/classBTokenRecovery.ts` (dry-run, no writes) |
| 5 | `scripts/migrations/recoverClassBTokens.ts` (`--dry-run`, `--limit`) |
| 6 | `docs/rollout/class-b-token-recovery-results.md` after dry-run + optional live |

## Migration rules (`recoverClassBTokens.ts`)

- SELECT: `atsType IN (greenhouse, lever, ashby, workday)`, null/empty token, no `AtsEndpoint` for company.
- Fetch `careersUrl` (12s timeout).
- Extract with production functions.
- UPDATE only if new token differs and passes `parseCrawlableBoard`.
- Tag: `discoverySource += class_b_token_recovery:recovered` or `:unresolvable`.
- **No** endpoint creation.

## Out of scope

- Workable (102), BambooHR (52), SmartRecruiters (14)
- Playwright, proxies, schema, M:N endpoints, scheduler/queue

## Rollback

Migration is idempotent; re-run with `--dry-run` to verify. Clear tag and token manually if a bad slug is persisted (unlikely with `sanitizeBoardToken`).
