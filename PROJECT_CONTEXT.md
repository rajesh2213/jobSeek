# PROJECT CONTEXT

## 1. System Overview

**JobLoom** is a multi-service job discovery platform with four major runtime surfaces:

- `apps/client`: Next.js App Router frontend for discovery, job detail, account, smart apply, and saved searches.
- `apps/server`: Fastify + Prisma API, ingestion orchestration, queue workers, billing/auth integrations.
- `apps/inference`: Python FastAPI inference service for job-description parsing and resume embeddings/matching primitives.
- `apps/extension`: Chrome extension (Manifest V3) for form scanning/autofill and smart-apply workflows.

The platform is queue-driven for ingestion and maintenance, API-driven for user features, and uses PostgreSQL as source of truth plus Redis for queueing, rate/cap support, and parse caching support.

---

## 2. Real System Architecture (What Actually Exists)

### 2.1 Runtime components

**Client (`apps/client`)**
- Server Components fetch backend data for route payloads (`/jobs`, `/job/[id]`, `/company/[slug]`).
- Client components handle authenticated interactions: saved searches, resume upload/match, applications, smart-apply flows.
- Auth via Clerk; only `/account` is middleware-protected, many other private-ish features are soft-gated in component logic.

**Server (`apps/server`)**
- Fastify app assembled in `src/server/fastify.ts`, route registration in `src/server/routes/index.ts`.
- Prisma models all persistent business entities.
- BullMQ queues + processors + schedulers drive ingestion/discovery/maintenance.
- AI parse orchestration is in Node and calls Python inference over HTTP.

**Inference (`apps/inference`)**
- Single FastAPI process in `app.py` serving both classifier and sentence-transformer workloads.
- `/parse` does bucketed line classification with confidence thresholds.
- `/resume/embed` and `/resume/match` provide embedding/matching primitives.

**Extension (`apps/extension`)**
- MV3 background service worker, content script, popup app.
- Reads ATS-like form field metadata from pages and sends structured question payloads to backend smart-apply APIs.

### 2.2 Primary transport and state dependencies

- **PostgreSQL**: canonical jobs, company graph, users, resumes, subscriptions, saved searches, applications, ATS/Discovery entities.
- **Redis**: BullMQ backend, rate/cap internals, parse cache/burst-dedupe helpers in server AI layer.
- **HTTP contracts**:
  - Client/Extension -> Server
  - Server -> Inference (`/parse`, `/resume/embed`)
  - Server -> external vendors (ATS endpoints, SERP providers, Lemon Squeezy, Clerk verification paths).

---

## 3. Real System Flow (End-to-End)

This section reflects runtime behavior across components, not intended architecture.

1. **Ingestion trigger happens**  
   A scheduler or script enqueues work (crawler/discovery/ATS endpoint/SERP/fallback source ingestion).

2. **Worker fetches source data**  
   ATS adapters or source-specific services normalize raw postings into normalized payloads.

3. **Dedup + canonicalization executed**  
   Server computes source-url identity and fingerprint identity, then either:
   - reuses existing row,
   - creates duplicate linked to canonical,
   - creates new canonical row (`canonicalJobId = null`).

4. **Canonical aggregation updated**  
   Canonical fields are recomputed from duplicate set (title/description/location/skills/freshness/source quality).

5. **Description parse/enrichment attempted**  
   `enrichCanonicalJobParsedDescription` runs parse pipeline:
   - preprocess description text in Node,
   - call inference `/parse`,
   - fallback heuristics if parse empty/fails,
   - apply title fallback for weak `position`,
   - persist `parsedDescription` + `enriched` + derived skills/status updates.

6. **API serves canonical jobs**  
   `/jobs` and `/jobs/:id` generally expose canonical rows with status gating and mapping through `toJobPublicJson` (includes preview lines, parsed sections, enrichment).

7. **Frontend renders list/detail**  
   List pages are URL-filter-driven and cap-aware; detail pages render parsed sections, enrichment pills, similar jobs, and optional resume match panel.

8. **Resume flow (user path)**  
   Upload at `/account/resume`:
   - parse file text/bullets,
   - call inference `/resume/embed`,
   - persist resume metadata + bullets + embedding arrays on `User`.
   Job detail "match" flow consumes stored bullets/embeddings and server-side semantic scoring APIs.

9. **Smart apply flow (web + extension)**  
   Client/extension collects application questions, server attempts deterministic answers first, then LLM fallback for unresolved items, with plan/cap enforcement.

