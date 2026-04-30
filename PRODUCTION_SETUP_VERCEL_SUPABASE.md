# Production Setup: Vercel + Supabase + VPS (API, Workers, Schedulers, Inference)

This runbook is an end-to-end setup for:

- `apps/client` on Vercel
- `apps/server` API + all workers/schedulers on one Linux VPS
- `apps/inference` FastAPI on the same VPS (localhost-only)
- Supabase for PostgreSQL
- Redis on VPS (or Upstash)

Use this when you want a cost-effective production deployment with clear operational steps.

---

## 1) Target Architecture

- Vercel hosts the Next.js client.
- A VPS hosts:
  - Fastify API (`npm run start:server`)
  - Inference (`uvicorn app:app --host 127.0.0.1 --port 8001`)
  - Worker and scheduler processes (systemd services)
  - Redis (local) or external Upstash Redis
- Supabase hosts PostgreSQL (`DATABASE_URL`).

---

## 2) Prerequisites

- Node.js `>= 20`
- npm
- Python `3.10+`
- Ubuntu VPS (recommended: 2 vCPU / 4 GB RAM minimum; 4 vCPU / 8 GB better headroom)
- Domain name for API (example: `api.yourdomain.com`)
- Vercel project for `apps/client`
- Supabase project

---

## 3) Supabase Setup (Postgres)

1. Create a Supabase project in the closest region to your VPS/Vercel users.
2. In Supabase dashboard, go to Database connection details and copy the Postgres URI.
3. Set repo root `.env`:

```env
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres?sslmode=require
```

Notes:
- Keep `sslmode=require`.
- Start simple with one `DATABASE_URL`. This repo currently expects that variable.

---

## 4) VPS Bootstrap

On a fresh Ubuntu server:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential python3 python3-venv python3-pip redis-server
```

Install Node 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Security basics:
- Create non-root deploy user with sudo.
- Allow only ports `22`, `80`, `443` in firewall.
- Do not expose inference (`8001`) publicly.

---

## 5) Clone Repo + Install Dependencies

```bash
mkdir -p ~/apps
cd ~/apps
git clone <your-repo-url> jobSeek
cd jobSeek
npm install
```

Create env file:

```bash
cp .env.example .env
```

---

## 6) Configure `.env` (Server + Shared Vars)

At minimum, set these in repo root `.env`:

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres?sslmode=require
REDIS_URL=redis://127.0.0.1:6379

AI_JOB_PARSER_URL=http://127.0.0.1:8001
AI_JOB_PARSER_TIMEOUT_MS=120000

CLIENT_URL=https://<your-vercel-domain>
API_PUBLIC_URL=https://api.yourdomain.com
NEXT_PUBLIC_SITE_URL=https://<your-vercel-domain>

JOB_LIST_VIEW_CAP_BYPASS_TOKEN=<long-random-secret>
INTERNAL_METRICS_TOKEN=<long-random-secret>

CLERK_SECRET_KEY=<server-clerk-secret>
CLERK_JWT_ISSUER=https://<your-clerk-issuer>
```

Set other feature-specific keys from `.env.example` as needed (`ANTHROPIC_API_KEY`, Resend, Lemon Squeezy, etc.).

If using Upstash instead of local Redis:

```env
REDIS_URL=rediss://<upstash-url>
```

---

## 7) Build and Migrate Database

From repo root on VPS:

```bash
npm run build:server
npm run db:generate
npm run db:migrate -w @jobseek/server
```

Health check API build artifact exists:

```bash
ls apps/server/dist
```

---

## 8) Setup Inference Service

```bash
cd ~/apps/jobSeek/apps/inference
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
```

Inference should run on localhost only in production:

```bash
source ~/apps/jobSeek/apps/inference/.venv/bin/activate
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

Test:

```bash
curl -s http://127.0.0.1:8001/health
```

---

## 9) Setup API and Processes (systemd)

Create one service per process. All services should use:

- `WorkingDirectory=/home/<user>/apps/jobSeek`
- `EnvironmentFile=/home/<user>/apps/jobSeek/.env`
- `Restart=on-failure`

Example API service (`/etc/systemd/system/jobseek-api.service`):

```ini
[Unit]
Description=JobSeek API
After=network.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/apps/jobSeek
EnvironmentFile=/home/<user>/apps/jobSeek/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start:server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Example inference service (`/etc/systemd/system/jobseek-inference.service`):

