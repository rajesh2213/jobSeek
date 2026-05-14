#!/bin/bash
# Restart all JobSeek Node/systemd workers after deploy (`git pull`, `npm run build:server`).
# Matches units under deploy/systemd/*.service

services=(
  jobseek-api
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
)

for svc in "${services[@]}"; do
  echo "Restarting $svc..."
  sudo systemctl restart "$svc"
done

echo "Done."