10. **Billing + plan propagation**  
    Lemon Squeezy webhook updates `Subscription` + user plan; plan state affects limits, alerts, resume/semantic features, and smart-apply allowances.

---

## 4. Backend Deep Dive (`apps/server`)

### 4.1 Bootstrapping and request pipeline

- Entry: `src/index.ts`
- Fastify setup: `src/server/fastify.ts`
  - raw body support (webhook verification),
  - multipart support (resume upload),
  - CORS (includes authorization headers and view-cap bypass header),
  - global rate-limit hooks and route timing/logging.
- Route mounting: `src/server/routes/index.ts`
  - account, saved-search, applications, billing, job, company, seo, internal, optional debug.

### 4.2 Module map (`src/modules`)

- `job`: listing/detail/suggestions/discovery query path, status gating, mapper/repository/service split.
- `company`: company pages and company job retrieval.
- `applications`: applied/unapplied state, notes/status, archive behavior.
- `saved-search`: CRUD + normalization + alert config + tokenized unsubscribe flow.
- `billing`: Lemon Squeezy checkout + webhook handlers.
- `account`: summary, resume lifecycle, semantic match, apply profile/smart-apply endpoints.
- `resume/extraction`: structured resume extraction pipeline and extractors.
- `ai`: preprocessing, inference client, parse normalization/fallback, parsed payload persistence triggers.
- `ats`: ATS vendor adapters and standardized crawler path.
- `crawler`: crawl scheduler and queueing logic.
- `atsEndpoint`: endpoint inventory + ingest readiness/priority logic.
- `atsDiscovery`: discovering ATS endpoints from discovered signals.
- `serp`: SERP acquisition/normalization/filtering path.
- `discovery`: company discovery and downstream queue orchestration.
- `viewCap`: list/detail cap model, rate/cap internals.
- `internal`: internal metrics endpoint.
- `debug`: debug job parse comparison endpoint.
- `enrichment`, `seo`, `locations`, `seeding`: support modules.

### 4.3 Async architecture: queues, workers, schedulers

**Queues (BullMQ / Redis)**
- job processing
- discovery
- ats endpoint ingest
- ats discovery
- company score
- serp
- applications archive
- resume backfill
- job alerts
- job purge
- job status reconcile
- company enrichment

**Processors/workers**
- `workers/job.processor.ts`
- `workers/discovery.processor.ts`
- `workers/atsEndpoint.processor.ts`
- `modules/atsDiscovery/atsDiscovery.processor.ts`
- `modules/serp/serp.processor.ts`
- `workers/enrich-company.processor.ts`
- `workers/score.worker.ts`
- maintenance workers (alerts/archive/backfill/purge/reconcile).

**Schedulers**
- interval schedulers: crawler/discovery/ats-endpoint/ats-discovery.
- repeat registration schedulers: alerts/archive/backfill/purge/reconcile.
- one-shot enqueue scheduler: SERP scheduler enqueues and exits (periodicity depends on external process manager).

### 4.4 Ingestion pipeline (raw -> normalized -> canonical -> enriched)

1. Source fetch via ATS adapters/fallback source ingestion/source-url expansion.
2. Normalize fields, URLs, locations, taxonomy hints.
3. Dedup decision in `jobDedup.service.ts`:
   - source URL first,
   - fingerprint and similarity checks,
   - canonical/duplicate attach and canonical recompute.
4. Canonical enrichment/parse path via `jobDescriptionEnrichment.ts`.
5. Parsed + enriched persistence via repository update.
6. Visibility controlled by status/canonical filters in listing queries.

### 4.5 Dedup details

- Key identifiers: normalized `sourceUrl`, generated fingerprint (title/company/location/description/apply URL/ATS identifiers).
- Canonical relation implemented as self-reference on `Job` (`canonicalJobId`).
- Duplicate inserts can still count as `inserted: true` operationally; it does not always mean new canonical row.

### 4.6 ParsedDescription pipeline (AI + fallback)

- Preprocess: HTML decode/cleanup, split, line filtering, heading handling, newline packaging.
- Parse call: `jobParser.service.ts` -> inference `/parse`.
- Server-side post-parse cleanup:
  - bucket key validation,
  - boilerplate demotion/promotion heuristics,
  - bucket caps.
