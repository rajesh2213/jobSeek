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

echo "Restarting jobseek-api..."
sudo systemctl restart jobseek-api
sleep 12

batch=0
for svc in "${services[@]}"; do
  if [[ "$svc" == "jobseek-api" ]]; then
    continue
  fi
  echo "Restarting $svc..."
  sudo systemctl restart "$svc"
  batch=$((batch + 1))
  if (( batch % 5 == 0 )); then
    sleep 4
  fi
done

echo "Done."
