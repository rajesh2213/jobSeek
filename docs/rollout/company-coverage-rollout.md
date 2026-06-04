# Production Rollout — Company Coverage, Hiring Metrics, Discovery Expansion

Generated: 2026-06-03

---

## Phase 0 — Pre-Change Audit (Mandatory)

### Companies page query plan

**Stats (`getCompaniesListingStats`)**

| Query | Plan (pre-index) | Plan (post-index) |
|-------|------------------|-------------------|
| `activeHiringCompanies` | Index Scan `Job_companyId_idx`, ~304ms, 71k rows filtered | Index Only Scan `idx_jobs_active_hiring_company`, ~sub-10ms expected |
| `hiringThisWeek` (legacy) | BitmapAnd on `Job_canonicalJobId_lastSeenAt_idx` + `Job_status_idx`, ~32ms | unchanged |

**Listing (`listCompaniesDiscovery`)**

- HashAggregate over full Company table + LEFT JOIN Job (seq scan on Job ~74k matching rows)
- Execution ~140ms for page-1 sort by jobCount
- Unaffected by this rollout (no listing query changes)

### API response shape (`GET /companies`)

```json
{
  "data": [ /* CompanyListingRow[] */ ],
  "meta": {
    "page": 1,
    "limit": 24,
    "total": 10335,
    "totalPages": 431,
    "hasMore": true,
    "stats": {
      "totalTracked": 10335,
      "hiringThisWeek": 303,
      "activeHiringCompanies": 1314
    }
  }
}
```

Backward compatible: `hiringThisWeek` retained.

### Redis cache

| Key | TTL | Contents |
|-----|-----|----------|
| `companies:stats:v1` | 300s | Legacy (read-only fallback on pool exhaustion) |
| `companies:stats:v2` | 300s | `totalTracked`, `hiringThisWeek`, `activeHiringCompanies` |
| `companies:agg:v1:*` | 120s | Full anonymous listing responses (unchanged) |

### Throughput (production snapshot 2026-06-03)

| Pipeline | Rate | Notes |
|----------|------|-------|
| ATS endpoint scheduler | ~40 enqueues / 5–8 min | Pool 100, batch 40 |
| ATS endpoint worker | concurrency 1 | 44 waiting, 1 active |
| Discovery scheduler | 6 sources / 10 min + enrich backlog | Default batch 30 → env `DISCOVERY_ENRICH_BATCH_SIZE` |
| Enrich worker | concurrency 4 (env) | `DISCOVERY_ENRICH_CONCURRENCY` alias added |
| Legacy crawler | 10 min interval | 719 crawlable companies |

### Queue depths (live)

| Queue | Waiting | Active |
|-------|--------:|-------:|
| `ingest-ats-endpoint` | 44 | 1 |
| `serp-ingestion` | 15 | 0 (worker was dead — restart required) |
| Others | 0 | 0 |

### Indexes (relevant)

**Job**

- `Job_companyId_idx`
- `Job_canonicalJobId_lastSeenAt_idx`
- `Job_status_idx`
- `Job_isActive_expiresAt_idx`
- `idx_jobs_active_hiring_company` **(new)** — partial index for active hiring stats

**Company**

- `Company_lastAttemptAt_idx`
- `Company_priority_score_idx`
- No index on `status` (table scan acceptable at ~10k rows)

---

## Phase 1–8 — Changes Summary

### Files changed

**Backend**

- `apps/server/src/modules/company/company.repository.ts` — `activeHiringCompanies` query
- `apps/server/src/modules/company/companyStatsCache.ts` — `companies:stats:v2`
- `apps/server/src/modules/company/company.routes.ts` — response type
- `apps/server/src/infrastructure/db/listingDegradedResponse.ts`
- `apps/server/src/services/companyCoverage.service.ts` **(new)**
- `apps/server/src/services/workerHeartbeat.service.ts` **(new)**
- `apps/server/src/services/metricsSnapshot.service.ts` — internal coverage/funnel/heartbeats
- `apps/server/src/services/ingestionObservability.service.ts` — enrich safety signals
- `apps/server/src/modules/internal/internal.metrics.routes.ts`
- `apps/server/src/modules/discovery/discovery.scheduler.ts` — `DISCOVERY_ENRICH_BATCH_SIZE`
- `apps/server/src/modules/atsEndpoint/atsEndpoint.scheduler.ts` — env aliases for pool/batch/cooldowns
- Worker heartbeats: `enrich-company`, `job-processing`, `ingest-ats-endpoint`, `company-discovery`, `serp-ingestion`, `job-purge`, `discover-ats-endpoints`, `company-score`

**Frontend**