- Fallback: heuristic parse when inference invalid/empty/unavailable.
- Title fallback: inject `job.title` as `position` when needed.
- Persist path updates `parsedDescription` and recomputes `enriched` together.

### 4.7 Resume system (upload -> parse -> embed -> match)

- Upload route validates mime/size and parses file content.
- Resume text/bullets extracted and persisted on `User`.
- Embeddings generated through inference `/resume/embed`.
- Resume structured extraction pipeline writes profile-oriented fields.
- Match endpoint consumes keyword + stored bullets/embeddings; server does semantic comparisons and returns match map.
- Smart-apply endpoints consume profile + resume context with deterministic + LLM fallback answering.

### 4.8 Saved search system

- Query normalization ensures consistent `/jobs?...` canonical strings.
- Per-user unique constraint on `(userId, query)`.
- Slot limits enforced (free/pro behavior in response metadata + backend checks).
- Alert scheduler/worker emits notifications and can auto-disable alert behavior when user no longer pro.
- Unsubscribe path is tokenized and intentionally public with token validation.

### 4.9 Billing hooks

- Lemon Squeezy webhook verifies signature against raw body.
- Subscription events update both `Subscription` row and effective `User.plan`.
- Checkout creation uses clerk-linked metadata for identity correlation.
- Naming mismatch exists in DB fields (`stripe*`) despite Lemon Squeezy integration.

### 4.10 Internal/debug endpoints

- `/internal/metrics`: protected by token in production (can be open in non-prod if unset).
- `/debug/job/:id`: only non-prod or explicit debug env flag.
- readiness endpoint is environment-flagged (`ENABLE_READINESS_PROBE`), not always present.

---

## 5. Frontend Deep Dive (`apps/client`)

### 5.1 App Router structure

- Root layout: global providers, metadata, route loader.
- Route groups:
  - `(marketing)` for landing/legal/billing marketing surfaces.
  - `(app)` for jobs/company/account/applications/saved-searches/smart-apply/pricing.
- Auth pages:
  - `/sign-in/[[...sign-in]]`
  - `/sign-up/[[...sign-up]]`
- Important routes:
  - `/jobs`, `/jobs/[...slug]`, `/jobs/browse`
  - `/job/[id]`
  - `/companies`, `/company/[slug]`
  - `/applications`, `/saved-searches`, `/smart-apply`, `/account`, `/pricing`
  - `/api/user/me` (Next API proxy for account summary fallback path).

### 5.2 Data fetching and state model

- Server Components fetch initial data via `lib/api.ts`.
- Client components perform user-authenticated operations (JWT-based API calls).
- No server actions are primary flow.
- URL is source of truth for jobs filters (`slug-parser`).
- Local state holds draft filters, transient UI, modals, save/alert controls.
- Context providers:
  - account plan context,
  - applications context,
  - resume context.

### 5.3 Job listing and detail render pipeline

**Jobs list**
- Route loader fetches discovery payload and metadata.
- `JobsSearchClient` manages URL-sync, pagination/load-more, dedupe merging, filter UI, saved-search controls.
- Cards use backend-provided `previewLines` and render apply/applied controls.
- View cap metadata controls wall/preview states.

**Job detail**
- Fetches detail + company jobs + similar jobs.
- Builds section content from parsed buckets, with fallback parsing from raw description when needed.
- Cap state can lock apply CTAs and hide full body.
- Resume score components consume resume + semantic match endpoint.

### 5.4 Saved searches UI logic

- Two user surfaces: full `/saved-searches` page + inline manager in jobs list.
- Both integrate with same backend APIs (create/list/rename/delete/patch alert).
- UI handles pro-required errors and slot-limit metadata.
- Duplication across two UIs creates drift risk when API contract changes.

### 5.5 Limit wall / cap behavior

- Free-tier limits and discovery phase behavior live in client constants and backend `meta`.
- Key `meta` fields drive branching:
  - `capReached`, `viewCapUnlimited`, `discoveryPhase`, `resetAt`, hidden counts/remaining counters.
- Detail page and list page enforce cap differently but from same backend cap model.

### 5.6 SEO and structured data

- Dynamic metadata for listings/details/company pages.
- JSON-LD usage:
  - `ItemList` and breadcrumbs for listing pages.
  - `JobPosting` for detail.
- Robots and sitemap are explicitly coded; sitemap uses backend SEO/data fetchers and bypass header path for full indexing coverage.

### 5.7 Frontend/backend mismatch risks

