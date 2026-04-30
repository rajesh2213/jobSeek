# DEPLOYMENT.md

Production deployment for the JobSeek monorepo (`apps/client`, `apps/server`, `apps/inference`, `apps/extension`). Commands assume **repository root** unless noted.

**Audience:** If this is your **first** production deploy, follow **§1.1** (hardware) and **§1.2** (steps) in order. Use **§2** for every environment variable, and the later sections for command references.

---

## 1. Prerequisites

| Requirement | Notes |
|---------------|--------|
| **Node.js** | `>= 20` (see root `package.json` `engines`) |
| **npm** | Workspaces at repo root |
| **Python** | `3.10+` for `apps/inference` |
| **PostgreSQL** | Version compatible with Prisma schema (`apps/server/prisma/`) |
| **Redis** | For BullMQ, rate limits, view caps (`REDIS_URL`) |

Local development (Docker Postgres + Redis) is documented in `start.md`.

---

## 1.1 Hardware sizing (this stack)

This app combines **Fastify**, **Prisma/Postgres**, **Redis (BullMQ + rate limits)**, **multiple Node workers/schedulers**, and **Python inference** (PyTorch + sentence-transformers + HF model). All of that competes for **RAM** on a single host if you use one VPS.

**What consumes memory (rough mental model):**

| Component | Why it matters |
|-----------|----------------|
| **PostgreSQL** | Buffer cache + connections; grows with data and `shared_buffers`. |
| **Redis** | In-memory; queues and keys add usage. |
| **Node API** | One process; moderate RAM. |
| **Node workers / schedulers** | One process each; add up quickly if you run many. |
| **Inference (Python)** | Model + PyTorch + embedding model: often **1–3+ GB** alone after load. |

Pick a tier that matches **how much you run on one machine**. When in doubt, prefer **more RAM** over more CPU for this codebase.

### Recommended VPS sizes (single machine: API + workers + Postgres + Redis + inference)

| Tier | vCPU | RAM | Disk (typical) | Use case |
|------|------|-----|----------------|----------|
| **Minimum** | 2 | **4 GB** | 40 GB NVMe | Staging or **very** light traffic only. Running Postgres + Redis + inference + workers on **4 GB** is tight; expect swapping under load or OOM if crawls + inference spike together. |
| **Recommended (production, budget)** | **4** | **8 GB** | **80 GB** NVMe | **Default choice** for “everything on one VPS”: API, several workers/schedulers, Postgres, Redis, CPU inference bound to `127.0.0.1`. Leaves headroom for spikes. |
| **Comfortable** | 4–8 | **16 GB** | 160 GB NVMe | Larger job index, heavier BullMQ load, more worker processes, or bigger Postgres working set. |
| **Growth** | — | — | — | Split: e.g. **Neon** (Postgres) + **Upstash** (Redis) + smaller VPS for app only, or **second VPS** for inference if RAM-bound. |

**Disk:** Prefer **NVMe** SSD. Postgres and logs grow over time; **80 GB** is a sensible starting floor for production data + Docker images if you use containers.

**Client (Next.js):** Not on this VPS if you use **Vercel**—no extra sizing here.

**Extension:** No server RAM; Chrome Web Store only.

---

## 1.2 First-time production deploy (Vercel + one Linux VPS)

**Target architecture (cheapest practical production):**

- **Vercel:** `apps/client` (Next.js). Browser talks to Fastify using `NEXT_PUBLIC_API_BASE_URL`.
- **One Ubuntu VPS:** `apps/server` (API), `apps/inference` (FastAPI, **localhost only**), BullMQ **workers** and **schedulers**, and optionally **Postgres + Redis** on the same host (or use Neon/Upstash instead).

**Vocabulary:** A **VPS** is a rented Linux machine (you SSH in and install software). It is **not** the same as Railway-style PaaS—you are the sysadmin.

| Layer | Where | First-time note |
|-------|--------|-----------------|
| TLS | Caddy or nginx on VPS | Public HTTPS on **443** → proxy to API on `127.0.0.1:3000`. |
| API | Node on VPS | Bind to `127.0.0.1:3000` or `0.0.0.0:3000` behind proxy only. |
| Inference | Python on VPS | **`--host 127.0.0.1 --port 8001`** so it is **not** exposed to the internet. |
| Postgres / Redis | Same VPS or managed | `DATABASE_URL` / `REDIS_URL` in root `.env`. |

