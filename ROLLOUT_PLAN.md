# Freshness Expansion Rollout Plan

## Overview

This rollout improves crawl coverage, freshness distribution, and endpoint lifecycle
correctness for JobLoom's ATS ingestion system.

**Key changes:**
1. `markSuccess` now resets `failureCount` and increments `successCount` (bug fix)
2. Per-job parse failures no longer trigger endpoint-level `markFailure` (< 50% threshold)
3. Workday timeout reduced from 600s to 120s (env-configurable)
4. Provider concurrency caps (Workday max 1 concurrent)
5. Dynamic endpoint scoring (0-100, tiered scheduling)
6. Freshness tiering (Hot 15m / Warm 2h / Cold 8h)
7. Enhanced observability (provider freshness, score tiers, recovery candidates)

## Pre-Deployment Checklist

- [x] Baseline snapshot captured (`deploy-snapshots/freshness-expansion-before/`)
- [x] TypeScript builds clean (`npx tsc --noEmit`)
- [x] No schema migrations required
- [x] All changes are backward-compatible
- [x] Dry-run scripts tested

## Rollout Steps

### Step 1: Deploy Correctness Fixes (Immediate)

Deploy the code changes:
- `apps/server/src/modules/atsEndpoint/atsEndpoint.service.ts`
- `apps/server/src/workers/atsEndpoint.processor.ts`
- `apps/server/src/modules/atsEndpoint/atsEndpointScoring.ts`
- `apps/server/src/modules/atsEndpoint/atsEndpoint.scheduler.ts`
- `apps/server/src/services/ingestionObservability.service.ts`

**Risk:** LOW — fixes a bug where failures accumulate permanently.

**Monitor for 12h:**
```bash
# Check logs for new lifecycle events
grep "endpoint_success_lifecycle" logs/server.log | tail -20
grep "endpoint_score_updated" logs/server.log | tail -20
grep "endpoint_job_partial_failures" logs/server.log | tail -20
```

### Step 2: Observe Workday Timeout (12h after Step 1)

The Workday timeout reduction is active immediately via `PROVIDER_TIMEOUT_MS`.
Default: 120s (was 600s).

**Override if needed:**
```bash
# In .env - increase if too many Workday timeouts
ATS_WORKDAY_FETCH_TIMEOUT_MS=180000
```

**Monitor:**
```bash
grep "ats_endpoint_fetch_timeout" logs/server.log | grep workday
```

### Step 3: Recover Endpoints (24h after Step 1)

```bash
# Preview recoverable endpoints
cd /home/ubuntu/jobSeek
npx tsx scripts/ingestion/recoverRecoverableEndpoints.ts --dry-run --limit 10

# If results look good, recover first batch
npx tsx scripts/ingestion/recoverRecoverableEndpoints.ts --no-dry-run --limit 5
```

**Observe 6h**, then:
```bash
npx tsx scripts/ingestion/recoverRecoverableEndpoints.ts --no-dry-run --limit 10
```

### Step 4: Link Orphan Endpoints (48h after Step 1)

```bash
# Preview with high confidence threshold
npx tsx scripts/ingestion/linkOrphanEndpoints.ts --dry-run --limit 20 --min-confidence 3

# Execute with high confidence only
npx tsx scripts/ingestion/linkOrphanEndpoints.ts --no-dry-run --limit 20 --min-confidence 3
```

### Step 5: Materialize Missing Endpoints (72h after Step 1)

```bash
# Preview
npx tsx scripts/ingestion/materializeMissingEndpoints.ts --dry-run --limit 25

# First batch (if candidates exist)
npx tsx scripts/ingestion/materializeMissingEndpoints.ts --no-dry-run --limit 25 --delay-ms 500
```

**Observe 12h**, then:
```bash
npx tsx scripts/ingestion/materializeMissingEndpoints.ts --no-dry-run --limit 50 --delay-ms 300
```

### Step 6: Increase Concurrency (1 week after Step 1)

**Only if metrics justify it:**
- Queue wait times acceptable (< 60s p50)
- No DB pool exhaustion
- Score distribution diversifying

```bash
# In .env
ATS_ENDPOINT_WORKER_CONCURRENCY=2
```

### Step 7: Validate

```bash
npx tsx scripts/ingestion/validateRollout.ts
```

Review `POST_ROLLOUT_EXPANSION_REPORT.md`.

## Rollback Plan

### Immediate Rollback (Code Changes)

```bash
git revert HEAD  # Reverts the deployment commit
# Restart server
```

### Env-Only Rollback (Timeouts/Concurrency)

```bash
# Restore original values in .env:
ATS_WORKDAY_FETCH_TIMEOUT_MS=600000
ATS_ENDPOINT_WORKER_CONCURRENCY=1
ATS_COOLDOWN_COLD_MS=7200000  # 2 hours (old default)
# Restart server
```

### Recovery Script Rollback

Recovered endpoints will naturally deactivate again if they're truly broken
(failureCount will re-accumulate). No manual action needed.

## Environment Variables (New)

| Variable | Default | Description |
|----------|---------|-------------|
| `ATS_WORKDAY_FETCH_TIMEOUT_MS` | 120000 | Workday-specific fetch timeout |
| `ATS_WORKDAY_MAX_CONCURRENT` | 1 | Max concurrent Workday crawls |
| `ATS_COOLDOWN_HOT_MS` | 900000 (15m) | Crawl interval for score >= 80 |
| `ATS_COOLDOWN_WARM_MS` | 7200000 (2h) | Crawl interval for score 40-79 |
| `ATS_COOLDOWN_COLD_MS` | 28800000 (8h) | Crawl interval for score < 40 |

## Expected Outcomes (4 weeks)

| Metric | Before | Target |
|--------|--------|--------|
| Active endpoints | 692 | ~750-800 |
| Freshly monitored companies (6h) | 425 | ~550-650 |
| Score >= 40 endpoints | 0 | ~200-400 |
| Score >= 80 endpoints | 0 | ~50-100 |
| Incorrect deactivations/week | ~15-20 | < 5 |
| Workday queue blocking | 10min | 2min |

## Files Changed

```
apps/server/src/modules/atsEndpoint/atsEndpoint.service.ts    # markSuccess fix
apps/server/src/modules/atsEndpoint/atsEndpointScoring.ts     # NEW: dynamic scoring
apps/server/src/modules/atsEndpoint/atsEndpoint.scheduler.ts  # tiering update
apps/server/src/workers/atsEndpoint.processor.ts              # timeout + guard
apps/server/src/services/ingestionObservability.service.ts    # new metrics
scripts/ingestion/materializeMissingEndpoints.ts              # NEW: endpoint creation
scripts/ingestion/recoverRecoverableEndpoints.ts              # NEW: endpoint recovery
scripts/ingestion/linkOrphanEndpoints.ts                      # NEW: orphan linking
scripts/ingestion/safetyChecks.ts                             # NEW: safety guards
scripts/ingestion/validateRollout.ts                          # NEW: validation
deploy-snapshots/freshness-expansion-before/                  # baseline data
```