- Middleware protects only `/account`; other sensitive pages rely on client checks and may briefly render before redirect/prompt.
- Cap UX correctness depends heavily on backend `meta` consistency.
- Plan state fetched through multiple paths can temporarily disagree in UI.

---

## 6. Inference Service Deep Dive (`apps/inference`)

### 6.1 Runtime and model loading

- FastAPI app in `app.py`.
- Startup loads:
  - classifier model/tokenizer from `JOB_PARSER_MODEL_DIR`,
  - sentence-transformer model from `EMBEDDING_MODEL_NAME`.
- Device auto-selects CUDA if available.
- Torch thread settings intentionally constrained.
- Optional in-process LRU caches exist for parse and embeddings.

### 6.2 `/parse` behavior (actual)

- Input: `{ description: string }`.
- Splits to non-empty trimmed lines.
- Batch classification with softmax confidence per line.
- Applies strict filters:
  - drop low-confidence lines (`JOB_PARSER_MIN_CONFIDENCE`),
  - drop short `other` lines (`JOB_PARSER_SHORT_OTHER_CHARS`).
- Returns seven buckets always (`position`, `responsibility`, `requirement`, `experience`, `benefit`, `contact`, `other`).
- No internal fallback in Python; fallback occurs in Node server.

### 6.3 Resume endpoints

- `/resume/embed`:
  - input `sentences[]`,
  - returns dense vectors `number[][]`,
  - can leverage embedding cache.
- `/resume/match`:
  - input `keyword` + `bullets[]`,
  - computes cosine similarities and best match.

### 6.4 Contract with server

- Server expects strict bucket-key response for `/parse`; invalid shape is treated as failure/fallback.
- Server currently uses `/resume/embed` heavily; semantic match behavior may be server-computed from stored embeddings depending on route path.

### 6.5 Weaknesses and performance implications

- Confidence thresholding can over-prune and yield empty parses.
- Label distribution tends to overuse `other` under noisy/unstructured descriptions.
- Quality highly dependent on upstream line preprocessing.
- Cold start memory and startup cost are high due to dual-model loading.
- Embedding payloads are large JSON arrays, affecting latency/network pressure.

---

## 7. Chrome Extension Deep Dive (`apps/extension`)

### 7.1 Runtime model and permissions

- Manifest V3 with:
  - background service worker,
  - content script on broad page patterns,
  - popup UI.
- Permissions: `activeTab`, `storage`, `webNavigation`.
- Host permissions: broad `https://*/*`.
- Content script matches broad `http/https`, including frames.

### 7.2 What data it reads from pages

- Detects and extracts form field metadata:
  - label/placeholder/name, nearby context, groupings, option lists.
- Builds normalized question objects for answer generation/fill.
- Recurses accessible frames for ATS forms.
- Skips obvious non-target fields (captcha/hidden/read-only/system controls).

### 7.3 Extension -> server interaction

- Background script proxies API requests through allowlisted paths.
- Uses bearer token from extension local storage.
- Key calls:
  - apply profile/status,
  - smart-apply batch answer + event telemetry,
  - resume download,
  - mark application as applied.

### 7.4 Data flow extension -> server -> user

1. User opens ATS/job application page.
2. Content script scans form fields/questions.
3. Popup/sidebar requests profile + smart-apply status.
4. Unanswered open-ended questions sent to backend batch-answer endpoint.
5. Returned answers mapped back to detected fields and filled into page.
6. Events posted for usage telemetry and flow diagnostics.

### 7.5 Policy and security risk areas

- Broad host/content-script scope increases attack/abuse surface.
- Token stored in extension storage is sensitive at rest.
- Background API proxy relies primarily on path allowlist; sender trust boundary should be monitored closely.
- Dev bypass flags in server are safe only if production env separation is strict.

---

## 8. Data Layer (Prisma) - Full Breakdown

Schema source: `apps/server/prisma/schema.prisma`

### 8.1 Core entities

- `Company`
  - identity: slug/domain
  - ATS metadata and status
  - relations: jobs, atsEndpoints

- `Job`
  - core posting fields + taxonomy + ranking/freshness
  - parse/enrichment fields: `parsedDescription` (Json), `enriched` (Json)
  - dedup graph: `canonicalJobId`, self-relations canonical/duplicates
  - uniqueness: `sourceUrl`
  - relation: company, applications

