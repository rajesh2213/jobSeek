# JobSeek — Local startup guide

Step-by-step order to run infrastructure, database, API, workers, discovery, the **inference** service (job-description ML parser), seeding, and the Next.js client.

## Prerequisites

- **Node.js 20+**
- **Docker** + **Docker Compose**
- **npm** (repo uses workspaces)
- **Python 3.10+** (only if you run `apps/inference` for `parsedDescription` / workers that call it)

---

## 1. Install dependencies

From the **repository root** (`jobSeek/`):

```bash
npm install
```

This installs root + `apps/server` + `apps/client` and runs Prisma `generate` via the server workspace `postinstall`.

---

## 2. Environment variables

From the repo root:

```bash
cp .env.example .env
```

Edit `.env` if your ports differ. Defaults:

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL | `postgresql://jobseek:jobseek@localhost:15432/jobseek` |
| `REDIS_URL` | BullMQ / queues | `redis://localhost:6379` |
| `PORT` | Fastify API | `3000` |
| `INTERNAL_METRICS_TOKEN` | Secures `GET /internal/metrics` in production | (unset in dev; set in prod) |
| `AI_JOB_PARSER_URL` | FastAPI job parser (workers / backfill only) | `http://localhost:8001` |
| `JOB_PARSER_SERVICE_URL` | Alias for parser base URL | (optional; overrides if set) |
| `AI_JOB_PARSER_TIMEOUT_MS` | HTTP timeout for `/parse` | `120000` |

**Frontend (optional):** In `.env` or `apps/client/.env.local` set:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

If you run Next.js on port **3001** (recommended so it does not clash with the API on `3000`), use the same `NEXT_PUBLIC_API_BASE_URL` pointing at `3000`.

---

## 3. Start Docker (PostgreSQL + Redis)

From the repo root:

```bash
docker compose up -d
```

- **PostgreSQL:** `localhost:15432` — user `jobseek`, password `jobseek`, database `jobseek`
- **Redis:** `localhost:6379`

Stop when finished:

```bash
docker compose down
```

---

## 4. Database schema

From the repo root (loads root `.env` via Prisma scripts):

```bash
npm run db:generate
```

**Recommended for repeatable schema history:**

```bash
npm run db:migrate -w @jobseek/server
```

Use this on a **fresh** database, or after `npm run db:reset -w @jobseek/server` (drops data and reapplies migrations).

**Quick dev sync without migration files:**

```bash
npm run db:push
```

**`Company` model:** unique **`slug`**. **`domain`** is optional until enrichment resolves it (job-ingestion flow). **`status`**: `raw` → `enriching` → `ready` (or `failed`). **`Job.parsedDescription`** (JSON) is filled by workers when the inference service is up, or via backfill.

---

## 4.1 Fresh reset (DB + Redis + local caches)

Use this when you want a clean test run.

From the repo root:

```bash
npm run reset:fresh -w @jobseek/server
```

This script clears:

- all `Job` and `Company` rows
- Redis cache/queues (`FLUSHALL`)
- `apps/server/logs`
- `apps/client/.next`

Afterward, run **`db:migrate`** or **`db:push`** again as needed.

---

## 4.2 Backfill structured job descriptions (`parsedDescription`)

Requires PostgreSQL, **`DATABASE_URL`**, and the **inference** service running on the URL in `AI_JOB_PARSER_URL` (default `http://localhost:8001`). If the parser is down, the script still writes a line-based fallback into `parsedDescription.other`.

From the repo root:

```bash
npm run backfill:parsed-descriptions -w @jobseek/server
```

---

## 5. Seed companies (optional, one-time or repeatable)

Idempotent: safe to run again; duplicates are skipped.

From the repo root:

```bash
npm run seed -w @jobseek/server
```

Or from `apps/server`:

```bash
npm run seed
```

Requires PostgreSQL up and `DATABASE_URL` set. Check logs for `seed_dataset_size` and `seed_summary`.

### Seed from CSV dataset

CSV ingestion script:

```bash
npm run seed:csv -w @jobseek/server
```

Or from `apps/server`:

```bash
npm run seed:csv
```

Notes:

- Uses `apps/server/scripts/seedCompaniesFromCSV.ts`.
- Reads `COMPANY_CSV_PATH` when set, otherwise tries:
  - `apps/server/data/company-datasets/companies.csv`
  - `apps/server/src/modules/seeding/data/Wellfound_Final.csv`
- Enqueued companies are tagged with `discoverySource=csv_seed` and sent to enrichment queue.

---

## 6. Inference service (optional — job description ML parser)

Workers and the backfill script call **`POST /parse`** on this service. Without it, ingestion still works; `parsedDescription` gets a simple line fallback.

- **Model directory:** `apps/inference/models/job-parser-model/` (HuggingFace tokenizer + `AutoModelForSequenceClassification` export), or set **`JOB_PARSER_MODEL_DIR`** to an absolute path.
- **Port:** `8001` (match `AI_JOB_PARSER_URL`).

