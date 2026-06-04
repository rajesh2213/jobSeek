# Post-Rollout Expansion Report

Generated: 2026-05-14T20:45:18.134Z

## Current State

### Endpoint Counts
- isActive=false: 143
- isActive=true: 731

### Score Distribution
- 8-39: 33
- 80+: 134
- 40-79: 435
- 0-7: 272

### Freshness Histogram (Active)
- <1h: 111
- 1-6h: 32
- never: 23
- >24h: 134
- 6-24h: 431

### Key Metrics
- active_endpoints: 731
- inactive_endpoints: 143
- orphan_active: 163
- freshly_monitored_companies: 141
- recoverable_inactive: 40
- jobs_last_24h: 1427

## Before vs After Comparison

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| active_endpoints | 692 | 731 | +39 (+6%) |
| inactive_endpoints | 153 | 143 | -10 (-7%) |
| orphan_active | 141 | 163 | +22 (+16%) |
| freshly_monitored_companies | 422 | 141 | -281 (-67%) |
| recoverable_inactive | n/a | 40 | n/a |
| jobs_last_24h | n/a | 1427 | n/a |

### Score Distribution Change

| Tier | Before | After | Delta |
|------|--------|-------|-------|
| 80+ | 0 | 134 | +134 (+100%) |
| 40-79 | 0 | 435 | +435 (+100%) |
| 8-39 | 148 | 33 | -115 (-78%) |
| 0-7 | 697 | 272 | -425 (-61%) |

## Assessment

### Safety Indicators
- Active endpoint count: 731 (target: growing)
- Orphan endpoints: 163 (target: decreasing)
- Recoverable inactive: 40 (target: decreasing via recovery)

### Next Steps
1. Monitor for 12h after deploy
2. Check queue health via /internal/ingestion/health
3. Verify score distribution is diversifying (should see 40+ scores emerging)
4. Run recovery script for inactive endpoints with recent success