- `AtsEndpoint`
  - discovered/registered ATS endpoints, optional company link
  - unique composite `(type, slug)`

- `SerpBatch`, `SerpResult`
  - SERP run metadata and captured URLs/signals

- `User`
  - clerk identity, plan, usage counters
  - resume fields:
    - `resumeText`,
    - `resumeFileName`,
    - `resumeFileData` / object-store key fields,
    - `resumeBullets` (Json),
    - `resumeBulletEmbeddings` (Json),
    - structured profile fields.
  - relations: subscription, savedSearches, applications

- `SavedSearch`
  - normalized query string + optional display name + alert state
  - unique `(userId, query)`

- `Subscription`
  - one-to-one with user
  - provider identifiers and lifecycle state

- `Application`
  - user/job relation for applied tracking
  - unique `(userId, jobId)`

### 8.2 Relationship map

- Company 1:N Job
- Company 1:N AtsEndpoint (optional link from endpoint side)
- Job self 1:N duplicates via canonical relation
- User 1:1 Subscription
- User 1:N SavedSearch
- User 1:N Application
- Job 1:N Application
- SerpBatch 1:N SerpResult

### 8.3 Canonical job system (data behavior)

- Listings primarily serve canonical rows (`canonicalJobId IS NULL`).
- Duplicate rows preserve source-level traceability while canonical aggregates representative values.
- Canonical recompute occurs after dedup attach/update flows.

### 8.4 Resume storage + embeddings

- No separate `Resume` table exists.
- Resume and embeddings are denormalized onto `User` row with JSON arrays.
- This simplifies retrieval but risks row bloat and weak vector-search scaling.

### 8.5 Index and scaling risks

- ILIKE-heavy search predicates may need trigram indexes for scale.
- Some hot combined filters lack covering composite indexes.
- No DB constraint preventing self-referential canonical link.
- Canonical invariants rely mostly on service logic, not strict DB partial-unique guards.

---

## 9. AI / Intelligence Layer (Cross-Service)

### 9.1 Parsing intelligence stack

1. Node preprocessing (`preprocessDescription`).
2. Python classifier (`/parse`) with confidence thresholds.
3. Server fallback heuristics if parse quality insufficient.
4. Title fallback and bucket post-processing.
5. Rule-based enrichment (`enriched`) from parsed output.

### 9.2 Enrichment logic

- Rule-based enrichment extracts tech stack, salary hints, remote hints.
- This is deterministic and cheap, but not robust against domain/language variation.
- `enriched` field quality depends on upstream parse quality.

### 9.3 Resume-job matching intelligence

- Resume bullets embedded and stored.
- Keyword-to-bullet semantic similarity computed to support score UI and smart recommendations.
- Final user-visible score in client blends semantic signals and heuristic softening logic.

### 9.4 Weak points

- Parse model confidence cuts can hide valid lines.
- `other` bucket over-concentration reduces section usefulness.
- Heuristic fallback quality varies across text styles.
- Embeddings as JSON and per-request semantic comparisons can become latency-heavy.

---

## 10. Ingestion, Discovery, and Worker Ecosystem

### 10.1 Ingestion streams currently present

- ATS vendor crawlers (multi-adapter path).
- ATS endpoint ingestion queue (from discovered/registered endpoints).
- SERP-driven discovery of candidate company/ATS URLs.
- Discovery pipeline for new companies and endpoints.
- Fallback source ingestion and source URL expansion/detail scraping.

### 10.2 Worker ownership summary

- `job.processor`: core ingest + parse/enrich progression + status transitions.
- `atsEndpoint.processor`: endpoint validation/ingest loops.
- `serp.processor`: external search acquisition + filtering.
- `discovery.processor`: company discovery and enqueueing.
- `enrich-company.processor`: company metadata enrichment.
- maintenance workers: alerts/archive/resume backfill/job purge/status reconcile.

### 10.3 Operational mismatch to note

- Some schedulers are interval loops, some only register repeat jobs then exit, some one-shot enqueue and exit; production reliability depends on proper process manager/systemd wiring for each.

---

## 11. Hidden / Internal / Debug Surfaces

- `/internal/metrics` (token protected in prod).
- `/debug/job/:id` (non-prod or explicit flag).
- readiness route may not exist unless enabled (`ENABLE_READINESS_PROBE`).
- tokenized unsubscribe endpoint intentionally public.

---

## 12. Mismatches Between Intended vs Actual Behavior

