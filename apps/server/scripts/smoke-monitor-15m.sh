#!/usr/bin/env bash
# 15 samples, 60s apart. Run from monorepo root: bash apps/server/scripts/smoke-monitor-15m.sh
set -euo pipefail
OUT="${SMOKE_REPORT_PATH:-/tmp/smoke_monitor_15m.log}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
: >"$OUT"
{
  echo "=== smoke 15m start $(date -Is) ==="
  for i in $(seq 1 15); do
    echo ""
    echo "----- tick $i/15 $(date -Is) -----"
    echo "## enrich: domain_resolved (last 2 min, count)"
    journalctl -u jobseek-enrich --since "2 min ago" --no-pager 2>/dev/null | grep -c domain_resolved || true
    echo "## enrich: domain_missing (last 2 min, count)"
    journalctl -u jobseek-enrich --since "2 min ago" --no-pager 2>/dev/null | grep -c domain_missing || true
    echo "## workers: ai_parse_latency (last 2 min, count)"
    journalctl -u jobseek-worker -u jobseek-worker-2 --since "2 min ago" --no-pager 2>/dev/null | grep -c ai_parse_latency || true
    echo "## workers: parse_cache (last 2 min, count)"
    journalctl -u jobseek-worker -u jobseek-worker-2 --since "2 min ago" --no-pager 2>/dev/null | grep -c parse_cache || true
    echo "## workers: job_skipped_recent_duplicate (last 2 min, count)"
    journalctl -u jobseek-worker -u jobseek-worker-2 --since "2 min ago" --no-pager 2>/dev/null | grep -c job_skipped_recent_duplicate || true
    echo "## scheduler: company_priority_distribution (last 3 min, count)"
    journalctl -u jobseek-scheduler --since "3 min ago" --no-pager 2>/dev/null | grep -c company_priority_distribution || true
    echo "## db snapshot (tsx)"
    env -u NODE_ENV npx tsx apps/server/scripts/smokeQuerySnapshot.ts 2>&1 || echo "db_snapshot_failed"
    echo "## monitor:pipeline (head)"
    env -u NODE_ENV npm run monitor:pipeline -w @jobseek/server 2>&1 | head -n 40 || true
    if [ "$i" -lt 15 ]; then sleep 60; fi
  done
  echo ""
  echo "=== smoke 15m end $(date -Is) ==="
} | tee -a "$OUT"
echo "Wrote $OUT"