---

### Phase 1 — Create the VPS and log in

1. In your provider (e.g. Hetzner, DigitalOcean, OVH), create an **Ubuntu 22.04 or 24.04 LTS** server using the **Recommended** row in **§1.1** (ideally **4 vCPU / 8 GB RAM / 80 GB** NVMe).
2. Add your **SSH public key** at create time, or use the provider’s console to paste `~/.ssh/id_ed25519.pub` into `/root/.ssh/authorized_keys`.
3. From your laptop, connect (adjust user/key path):

   ```bash
   ssh -i ~/.ssh/id_ed25519 root@YOUR_SERVER_IP
   ```

4. Update packages:

   ```bash
   apt update && apt upgrade -y
   ```

---

### Phase 2 — Non-root user, SSH hardening, firewall

**Why:** Run deploys as `deploy`, not `root`. Open only **22, 80, 443** to the world; keep Postgres/Redis/inference on **localhost**.

1. Create user and sudo:

   ```bash
   adduser deploy
   usermod -aG sudo deploy
   mkdir -p /home/deploy/.ssh
   cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh
   chmod 700 /home/deploy/.ssh
   chmod 600 /home/deploy/.ssh/authorized_keys
   ```

2. Test: `ssh deploy@YOUR_SERVER_IP`. If it works, optionally set `PermitRootLogin no` and `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `sudo systemctl restart ssh`.

3. Firewall (as `deploy` with `sudo`):

   ```bash
   sudo apt install -y ufw
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp comment SSH
   sudo ufw allow 80/tcp comment HTTP
   sudo ufw allow 443/tcp comment HTTPS
   sudo ufw enable
   sudo ufw status verbose
   ```

   Optional: restrict SSH to your home IP: `sudo ufw delete allow 22/tcp` then `sudo ufw allow from YOUR_IP to any port 22 proto tcp`.

---

### Phase 3 — DNS

1. In your DNS host (Cloudflare, registrar, etc.), create an **A record**: **`api.yourdomain.com`** → **VPS public IP** (TTL 300s is fine).
2. Wait until `ping api.yourdomain.com` resolves to that IP (can take a few minutes).
3. In **Vercel** (client project), set **`NEXT_PUBLIC_SITE_URL`** to your real site URL, e.g. `https://www.yourdomain.com` (no trailing slash).

---

### Phase 4 — TLS reverse proxy (Caddy example)

1. Install Caddy: follow [Caddy install for Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) (or use `sudo apt install caddy` if your Ubuntu version packages it).

2. Create `/etc/caddy/Caddyfile` (adjust domain):

   ```text
   api.yourdomain.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

3. Reload Caddy: `sudo systemctl reload caddy`. Caddy will obtain Let’s Encrypt certificates automatically once **port 80** is reachable and DNS points to this server.

4. **Do not** expose ports **5432** (Postgres), **6379** (Redis), or **8001** (inference) in the firewall; bind those services to **127.0.0.1** only.

---

### Phase 5 — Install runtimes and clone the repo

As `deploy`:

1. **Node 20+** (example using NodeSource or `nvm`—pick one method and stick to it):

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs build-essential git
   node -v   # should be v20+
   ```

2. **Python 3.10+:**

   ```bash
   sudo apt install -y python3 python3-venv python3-pip
   python3 --version
   ```

3. Clone the app (HTTPS or deploy key):

   ```bash
   mkdir -p ~/apps && cd ~/apps
   git clone https://github.com/YOUR_ORG/jobSeek.git
   cd jobSeek
   npm install
   ```

---

### Phase 6 — Postgres and Redis (pick one strategy)

**Strategy A — On the VPS (cheapest monthly)**

- Install Postgres and Redis with your preferred method (**Docker Compose** is fine: see local `docker-compose.yml` patterns in repo root for reference, or install `postgresql` and `redis-server` packages).
- Listen **127.0.0.1** only for both.
- Build **`DATABASE_URL`**, e.g. `postgresql://USER:PASSWORD@127.0.0.1:5432/jobseek`.
- Set **`REDIS_URL=redis://127.0.0.1:6379`** (adjust password if you enabled `requirepass`).

**Strategy B — Hybrid (less database ops)**

- Create **Neon** Postgres → copy connection string into **`DATABASE_URL`**.
- Create **Upstash Redis** → copy **`rediss://`** URL into **`REDIS_URL`** (verify BullMQ works with your plan).

