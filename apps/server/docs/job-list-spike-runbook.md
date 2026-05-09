# Job list (`/jobs`) spike runbook

Operational evidence for intermittent `metered_list` slowness (e.g. historical 5–10s vs current sub-second). **No query or API behavior changes** are required to use this runbook—only env flags, logs, and read-only tools.

## 1. Capture Server-Timing (browser or curl)

```bash
curl -sSI 'https://YOUR_API/jobs?limit=20' | tr -d '\r' | grep -i server-timing
```

Segments: `rate_limit`, `cap_ctx`, `metered_list`. A large `metered_list` with small `rate_limit`/`cap_ctx` points to listing + DB work.

## 2. Correlate API logs (structured)

| Event | When | Purpose |
|--------|------|---------|
| `JOB_LIST_METERED_SLOW` | `metered_list` ≥ `JOB_LIST_METERED_SLOW_MS` | Full route segment + event-loop utilization + filter summary |
| `JOB_LIST_SLOW` | `findManyCanonicalFiltered` total ≥ `JOB_LIST_SLOW_THRESHOLD_MS` | `queryIdsMs` / `hydrateMs` / `reorderMs` + optional `jobListHttp*` correlation |
| `prisma_query_diag` | `PRISMA_QUERY_DIAG=1` (rate-limited) | SQL preview, duration, redacted binds; includes `jobListDiag` when inside `/jobs` |

**journalctl example**

```bash
journalctl -u jobseek-api.service --since '10 min ago' | grep -E 'JOB_LIST_METERED_SLOW|JOB_LIST_SLOW|prisma_query_diag'
```

**Rollback:** unset `JOB_LIST_METERED_SLOW_MS`, `JOB_LIST_SLOW_THRESHOLD_MS`, `PRISMA_QUERY_DIAG`; restart API.

## 3. Postgres activity (locks / waits / saturation)

**HTTP (loopback + Bearer in production):**

```bash
curl -sS 'http://127.0.0.1:3000/internal/db/pg-activity' \
  -H "Authorization: Bearer $INTERNAL_DB_DIAG_SECRET_OR_METRICS_TOKEN" | jq .
```

**CLI (no HTTP):**

```bash
cd /path/to/jobSeek && npm run diag:pg-activity -w @jobseek/server | jq .
```

Interpret `summary` (counts by `state` / `wait_event`). High `active` with `wait_event` = Lock, IO, or Client often indicates contention. `idle in transaction` samples highlight stuck transactions.

Through **PgBouncer**, `pg_stat_activity` may be partial or show pooler metadata—use a **direct** session connection for forensic `EXPLAIN` and full stats when safe.

## 4. Plan forensics (id-list query)

Same SQL shape as production listing ids:

```bash
npm run explain:job-listing -w @jobseek/server -- --scenario=bare --sort=salary_desc --analyze
```

Compare `latest` vs `salary_desc`. Note seq scans, sort nodes, buffer hits, and index names (see script hints).

## 5. Incident timeline (simple correlation)

1. Note spike **wall time** (UTC).
2. Pull logs for `JOB_LIST_METERED_SLOW` / `JOB_LIST_SLOW` at that window.
3. If `PRISMA_QUERY_DIAG` was on, match `prisma_query_diag` timestamps and `sqlSha256_16` / `sqlPreview` to listing queries.
4. Run `diag:pg-activity` (or save periodic snapshots) for wait events and blocking patterns.
5. Compare **normal** vs **spike** `EXPLAIN (ANALYZE, BUFFERS)` for the same `scenario` + `sort`.

## 6. What we cannot see from the app alone

- Exact **PgBouncer** queue depth (use `SHOW POOLS` / admin console on the pooler).
- **Prisma pool** wait time (driver pool is not exposed); proxy: DB session counts + app CPU + `JOB_LIST_*` splits.
- **Noisy neighbor** on the VPS: correlate with host metrics (CPU steal, disk, network).

## 7. Safest next engineering steps (after evidence)

- If spikes correlate with **wait_event Lock/IO** and saturated connections → pool sizing, transaction duration, index/plan work—not another hydrate experiment.
- If `queryIdsMs` dominates on `salary_desc` only → plan/selectivity (EXPLAIN), not Prisma relation shape.
- If `hydrateMs` dominates with idle DB → CPU/event-loop or payload (already profiled elsewhere).
