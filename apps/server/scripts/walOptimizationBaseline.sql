-- JobLoom / Supabase: baseline and post-deploy checks for WAL / IO optimization rollout.
-- Run against production (read-only queries) before Deploy A and after each soak period.
-- Store outputs with timestamps for comparison.

-- Index inventory
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('Job', 'Company', 'AtsEndpoint')
ORDER BY tablename, indexname;

-- Dead tuples / autovacuum (success = slower n_dead_tup growth on Job after fewer UPDATEs)
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct_approx,
  vacuum_count,
  autovacuum_count,
  last_vacuum,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('Job', 'Company', 'AtsEndpoint')
ORDER BY relname;

-- Cluster-wide: expect tup_updated to drop after Deploy A (hash-cache conditional updates)
SELECT
  datname,
  xact_commit,
  xact_rollback,
  tup_updated,
  tup_returned,
  blks_read,
  blks_hit,
  deadlocks
FROM pg_stat_database
WHERE datname = current_database();

-- Deploy D: lock / session sampling (run during peak ingest; LIMIT keeps it light)
SELECT pid, usename, state, wait_event_type, wait_event,
       now() - query_start AS duration, left(query, 120) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
ORDER BY query_start
LIMIT 50;

SELECT l.locktype, l.relation::regclass, l.mode, l.granted, a.pid, left(a.query, 80) AS query_preview
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
LIMIT 50;

-- Ingestion sanity (tune interval)
SELECT count(*) AS canonicals_created_1h
FROM "Job"
WHERE "canonicalJobId" IS NULL AND "createdAt" > now() - interval '1 hour';

-- Phase 2 DDL: paste exact Query Insights text before creating Company indexes:
-- EXPLAIN (ANALYZE, BUFFERS) <query>;