---

### Phase 7 — Environment file, build, migrate

1. On the server: `cp .env.example .env` at **repo root**. Fill all required values using **§2** (Clerk, `DATABASE_URL`, `REDIS_URL`, `AI_JOB_PARSER_URL`, etc.).

2. For single-VPS inference on localhost:

   ```env
   AI_JOB_PARSER_URL=http://127.0.0.1:8001
   ```

3. Ensure the inference model exists on disk (`JOB_PARSER_MODEL_DIR` or default under `apps/inference/models/`).

4. Build and migrate:

   ```bash
   npm run build:server
   npm run db:migrate -w @jobseek/server
   ```

5. Install inference venv and deps:

   ```bash
   cd apps/inference
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   deactivate
   cd ~/apps/jobSeek
   ```

---

### Phase 8 — systemd: API, inference, workers

Use **one `.service` file per process**. Set **`WorkingDirectory`** to the repo root and **`EnvironmentFile`** to `/home/deploy/apps/jobSeek/.env`.

**Example** `/etc/systemd/system/jobseek-api.service`:

```ini
[Unit]
Description=JobSeek Fastify API
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/apps/jobSeek
EnvironmentFile=/home/deploy/apps/jobSeek/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start:server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Example** `/etc/systemd/system/jobseek-inference.service` (bind localhost only):

```ini
[Unit]
Description=JobSeek inference FastAPI
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/apps/jobSeek/apps/inference
EnvironmentFile=/home/deploy/apps/jobSeek/.env
ExecStart=/home/deploy/apps/jobSeek/apps/inference/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Add **separate** units for each worker/scheduler you need in production (same pattern; change `ExecStart` to e.g. `npm run worker -w @jobseek/server`). See `apps/server/package.json` for script names.

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jobseek-inference
sudo systemctl enable --now jobseek-api
# enable workers as you add them
```

Check: `curl -s http://127.0.0.1:3000/health` and `curl -s http://127.0.0.1:8001/health` from the server.

Optional: set **`ENABLE_READINESS_PROBE=true`** in `.env` and use **`GET https://api.yourdomain.com/health/ready`** for orchestrators (see **§2.8**).

---

### Phase 9 — Point Vercel at the API

1. Vercel → Project → Environment Variables:
   - **`NEXT_PUBLIC_API_BASE_URL`** = `https://api.yourdomain.com`
   - Clerk **`NEXT_PUBLIC_*`** keys and any server secrets your Next app needs.
2. Redeploy the production deployment.
3. Open your site: sign-in, browse jobs, hit an API-backed page. If CORS or 401 issues appear, confirm the API URL and Clerk production domain settings.

---

### Phase 10 — Backups and smoke checks

1. **Postgres:** schedule `pg_dump` (cron) to object storage, or rely on Neon snapshots if using Neon.
2. **Smoke:** `GET https://api.yourdomain.com/health` from your browser; upload a resume; tail `journalctl -u jobseek-api -f`.

---

### Phase 11 — Browser extension

Build and publish the extension per **§6** (Chrome Web Store). The extension does not run on the VPS.

---

**Cost note (illustrative):** one **8 GB** VPS plus a domain is often in the **tens of USD/month** range—usually less than running many separate PaaS services unless you optimize heavily. **Neon + Upstash + smaller VPS** is a common middle ground.

---

## 2. Environment variables

Set **repo root** `.env` for the API, workers, and Prisma CLI. The Fastify API validates `DATABASE_URL` and `PORT` via `assertApiProcessEnv()` in `apps/server/src/infrastructure/env/validateApiEnv.ts` (other vars are feature-specific).

### 2.1 Core (API + DB + Redis)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `REDIS_URL` | **Yes** (for production features) | Redis for queues, job read rate limits, view caps |
| `PORT` | No | API listen port (default `3000`) |
| `NODE_ENV` | Yes | `production` in prod |
| `LOG_LEVEL` | No | Fastify/pino level (default `info`) |

### 2.2 Clerk (client + API JWT verification)

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client (Vercel) | Clerk browser SDK |
| `CLERK_SECRET_KEY` | API | `verifyToken` / backend (see `apps/server/src/infrastructure/auth/clerkVerify.ts`) |
| `CLERK_JWT_KEY` | API | Optional PEM for JWT verification path |
| `CLERK_JWT_ISSUER` | API | Set to your Clerk Frontend API origin (`https://…`) if not `*.clerk.accounts.dev` |

