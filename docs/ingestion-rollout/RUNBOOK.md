# Ingestion reliability rollout (runbook)

This rollout is **code + configuration** only: deploy the API/workers, then enable flags in **canary** order. No DB migrations.

## Exact rollout order (production)

1. **API** — ship build with `/internal/ingestion/health`, observability snapshot changes, and read-only scripts.
2. **Schedulers** — ATS endpoint scheduler, SERP scheduler (daemon or cron one-shot), discovery as applicable.
3. **Workers** — job processor, ATS endpoint worker, SERP worker, reconcile worker (unchanged flags first).

Do **not** enable optional env flags until API health scraping is live and a **before** baseline is stored.

## Phase 0 — BEFORE snapshot (no production writes)

```bash
cd apps/server
npx tsx scripts/ingestion/captureBaseline.ts > /tmp/ingestion-baseline-before.json
npx tsx scripts/ingestion/forensicPrimaryProcessing.ts --sample 25 > /tmp/forensic-processing-before.json
```

Store worker env hints (`ATS_ENDPOINT_WORKER_CONCURRENCY`, etc.) alongside these files.

**Rollback:** revert deploy; unset new env flags; restore previous systemd unit for SERP if you switch daemon mode; re-run baseline capture to confirm recovery.

## Phase 1 — Observability (API first)

1. Set `INTERNAL_METRICS_TOKEN` (shared with `/internal/metrics`).
2. Poll **`GET /internal/ingestion/health`** with `Authorization: Bearer <token>`.
3. Scrape interval **30–60s** (bounded Prisma work + capped Bull queue probes; no parallel Prisma fan-out).

**Payload highlights**

- `queues[]` — `waiting`, `active`, `failed`, `oldestWaitingMs`.
- `endpoints` — staleness row + **age histogram** (`crawled_age_*`) + `p50_age_min` / `p95_age_min` since `lastCrawledAt`.
- `endpointFreshnessDrift` — convenience counts: endpoints older than **1h / 6h / 24h** (includes never-crawled).
- `primaryJobs` — canonical primaries in `processing` vs `ready`, parse split, oldest processing age.
- `throughput1h` — jobs created, endpoint crawls, companies created (rolling 1h).
- `reconcileStaleParsedProcessing` + `reconcileOldestStaleMinutes` — reconcile backlog estimate.
- `atsEndpointActiveByType` — active endpoints by provider `type` (top 32).
- `ingestAtsQueueWaitP50Ms` / `ingestAtsQueueWaitP95Ms` — sampled from up to **20** waiting ATS jobs (not exact percentiles).
- `serpSchedulerHeartbeat` — Redis key `scheduler:serp:heartbeat`.

## Phase 2 — Stuck primaries (investigate → optional reconcile)

1. Read-only: `npm run ingestion:forensic-processing -w @jobseek/server` (add `--deep` for slower duplicate/pattern sampling).
2. **Typical root cause:** `processing` without `parsedDescription` never matches `jobStatusReconcile`’s default rule; ATS path may skip parse when content hash unchanged.
3. **Canary remediation:** set **`JOB_STATUS_RECONCILE_LONG_DESC_READY=true`** on the **job-status-reconcile worker** only after buckets match expectation. **Default remains off.**

## Phase 3 — SERP scheduler

- **Legacy (cron one-shot):** leave `SERP_SCHEDULER_INTERVAL_MS` unset — process exits after one enqueue (writes heartbeat once).
- **Daemon (recommended):** set `SERP_SCHEDULER_INTERVAL_MS` to **≥ 60000** (e.g. `3600000` for hourly). Process stays up, enqueues on interval, refreshes heartbeat each time. Use **systemd `Type=simple`**; remove duplicate cron that would double-enqueue. Duplicate daemon boot in the **same process** is guarded and will fail fast.

## Phase 4 — ATS worker concurrency (canary only)

**Concurrency = 2 warning checklist**