- `apps/client/components/companies/CompaniesSearchClient.tsx` — badge text
- `apps/client/lib/api.ts`, `page.tsx`, `CompaniesSearchPage.tsx`, `app/api/companies/route.ts`

**Migration**

- `apps/server/prisma/migrations/20260603120000_job_active_hiring_company_index/migration.sql`

### New env variables (defaults preserve current behavior)

```env
DISCOVERY_ENRICH_BATCH_SIZE=30
DISCOVERY_ENRICH_CONCURRENCY=4          # alias for ENRICH_COMPANY_WORKER_CONCURRENCY
ATS_ENDPOINT_BATCH_SIZE=40
ATS_ENDPOINT_POOL_SIZE=100                # alias for ATS_ENDPOINT_POOL_LIMIT
ATS_ENDPOINT_HIGH_PRIORITY_COOLDOWN_MINUTES=15
ATS_ENDPOINT_MEDIUM_PRIORITY_COOLDOWN_MINUTES=120
ATS_ENDPOINT_LOW_PRIORITY_COOLDOWN_MINUTES=480
```

### Internal metrics (`GET /internal/metrics`)

New sections:

- `companyCoverageStats`
- `discoveryFunnel`
- `atsRediscoveryBacklog` (candidates only, not processed)
- `atsEndpointCoverage`
- `workerHeartbeats`

`/internal/ingestion/health` adds:

- `enrichThroughput` (lag, failure rate, `abortAggressiveScaling`)
- `workerHeartbeats`

---

## Phase 9 — Rollout Checklist

### Step 1 — Deploy backend only

- [ ] Apply migration: `idx_jobs_active_hiring_company` (CONCURRENTLY — already safe to run pre-deploy)
- [ ] Deploy API + workers + schedulers
- [ ] Restart dead workers: `jobseek-serp-worker`, `jobseek-job-purge-worker`
- [ ] Validate `GET /companies` returns `activeHiringCompanies: 1314` (approx)
- [ ] Validate `companies:stats:v2` populated in Redis
- [ ] Check `/internal/metrics` for `companyCoverageStats`, `workerHeartbeats`

### Step 2 — Verify production metrics (24h baseline)

- [ ] DB CPU / query latency stable
- [ ] `activeHiringCompanies` query < 50ms (post-index)
- [ ] Queue depths not growing unbounded
- [ ] Worker heartbeats all `healthy` (< 5 min)

### Step 3 — Deploy frontend

- [ ] Badge shows: `10,335 companies tracked` / `1,314 actively hiring`
- [ ] No references to "hiring this week" in UI
- [ ] SEO: `/companies` metadata unchanged (still indexable)

### Step 4 — Scale discovery (optional, after safety check)

- [ ] Confirm `enrichThroughput.abortAggressiveScaling === false`
- [ ] Raise `DISCOVERY_ENRICH_BATCH_SIZE` gradually (30 → 100 → 200)
- [ ] Raise `DISCOVERY_ENRICH_CONCURRENCY` if queue lag persists
- [ ] Raise `ATS_ENDPOINT_BATCH_SIZE` / lower cooldown envs if endpoint coverage < target

---

## Risk Assessment

| Area | Rating | Mitigation |
|------|--------|------------|
| Metric accuracy | 🟢 Improved | Uses active ready jobs, not crawl touch |
| Query performance | 🟢 Improved | Partial index on active hiring |
| API compatibility | 🟢 Safe | Additive field only |
| SEO | 🟢 No change | SSR still empty hydrate; metadata unchanged |
| Ingestion stability | 🟡 Monitor | Scale via env; abort signals in `/internal/ingestion/health` |
| Worker observability | 🟢 Improved | Heartbeats expose dead workers |

---

## Production Validation Report (2026-06-03)

| Check | Result |
|-------|--------|
| `totalTracked` | 10,335 ✅ |
| `activeHiringCompanies` | 1,314 ✅ |
| `hiringThisWeek` (legacy) | 303 ✅ |
| Index `idx_jobs_active_hiring_company` | Created ✅ |
| Server TypeScript | Pass ✅ |
| SERP worker | **Dead since 2026-05-19** — restart required |
| Purge worker | **Dead since 2026-05-19** — restart required |

### Monitoring dashboard additions

1. **Companies coverage panel** — scrape `companyCoverageStats` from `/internal/metrics`
2. **Discovery funnel** — `discoveryFunnel.stages[]` conversion rates
3. **Worker health** — alert on `workerHeartbeats[].status !== healthy`
4. **Enrich scaling guard** — alert when `enrichThroughput.abortAggressiveScaling === true`
5. **ATS coverage** — `atsEndpointCoverage.endpointsCrawled7d / activeEndpoints`