### 2.3 Public URLs and SEO

| Variable | Purpose |
|----------|---------|
| `CLIENT_URL` | Links in emails, redirects |
| `API_PUBLIC_URL` | Public API base for absolute URLs where used |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for Next.js SEO (HTTPS, no trailing slash) |
| `NEXT_PUBLIC_SEO_MIN_JOBS_INDEX` | Thin listing `noindex` threshold (default `3`) |
| `JOB_LIST_VIEW_CAP_BYPASS_TOKEN` | Shared secret for sitemap / bulk job reads (must match API + Next server routes that call it) |

### 2.4 Inference / AI

| Variable | Purpose |
|----------|---------|
| `AI_JOB_PARSER_URL` or `JOB_PARSER_SERVICE_URL` | Base URL for FastAPI (`default http://localhost:8001` in code) |
| `AI_JOB_PARSER_TIMEOUT_MS` | HTTP timeout (ms) for **`POST /parse`** (Axios in `apps/server/src/modules/ai/ai.service.ts`) and **`POST /resume/embed`** (`fetch` in `apps/server/src/utils/resumeEmbedder.ts`); default `120000` |
| `ANTHROPIC_API_KEY` | Smart Apply / extract-profile LLM path |

### 2.5 Inference service (Python)

| Variable | Purpose |
|----------|---------|
| `JOB_PARSER_MODEL_DIR` | Path to HF model dir (default `apps/inference/models/job-parser-model`) |
| `EMBEDDING_MODEL_NAME` | SentenceTransformer name (default `all-MiniLM-L6-v2`) |
| `EMBEDDING_ENCODE_BATCH_SIZE` | Batch size (default `32`) |
| `TORCH_NUM_THREADS` | CPU threads (default `1`) |
| `EMBEDDING_CACHE_MAX_ITEMS` / `PARSE_CACHE_MAX_ITEMS` | Optional LRU sizes (`0` = off) |
| `JOB_PARSER_BATCH_SIZE` | Documented in `apps/inference/README.md` |

### 2.6 Billing (Lemon Squeezy)

| Variable | Purpose |
|----------|---------|
| `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET` | Server |
| `LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID`, `LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID` | Server |
| `NEXT_PUBLIC_LS_PRO_ANNUAL_VARIANT_ID`, `NEXT_PUBLIC_LS_PRO_MONTHLY_VARIANT_ID` | Client checkout buttons |

### 2.7 Email (job alerts)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend HTTP API |
| `EMAIL_FROM` | From address |
| `JOB_ALERT_HMAC_SECRET` | Unsubscribe / signed links |

### 2.8 Observability

| Variable | Purpose |
|----------|---------|
| `INTERNAL_METRICS_TOKEN` | Bearer token for `GET /internal/metrics` in production (`apps/server/src/modules/internal/internal.metrics.routes.ts`) |
| `PRISMA_SLOW_QUERY_MS` | Log slow Prisma queries (`apps/server/src/infrastructure/db/prisma.ts`) |
| `LOG_SLOW_ROUTE_MS` | Log slow `/jobs*` HTTP routes (`apps/server/src/server/fastify.ts`) |
| `ENABLE_READINESS_PROBE` | Set to `true` to register **`GET /health/ready`**: checks DB (`SELECT 1`) and Redis `PING`. Returns **503** if either fails. **`GET /health`** stays a lightweight liveness check (unchanged). |

### 2.9 Next.js client (`apps/client/.env.local`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Browser → Fastify API (e.g. `https://api.yourdomain.com`) |
| `API_BASE_URL` | Optional server-side override for Route Handlers (`apps/client/lib/api.ts`) |
| Marketing / legal `NEXT_PUBLIC_*` | See `apps/client/.env.example` |

Copy from `apps/client/.env.example` and root `.env.example`.

---

## 3. Deploy `apps/server` (Fastify)

### 3.1 Install and build

```bash
cd /path/to/jobSeek
npm install
npm run build:server
```

### 3.2 Database

Point `DATABASE_URL` at production Postgres, then:

```bash
npm run db:migrate -w @jobseek/server
```

For hosted Postgres that supports non-locking index creation, follow your DBA runbook for heavy indexes (e.g. `CREATE INDEX CONCURRENTLY` if you add migrations that require it).

