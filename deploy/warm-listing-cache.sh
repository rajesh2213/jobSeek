#!/bin/bash
# Populate Redis listing caches when the DB pool is saturated by workers.
# Pauses BullMQ workers briefly, warms /jobs + /companies, then restarts workers.

set -euo pipefail

API_PORT="${JOBSEEK_API_PORT:-3000}"
BASE="http://127.0.0.1:${API_PORT}"

worker_units=(
  jobseek-worker
  jobseek-worker-2
  jobseek-scheduler
  jobseek-inference
  jobseek-enrich
  jobseek-ats-worker
  jobseek-ats-scheduler
  jobseek-ats-discovery-scheduler
  jobseek-ats-discovery-worker
  jobseek-discovery-scheduler
  jobseek-discovery-worker
  jobseek-job-status-reconcile-scheduler
  jobseek-job-status-reconcile
  jobseek-job-alerts-worker
  jobseek-job-alerts-scheduler
  jobseek-growth-email-worker
  jobseek-growth-email-scheduler
  jobseek-score
  jobseek-openclaw-worker
  jobseek-openclaw-scheduler
  jobseek-serp-worker
  jobseek-job-purge-worker
)

echo "Stopping workers..."
for u in "${worker_units[@]}"; do
  sudo systemctl stop "$u" 2>/dev/null || true
done

sudo systemctl restart jobseek-api
sleep 10

echo "Warming listing caches..."
curl -sf "${BASE}/jobs?page=1&limit=20" -o /tmp/warm-jobs.json -w "jobs %{http_code} %{time_total}s\n" --max-time 60 || true
curl -sf "${BASE}/companies?page=1&limit=20" -o /tmp/warm-co.json -w "companies %{http_code} %{time_total}s\n" --max-time 60 || true

echo "Starting workers..."
for u in "${worker_units[@]}"; do
  sudo systemctl start "$u" 2>/dev/null || true
done

echo "Done."