```ini
[Unit]
Description=JobSeek Inference
After=network.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/apps/jobSeek/apps/inference
EnvironmentFile=/home/<user>/apps/jobSeek/.env
ExecStart=/home/<user>/apps/jobSeek/apps/inference/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jobseek-inference
sudo systemctl enable --now jobseek-api
```

Logs:

```bash
journalctl -u jobseek-api -f
journalctl -u jobseek-inference -f
```

---

## 10) All Worker and Scheduler Commands

Create systemd services for each process you need.

### Core ingestion and discovery

- `npm run worker -w @jobseek/server`
- `npm run scheduler -w @jobseek/server`
- `npm run worker:enrich -w @jobseek/server`
- `npm run discovery:worker -w @jobseek/server`
- `npm run discovery:scheduler -w @jobseek/server`
- `npm run worker:ats-endpoint -w @jobseek/server`
- `npm run scheduler:ats-endpoint -w @jobseek/server`
- `npm run worker:ats-discovery -w @jobseek/server`
- `npm run scheduler:ats-discovery -w @jobseek/server`
- `npm run worker:serp -w @jobseek/server`

### User/account maintenance

- `npm run worker:job-alerts -w @jobseek/server`
- `npm run scheduler:job-alerts -w @jobseek/server`
- `npm run worker:archive-applications -w @jobseek/server`
- `npm run scheduler:archive-applications -w @jobseek/server`
- `npm run worker:resume-backfill -w @jobseek/server`
- `npm run scheduler:resume-backfill -w @jobseek/server`
- `npm run worker:job-purge -w @jobseek/server`
- `npm run scheduler:job-purge -w @jobseek/server`

### Important SERP note

`scheduler:serp` is one-shot (enqueue once and exit). Run it on cron/systemd timer, for example every 30 minutes:

```cron
*/30 * * * * cd /home/<user>/apps/jobSeek && /usr/bin/npm run scheduler:serp -w @jobseek/server >> /var/log/jobseek-serp-scheduler.log 2>&1
```

---

## 11) Connect Vercel (Client)

In Vercel project settings, set:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_SITE_URL=https://<your-vercel-domain>
```

Also set Clerk client-side/public vars required by your auth setup:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<clerk-publishable-key>
```

If your app uses server-side auth checks/routes in Vercel runtime, set:

```env
CLERK_SECRET_KEY=<clerk-secret-key>
```

Deploy/redeploy the client.

---

## 12) API Domain + TLS

Use Caddy or nginx in front of API:

- `api.yourdomain.com` -> reverse proxy to `127.0.0.1:3000`
- TLS via Let’s Encrypt

Minimal Caddyfile:

```text
api.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
```

---

## 13) End-to-End Validation Checklist

From VPS:

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:8001/health
```

From your machine:

```bash
curl -s https://api.yourdomain.com/health
```

App checks:

- Open Vercel site, login works.
- Job list loads (`/jobs`).
- Job detail loads (`/jobs/:id`).
- Resume upload works (`/account/resume`).
- Worker queues are processing (`journalctl` logs for workers).
- SERP worker runs and scheduler cron fires.

Optional readiness endpoint:

```env
ENABLE_READINESS_PROBE=true
```

Then verify:

```bash
curl -s https://api.yourdomain.com/health/ready
```

---

## 14) Day-2 Operations (keep it healthy)

- Enable slow query/route logs when tuning:
  - `PRISMA_SLOW_QUERY_MS=200`
  - `LOG_SLOW_ROUTE_MS=150`
- Keep daily DB backups (Supabase backup policy or external dumps).
- Watch CPU, RAM, disk, queue lag.
- If OOM or queue lag starts:
  1. Increase VPS RAM/CPU
  2. Move Redis to managed (Upstash)
  3. Split inference to another host

---

## 15) Quick Command Reference

```bash
# API build/start
npm run build:server
npm run start:server

# DB
npm run db:generate
npm run db:migrate -w @jobseek/server

# Core workers/schedulers
npm run worker -w @jobseek/server
npm run scheduler -w @jobseek/server
npm run worker:enrich -w @jobseek/server
npm run discovery:worker -w @jobseek/server
npm run discovery:scheduler -w @jobseek/server

# ATS + SERP
npm run worker:ats-endpoint -w @jobseek/server
npm run scheduler:ats-endpoint -w @jobseek/server
npm run worker:ats-discovery -w @jobseek/server
npm run scheduler:ats-discovery -w @jobseek/server
npm run worker:serp -w @jobseek/server
npm run scheduler:serp -w @jobseek/server
```