### 3.3 Redis

Provide a managed Redis URL (`rediss://` where supported). The API uses Redis for:

- `assertJobReadRateLimit` (`apps/server/src/modules/viewCap/rateLimitRedis.ts`)
- View caps and BullMQ (workers)

### 3.4 Start API

```bash
npm run start:server
```

This runs `node dist/index.js` from `apps/server` after `tsc` build.

### 3.5 Workers (separate processes)

Background pipelines are **not** inside the HTTP process. Run each worker type as its own service (same image/env, different command), for example:

| Script | Command |
|--------|---------|
| Main job worker | `npm run worker -w @jobseek/server` |
| Crawl scheduler | `npm run scheduler -w @jobseek/server` |
| Enrich | `npm run worker:enrich -w @jobseek/server` |
| Others | See `apps/server/package.json` (`worker:ats-endpoint`, `discovery:worker`, `worker:job-alerts`, etc.) |

Scale workers horizontally by running multiple instances of the same queue consumer (BullMQ handles concurrency per queue configuration).

---

## 4. Deploy `apps/inference` (FastAPI)

### 4.1 Install

```bash
cd apps/inference
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

Ensure `JOB_PARSER_MODEL_DIR` points at the exported model artifacts on the server (volume or baked image).

### 4.2 Run

```bash
python -m uvicorn app:app --host 0.0.0.0 --port 8001
```

For the **single-VPS production layout** in **§1.2**, bind inference to **localhost only**: `--host 127.0.0.1 --port 8001` and set `AI_JOB_PARSER_URL=http://127.0.0.1:8001`.

### 4.3 Production settings

- **Workers:** Use `uvicorn` workers with care: PyTorch / model globals are process-local; prefer **one worker per replica** and scale replicas horizontally, or use a process pool only if you duplicate model load per worker intentionally.
- **Health:** `GET /health` (see `apps/inference/README.md`).
- **Resources:** SentenceTransformers + PyTorch are memory-heavy; size CPU/RAM accordingly; GPU helps embedding throughput but is optional if latency targets allow CPU.

### 4.4 Network

The API server must reach inference over **private network** or TLS; set `AI_JOB_PARSER_URL` to that base URL. Do not expose inference publicly without authentication if it has no auth layer.

---

## 5. Deploy `apps/client` (Next.js)

### 5.1 Build

```bash
npm run build -w @jobseek/client
```

### 5.2 Environment

Set `NEXT_PUBLIC_*` in the host (e.g. Vercel Project Settings):

- `NEXT_PUBLIC_API_BASE_URL` → production API URL
- Clerk keys
- `NEXT_PUBLIC_SITE_URL` → canonical `https://…`

### 5.3 Start

```bash
npm run start -w @jobseek/client
```

Or rely on Vercel’s Next.js build output.

### 5.4 Middleware

`apps/client/middleware.ts` uses `clerkMiddleware` and protects `/account(.*)`. Ensure Clerk dashboard allows your production domain.

---

## 6. Deploy `apps/extension`

### 6.1 Build

Use webpack/scripts from `apps/extension/package.json` (e.g. production build script if defined). Produce `content.js`, `background.js`, and assets per `apps/extension/manifest.json`.

### 6.2 Load unpacked (Chrome)

Chrome → Extensions → Developer mode → Load unpacked → select `apps/extension/dist` (or your build output directory).

### 6.3 Chrome Web Store

Zip the packaged extension per store requirements; update version in `manifest.json`.

**Note:** `host_permissions` is `<all_urls>` in `manifest.json`—review data handling and Smart Apply scope before wide release.

---

## 7. Post-deploy checklist

| Check | How |
|-------|-----|
| API up | `GET https://<api>/health` (or documented health route) |
| Readiness (optional) | If `ENABLE_READINESS_PROBE=true`, point the orchestrator at `GET /health/ready` (DB + Redis); keep liveness on `/health` |
| DB | API starts without Prisma connection errors; run a read query via `/internal/metrics` if token set |
| Redis | No connection errors; rate limit keys increment under load |
| Inference | From API host: `GET http(s)://<inference>/health`; `POST /parse` smoke with small body |
| Client | Load site; sign-in; `/jobs` loads; job detail opens |
| Resume | Upload PDF/DOCX under `/account`; confirm `resume_uploaded` logs on API |
| Job parsing | Run a worker or backfill with inference URL set; verify `parsedDescription` populated |
| CORS | Browser can call API from `NEXT_PUBLIC_SITE_URL` origin (`fastify.ts` uses `origin: true`—tighten if you move to credentialed flows) |