- **Billing naming drift**: fields named `stripe*` are used for Lemon Squeezy identifiers.
- **Auth boundary asymmetry**: middleware hard-protects only `/account`; other user-critical pages rely on runtime client checks.
- **Status/visibility nuance**: job visibility logic can treat parsed payload presence as effectively ready in some repository paths.
- **Scheduler behavior inconsistency**: not all schedulers are truly long-running periodic processes.
- **Contract duplication**: smart-apply contracts/events are duplicated across extension/client/server and can drift.

---

## 13. Failure Points (Where System Breaks Today)

1. **Inference degradation**
   - low-confidence pruning + `other` suppression can produce empty/weak parsed output.
   - downstream UI then falls back and quality drops.

2. **Pipeline orchestration fragility**
   - mixed scheduler styles require correct infra process setup; missing one process can silently stall a subsystem.

3. **Cap/plan UX drift**
   - UI logic tightly coupled to backend meta and multi-source plan state; transient mismatches produce confusing walls/gates.

4. **Contract drift across apps**
   - extension/client/server API types are not centrally enforced for all smart-apply routes/events.

5. **Data scaling pressure**
   - text filters without specialized indexes and JSON embedding storage can bottleneck under growth.

6. **Security posture of extension**
   - broad host/content-script scope + token storage increases blast radius if extension context is compromised.

7. **Readiness observability gaps**
   - readiness endpoint optional by env; infra may rely on weaker health checks in some environments.

---

## 14. Gaps, Risks, and Technical Debt

### 14.1 Architectural bottlenecks

- Centralized parse/embedding service mixes two heavy model workloads in one process.
- JSON embedding transport/storage is costly for high QPS.

### 14.2 Inconsistent flows

- Auth protection differs by route type (middleware vs client gating).
- Scheduler process model inconsistent between subsystems.

### 14.3 Redundant logic

- Saved-search UI behavior duplicated in jobs page and saved-searches page.
- Smart-apply contract mapping duplicated between extension and client.

### 14.4 Scaling risks

- ILIKE filters and ranking queries can degrade without additional indexing strategy.
- Canonical invariants rely more on app logic than DB constraints.

### 14.5 Observability and supportability gaps

- Internal metrics are present but not unified into explicit SLO/SLA dashboards in-repo.
- Several degradation paths silently fallback (good for uptime, harder for quality visibility).

### 14.6 UX-breaking backend issues

- Parse quality failures directly impact detail section fidelity and resume match usefulness.
- Cap metadata inconsistencies can over- or under-restrict user behavior.

---

## 15. Production Readiness Score

Scores reflect current code behavior and operational risk exposure (1 = poor, 10 = strong).

- **Ingestion:** 7/10  
  Strong queue-based modular ingestion and dedup pipeline; risk remains in orchestration complexity and scheduler mode inconsistency.

- **Search/Discovery UX + API:** 6.5/10  
  Rich filters/cap model/SEO surface; index/query scalability and cap-meta coupling create medium risk.

- **AI parsing/enrichment:** 5.5/10  
  End-to-end flow exists with fallback safety, but classifier confidence/drop behavior and `other` skew still reduce structured quality.

- **Frontend UX:** 7/10  
  Mature route structure and feature coverage; gating/plan/cap coupling and duplicated saved-search logic create inconsistency risk.

- **Infra/Operations readiness:** 6/10  
  Good logging, queue metrics, internal metrics endpoints; readiness behavior and process model require disciplined deployment wiring.

---

## 16. Environment and Operational Reference

See root `.env.example` plus app-specific env use in code.

Commonly critical variables:
- server: `DATABASE_URL`, `REDIS_URL`, `AI_JOB_PARSER_URL` / `JOB_PARSER_SERVICE_URL`, `AI_JOB_PARSER_TIMEOUT_MS`, `INTERNAL_METRICS_TOKEN`, billing keys, Clerk keys.
- inference: `JOB_PARSER_MODEL_DIR`, `JOB_PARSER_BATCH_SIZE`, `JOB_PARSER_MIN_CONFIDENCE`, `JOB_PARSER_SHORT_OTHER_CHARS`, `EMBEDDING_MODEL_NAME`.
- client: `NEXT_PUBLIC_API_BASE_URL`, Clerk publishable key, extension/site URLs where applicable.

Operational note:
- after pulling schema-affecting changes, migrations/db sync must be applied before relying on account/resume/saved-search/runtime paths.