From the repo root:

```bash
cd apps/inference
python -m venv .venv
# Windows CMD:        .venv\Scripts\activate
# Windows Git Bash:   source .venv/Scripts/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8001
```

Use **`python -m uvicorn`** so you do not rely on the `uvicorn` script being on `PATH`.

See **`apps/inference/README.md`** for `JOB_PARSER_BATCH_SIZE` and health check **`GET /health`**.

---

## 7. API server (Fastify)

**Development** (watch mode):

```bash
npm run dev:server
```

Or:

```bash
npm run dev -w @jobseek/server
```

- **Health / API base:** `http://localhost:3000` (or your `PORT`)
- **Example:** `GET http://localhost:3000/health`

**Company APIs (JSON):**

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/companies?page=1&limit=20&q=…` | Paginated list; `q` filters by name (ILIKE) |
| `GET` | `/company/:slug` | Company detail |
| `GET` | `/company/:slug/jobs?…` | Canonical jobs only; same query filters as `/jobs` (role, skills, country, …) |
| `POST` | `/companies` | Create company (`name`, optional `domain` or `careersUrl` for domain resolution) |

**Next.js (SSR):** `/companies` and `/company/[slug]` in the client app.

**Production-style** (after build):

```bash
npm run build:server
npm run start:server
```

---

## 8. Job crawl pipeline (Redis + worker + scheduler)

These enqueue and process ATS job crawls. **Redis and PostgreSQL must be running.**

Open **separate terminals** from the repo root.

**Terminal A — job worker**

```bash
npm run worker -w @jobseek/server
```

**Terminal B — crawl scheduler** (polls companies and enqueues crawls)

```bash
npm run scheduler -w @jobseek/server
```

Without both, queued crawl jobs will not run (or new crawls will not be scheduled).

**Terminal C — company enrichment worker** (domain/careers/ATS detection → `ingest-ats-jobs`)

```bash
npm run worker:enrich -w @jobseek/server
```

Run this alongside the job worker so `enrich-company` queue jobs are processed.

**Terminal D — ATS endpoint worker** (new ATS endpoint queue: `ingest-ats-endpoint`)

```bash
npm run worker:ats-endpoint -w @jobseek/server
```

Important: this worker is queue-driven and will appear idle until endpoints are registered/enqueued. Keep **Terminal C** running, because enrichment is what registers endpoints and pushes `{ endpointId }` jobs into the ATS endpoint queue.

**Terminal D2 — ATS endpoint ingest scheduler** (priority-ordered `ingest-ats-endpoint` jobs every 5–8 minutes; skips endpoints crawled in the last 2 minutes)

```bash
npm run scheduler:ats-endpoint -w @jobseek/server
```

Run with **Terminal D** so queued ingests are processed. Uses `score`, `successCount`, and `lastCrawledAt` to favor high-quality and stale boards.

**Terminal E — ATS endpoint discovery** (SERP + job URL → registry; validates inactive endpoints with real crawler checks)

```bash
npm run worker:ats-discovery -w @jobseek/server
```

**Terminal F — ATS discovery scheduler** (enqueues `discover_from_serp`, `discover_from_jobs`, `validate_endpoint` on a jittered 5–10 minute interval)

```bash
npm run scheduler:ats-discovery -w @jobseek/server
```

Requires Redis. Discovery marks `SerpResult.discoveredAt` so SERP rows are not reprocessed forever. Endpoints with `failureCount >= 5` are auto-deactivated (`is_active = false`). Staged endpoints (`isActive = false`) are re-validated on a cooldown after failures.

**Optional — SERP collection worker** (fills `SerpResult` for discovery; does not crawl ATS)

```bash
npm run worker:serp -w @jobseek/server
```

**Optional — SERP scheduler**

```bash
npm run scheduler:serp -w @jobseek/server
```

### Metrics snapshots (one-shot CLI)

Requires PostgreSQL (same `.env` as the API). For the ATS snapshot, set `REDIS_URL` if you want SERP skip-key counts and related Redis-derived fields.

From the repo root:

```bash
npm run metrics -w @jobseek/server
npm run metrics:ats -w @jobseek/server
```

| Script | What it runs |
|--------|----------------|
| `metrics` | `src/scripts/metrics.snapshot.ts` — company / system density summary to the console. |
| `metrics:ats` | `src/scripts/ats.metrics.snapshot.ts` — ATS pipeline JSON (SERP, discovery, endpoint health, ingestion, waste); logs `ats_metrics_snapshot`. In-process counters from workers are only non-zero if those workers run in the **same** Node process (the CLI snapshot still reflects Prisma + Redis). |

---

## 9. Company discovery pipeline (optional)

Separate queue for discovering companies from configured sources.

**Terminal G — company discovery worker**

```bash
npm run discovery:worker -w @jobseek/server
```

**Terminal H — company discovery scheduler**

```bash
npm run discovery:scheduler -w @jobseek/server
```

The discovery scheduler also re-enqueues enrichment for companies stuck in `raw` / `enriching` (deduped by job id `enrich-{companyId}`).

---

## 10. Next.js client (optional)

Default Next dev port is **3000**, which conflicts with the API. Use **3001** for the client.

From `apps/client` (after `npm install` at repo root):

```bash
cd apps/client
npx next dev -p 3001
```

Ensure `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` so the browser calls the Fastify API.

**Internal metrics (`GET /internal/metrics`):** When `NODE_ENV=production`, set `INTERNAL_METRICS_TOKEN` in `.env` and send `Authorization: Bearer <token>`. Without the token in production, the route returns **503** (non-production keeps the route open if the token is unset).

**Build / start (production):**

```bash
npm run build -w @jobseek/client
npm run start -w @jobseek/client
```

(Adjust Next port with `-p` if needed.)

---

## 11. ML training data script (optional)

Generates `apps/server/src/scripts/training-data.json` from `job_dataset.json` (see script header for flags such as `--clean-output`).

```bash
cd apps/server
npx tsx src/scripts/generateTrainingData.ts
```

---

## Quick reference — all commands (copy checklist)

| Step | Command |
|------|---------|
| Install | `npm install` |
| Env | `cp .env.example .env` |
| Infra | `docker compose up -d` |
| DB generate | `npm run db:generate` |
| DB migrate | `npm run db:migrate -w @jobseek/server` |
| DB push (dev) | `npm run db:push` |
| DB reset (migrate replay) | `npm run db:reset -w @jobseek/server` |
| Fresh reset | `npm run reset:fresh -w @jobseek/server` |
| Backfill `parsedDescription` | `npm run backfill:parsed-descriptions -w @jobseek/server` |
| Seed | `npm run seed -w @jobseek/server` |
| Seed (CSV) | `npm run seed:csv -w @jobseek/server` |
| Inference (Python) | `cd apps/inference && … && python -m uvicorn app:app --host 0.0.0.0 --port 8001` |
| API | `npm run dev:server` |
| Job worker | `npm run worker -w @jobseek/server` |
| Enrich worker | `npm run worker:enrich -w @jobseek/server` |
| ATS endpoint worker | `npm run worker:ats-endpoint -w @jobseek/server` |
| ATS endpoint ingest scheduler | `npm run scheduler:ats-endpoint -w @jobseek/server` |
| ATS discovery worker | `npm run worker:ats-discovery -w @jobseek/server` |
| ATS discovery scheduler | `npm run scheduler:ats-discovery -w @jobseek/server` |
| SERP worker (optional) | `npm run worker:serp -w @jobseek/server` |
| SERP scheduler (optional) | `npm run scheduler:serp -w @jobseek/server` |
| Crawl scheduler | `npm run scheduler -w @jobseek/server` |
| Company discovery worker | `npm run discovery:worker -w @jobseek/server` |
| Company discovery scheduler | `npm run discovery:scheduler -w @jobseek/server` |
| Metrics snapshot | `npm run metrics -w @jobseek/server` |
| ATS pipeline metrics | `npm run metrics:ats -w @jobseek/server` |
| Client | `cd apps/client && npx next dev -p 3001` |

---

## Troubleshooting

- **`DATABASE_URL` not found** — Ensure `.env` exists at the **repo root** (not only under `apps/server`).
- **Prisma / DB connection errors** — Confirm Docker Postgres is up and port **15432** matches `DATABASE_URL`.
- **Port 15432 in use / wrong Postgres** — Another Postgres may be bound to `5432`; this project uses **15432** by design in `docker-compose.yml`.
- **Redis connection errors** — Start Docker Compose; workers require Redis.
- **`next` not found** — Run `npm install` from the repo root so `apps/client` dependencies are installed.
- **EPERM / locked Prisma on Windows** — Stop Node processes using the server (dev server, workers), then run `npm run db:generate` again.
- **`migrate dev` / shadow DB errors (e.g. missing `Company`)** — Migrations must apply in order on an empty DB. Use **`npm run db:reset -w @jobseek/server`** for a clean local replay, or fix `_prisma_migrations` / baseline manually if you mixed `db push` and migrate.
- **`uvicorn: command not found`** — From `apps/inference`, use **`python -m uvicorn app:app --port 8001`** inside an activated venv after `pip install -r requirements.txt`.
- **Parser timeouts** — Increase `AI_JOB_PARSER_TIMEOUT_MS` or reduce description size / batch load on the inference service.

---

## Minimal “API only” dev

1. `docker compose up -d`
2. `npm install`
3. `cp .env.example .env`
4. `npm run db:generate && npm run db:migrate -w @jobseek/server` (or `db:push`)
5. `npm run dev:server`

Add **inference** (section 6), **backfill** (4.2), seed, and workers when you need structured descriptions, data, and background processing.