---

## 8. Monitoring setup

| Layer | Suggestion |
|-------|------------|
| **Logs** | Ship Fastify structured logs (pino) to your aggregator; set `LOG_LEVEL` |
| **Slow queries** | `PRISMA_SLOW_QUERY_MS`, `LOG_SLOW_ROUTE_MS` in staging first |
| **App metrics** | Protect `GET /internal/metrics` with `INTERNAL_METRICS_TOKEN`; scrape periodically |
| **Alerts** | API 5xx rate, DB connection saturation, Redis down, queue depth (BullMQ), inference 503 |

---

## 9. Scaling plan

| Component | Approach |
|-----------|----------|
| **API** | Stateless horizontal replicas behind load balancer; sticky sessions not required for JWT auth |
| **Workers** | Multiple Node processes per queue; separate CPU-heavy workers from HTTP |
| **Postgres** | Read replicas for read-heavy reporting only after measuring; Prisma primary for writes |
| **Redis** | Managed Redis with persistence / failover as required by BullMQ SLA |
| **Inference** | Replicas behind internal LB; keep batches large enough to amortize model overhead; consider GPU nodes for high embedding QPS |

---

## 10. Infrastructure options (reference)

| Piece | Cost-conscious choice | Heavier / more managed |
|-------|------------------------|-------------------------|
| Client | **Vercel** (or `next start` on same VPS) | — |
| API + workers + inference | **One VPS** (systemd/PM2/Docker) — see **§1.2** | Railway, Render, Fly.io, K8s |
| Postgres | **On-VPS** or **Neon** (low tier) | Supabase, RDS, Cloud SQL |
| Redis | **On-VPS** or **Upstash** | ElastiCache, Redis Cloud |
| Inference | **CPU on same VPS**, bind `127.0.0.1` | Separate GPU/service when QPS requires it |

---

## 11. Scheduler intervals (current vs recommended)

Intervals are **hardcoded** in the server repo unless noted. Tune by changing code or adding env-driven values if you need different production behavior.

| Pipeline | npm script (see `apps/server/package.json`) | **Current behavior** | **Recommended (cost vs freshness)** |
|----------|---------------------------------------------|----------------------|-------------------------------------|
| Crawl scheduler | `scheduler` | **10 minutes** fixed (`crawler.scheduler.ts`) | **10 minutes** default; **15–20 minutes** if the VPS, workers, or DB stay overloaded and queues do not drain. |
| Company discovery | `discovery:scheduler` | **10 minutes** fixed (`discovery.scheduler.ts`) | **10 minutes** default; lengthen only if discovery load is too high. |
| ATS discovery | `scheduler:ats-discovery` | **5–10 minutes**: random once at process start, then fixed (`atsDiscovery.scheduler.ts`). Disable with `ATS_DISCOVERY_SCHEDULER_DISABLED=true`. | **5–10 minutes** is already fairly aggressive; if cost, queue depth, or external rate limits bite, treat **~10 minutes** as a practical floor or lengthen slightly. |
| ATS endpoint | `scheduler:ats-endpoint` | **5–8 minutes**: random once at process start, then fixed (`atsEndpoint.scheduler.ts`) | **5–8 minutes** is fine; **8–12 minutes** can smooth load on a single small VPS. |
| SERP | `scheduler:serp` | **No in-process repeat**: the script enqueues **one** batch and **exits** (`serp.scheduler.ts`). **You** set the interval (e.g. **cron**). SERP worker throttles per run (`serp.processor.ts`, e.g. max queries per run + delays). | **Cron every 30–60 minutes** for a cost-effective default; **15–30 minutes** if you need fresher SERP-driven discovery and can afford SERP API + CPU; **1–2 hours** for minimum cost. |

**Operational notes:**

- Shorter intervals increase queue churn, external traffic, and DB writes—on a **single budget VPS** (see **§1.1**), avoid sub-minute schedules unless you have measured headroom.
- For SERP, add a **cron** entry (or systemd timer) that runs `npm run scheduler:serp -w @jobseek/server` from the repo root on the same host that has Redis and the SERP worker.

---

## Related docs

- Local development: `start.md`
- Env template: `.env.example`, `apps/client/.env.example`