- [ ] Baseline JSON captured (Phase 0).
- [ ] Off-peak window; DB CPU headroom observed.
- [ ] `/internal/ingestion/health` scraping active; alerts wired.
- [ ] `ingest-ats-endpoint.oldestWaitingMs` and `ingestAtsQueueWaitP95Ms` acceptable vs baseline.
- [ ] Rollback plan: set `ATS_ENDPOINT_WORKER_CONCURRENCY=1` and restart worker only.

Steps:

1. Set **`ATS_ENDPOINT_WORKER_CONCURRENCY=2`** on **ats-endpoint worker** during low traffic.
2. Watch health JSON for queue depth and DB saturation.
3. Roll back to `1` if failures or DB pressure spike.

## Phase 5 — Scheduler fairness (ATS) — **24h canary**

- **`ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE`** (0 = **off**, 1–50): per-type cap on the **first** scheduling pass; second pass fills without caps so small providers are not permanently starved.
- **Canary:** start with **`ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE=10`** (not default). Observe **24h** before tightening further.
- **Expected after fairness canary:** more even `ats_endpoint_scheduler_fairness.enqueueByType` distribution in scheduler logs; `ingest-ats-endpoint.waiting` stable or improving vs Workday-dominated baseline; `skippedFirstPassByType` non-zero when caps bind.

## Phase 6 — Heavy internal metrics CLI

- Set **`METRICS_SNAPSHOT_SEQUENTIAL=true`** when running `npm run metrics -w @jobseek/server` against small Prisma pools to avoid `P2024` pool timeouts.

## Validation commands (read-only)

```bash
cd apps/server
npm run ingestion:baseline -w @jobseek/server > /tmp/ingestion-baseline-after.json
npm run ingestion:validate-rollout -w @jobseek/server -- --baseline /tmp/ingestion-baseline-before.json
# Or set INGESTION_HEALTH_URL and INTERNAL_METRICS_TOKEN for remote API.
npm run ingestion:forensic-processing -w @jobseek/server -- --sample 25
npm run ingestion:forensic-processing -w @jobseek/server -- --sample 25 --deep
```

## Suggested alert thresholds (tune to your VPS)

| Signal | Warn | Page |
|--------|------|------|
| `ingest-ats-endpoint.waiting` | > 40 | > 80 |
| `oldestWaitingMs` (ATS queue) | > 15 min | > 45 min |
| `ingestAtsQueueWaitP95Ms` | > 15 min | > 45 min |
| `endpoints.p95_age_min` | > 360 | > 720 |
| `endpointFreshnessDrift.olderThan24h` | trend up 2 scrapes | sudden large jump |
| `primaryJobs.processing_primaries` | > 3000 | > 8000 |
| `primaryJobs.processing_parse_present` | > 50 | > 200 (reconcile backlog) |
| `reconcileStaleParsedProcessing` | > 50 | > 200 |
| `throughput1h.jobsCreated` | < 20 in 2 consecutive scrapes | < 5 |
| `serpSchedulerHeartbeat.ageMs` (daemon) | > 2× interval | > 4× interval |

## Post-deploy validation checklist

- [ ] `GET /internal/ingestion/health` returns 200 with expected shape.
- [ ] SERP heartbeat `ageMs` fresh vs cron or `SERP_SCHEDULER_INTERVAL_MS`.
- [ ] ATS queue `waiting` / `oldestWaitingMs` not regressing vs baseline.
- [ ] Endpoint histogram / drift counts stable or improving.
- [ ] No Prisma `P2024` storm on API; no unexpected ready-job surge.

## Concise rollout report template

- **Deployment:** API / schedulers / workers revisions and times.
- **Canary flags:** e.g. `ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE`, `JOB_STATUS_RECONCILE_LONG_DESC_READY`, `ATS_ENDPOINT_WORKER_CONCURRENCY`.
- **Queues:** `ingest-ats-endpoint`, `job-processing` — waiting, failed, oldest waiting.
- **Endpoints:** `endpointFreshnessDrift`, histogram buckets, `p50_age_min` / `p95_age_min`.
- **Risks observed:** spikes, heartbeat gaps, reconcile backlog.
- **Rollback:** required? (yes/no + what was reverted).
