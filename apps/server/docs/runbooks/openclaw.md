# OpenClaw (Remote Rocketship) — operational runbook

OpenClaw is an **optional** integration for discovery acceleration and supplemental job ingestion. It is **not** the primary source of truth for JobLoom inventory. Core ATS crawls, endpoint ingestion, and enrichment remain authoritative when they disagree.

## Behavior summary

- **Processes:** `worker:openclaw`, `scheduler:openclaw` (see `package.json` scripts).
- **Queue:** `openclaw-sync` — jobs use `attempts: 1` and `removeOnFail: true` to limit retry storms.
- **Ingestion:** Mapped rows go through `JobService.ingestDeduplicated` (same dedup/canonical path as other sources) unless `OPENCLAW_DRY_RUN=true`.
- **Company hints:** OpenClaw may fill **missing** `Company` fields only; see merge policy below.
- **Source weight:** Jobs use `source: openclaw` with explicit ranking weight in `jobRanking.service.ts` (`SOURCE_WEIGHTS.openclaw`).

## Rollback

1. Set `OPENCLAW_ENABLED=false` or `OPENCLAW_SYNC_ENABLED=false`.
2. Stop `worker:openclaw` and `scheduler:openclaw` in your process supervisor.
3. Optional: delete Redis keys `openclaw:*` if you want a clean slate (not required for correctness).

No core API or primary workers need restarting for rollback.

## Dry-run behavior (zero-write Postgres)

When `OPENCLAW_DRY_RUN=true`, OpenClaw runs in **full observational mode** for Postgres:

**Still happens**

- Outbound OpenClaw API calls (quota + circuit as usual).
- Payload parse, mapper validation, `malformed_job_rows` metrics.
- **Dedup simulation:** read-only `findBySourceUrl` on existing jobs + in-memory fingerprint (same as before — **not** full `isSameJob` soft match).
- Redis: daily metrics hash (`openclaw:metrics:*`), quota counter (`openclaw:quota:*`), paging cursor (`openclaw:paging:next_page`).
- In-process provider health / circuit state (`openclaw.state.ts`).

**Intentionally skipped (no Postgres writes, no discovery/enrichment side effects)**

- `Company` lookup/create, `ensureCompanyFromJob`, `DiscoveryService.processCompanyCandidate`, and any company **hint merge** (`mergeOpenClawHints`).
- `JobService.ingestDeduplicated` / canonical mutations.
- ATS endpoint creation (nothing in OpenClaw sync calls endpoint ingest).

Each sync emits structured logs once per run: `openclaw_dry_run_skip_company_resolution`, `openclaw_dry_run_skip_discovery`, `openclaw_dry_run_skip_enrichment`. Row logs include `syntheticCompanyId: true` on `openclaw_dry_run_row`.

**Synthetic company identity**

- Mapper + metrics use a stable `dry-run:<hash>` id derived from payload company name + domain hint. It **never** matches a real `Company.id`.
- `companyDomain` for fingerprinting prefers normalized payload `domain`, then `careersUrl` hostname, else `company:<syntheticId>`.

**When `OPENCLAW_DRY_RUN=false`**

- Prior behavior returns: real company resolution, optional discovery, optional hint merge, then `ingestDeduplicated`.

Use dry-run for multi-day observation without polluting companies or jobs; expect `companies_discovered` **not** to increment while dry-run is on.

## Source weighting

`openclaw` is weighted between `careers_page` and `remoteok` so canonical merges prefer direct ATS sources when duplicates exist, while still treating OpenClaw as structured third-party data (not as high as Greenhouse/Lever).

## ATS / company merge policy

OpenClaw hints update `Company` **only** when fields are empty, except:

- **Domain** and **careersUrl:** never overwritten once set.
- **ATS pair:** if **either** `atsType` or `atsBoardToken` is already set on the company (trusted enrichment/crawl), **both** OpenClaw ATS hint fields are skipped so we never patch or contradict primary detection.

OpenClaw does **not** modify job-level enrichment (`parsedDescription`, etc.) or canonical aggregation rules beyond normal ingest.

## Metrics (`/internal/metrics`)

When `OPENCLAW_ENABLED=true`, the snapshot may include `openclaw`:

- **runtime:** health, `quotaRemainingEstimate`, **`quotaUsedToday`** (successful quota admissions), circuit open time, etc.
- **metricsToday:** Redis hash `openclaw:metrics:YYYY-MM-DD` string counters, including:
  - `requests`, `jobs_normalized`, `jobs_merged`, `jobs_new_canonical`, `malformed_job_rows`, `failures`, `http_401`, `http_403`, `http_429`, etc.

This is **separate** from in-process counters like `jobMetrics.service.ts` — operators should treat OpenClaw metrics as provider-scoped.

## HTTP retry policy (vs ATS `fetchWithRetry`)

OpenClaw aligns **5xx** backoff **base** with `DEFAULT_ATS_FETCH_RETRY.baseDelayMs`. It **does not** retry `401`/`403` and **does not** retry `429` the way generic `fetchWithRetry` does, to protect daily quota. See comments in `openclaw.client.ts`.

## Known limitations

1. **No distributed scheduler lock** — if multiple scheduler instances run, more than one sync job may enqueue per interval; queue job ids are time-based so work can duplicate until you run a single scheduler.
2. **Per-process circuit state** — circuit breaker state is in-memory per worker; multiple workers do not share it.
3. **Partial dry-run dedup** — simulation is URL + fingerprint only; not full `isSameJob`.
4. **Dry-run still reads jobs by URL** — `findBySourceUrl` hits Postgres read-only for duplicate check; no writes.
5. **Isolated Redis metrics** — OpenClaw counters live in `openclaw:metrics:*` hashes, not the main dedup in-process metrics.

## Malformed payloads

Invalid listing URLs, invalid apply URLs, oversize title/location/ids, or non-object rows are **skipped** with `malformed_job_rows` incremented and structured logs (`openclaw_mapper_reject`). Workers must not crash on bad API shapes.
