# Coverage Expansion Rollout — Results

**Date:** 2026-06-07  
**Environment:** Production (direct)  
**Orchestrator:** `apps/server/scripts/rollout/coverageExpansionRollout.ts`

## Baseline → After

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Companies with any endpoint link | 906 | 914 | +8 |
| Companies with active endpoint (incl. M:N) | 587 | 590 | +3 |
| Class B crawlable, no token | 76 | 81 | +5* |
| Has token, no active endpoint | 167 | 159 | −8 |
| Orphan active endpoints | 224 | 224 | 0 |
| Recovered cohort not active | 6 | 6 | 0 |

\*Class B no-token count rose because 5 dead-board companies had tokens cleared.

## Phase 1 — Bad slug cohort (6 companies)

**Script:** `revalidateBadSlugCohort.ts`

| Company | Outcome | Notes |
|---------|---------|-------|
| Holmusk, Noibu, Veho, VideaHealth, ResProp | **dead_board** | Live Lever/GH API 404; tokens cleared, endpoints removed, tagged `class_b_activation:dead_board` |
| Nevados Engineering | **empty_board** | Valid Lever slug `nevados`, 0 jobs; endpoint stays inactive |

**Net:** Cohort closed — no recoverable slugs without careers URL repair / Playwright.

Round 2 recovery was updated to **skip** `dead_board`-tagged companies so tokens are not re-persisted.

## Phase 2 — Class B token recovery round 2

**Script:** `recoverClassBTokens.ts` (limit 76)

- **70** candidates scanned
- **0** net-new valid tokens (59 unresolvable HTML, 4 fetch failures, 7 no careersUrl)
- 5 tokens briefly re-persisted for dead-board companies before skip guard; cleared again

## Phase 3 — M:N shared boards

**Migration:** `20260603180000_company_ats_endpoint_join`  
**Model:** `CompanyAtsEndpoint` with backfill from existing `AtsEndpoint.companyId`

**Script:** `linkSharedBoardCollisions.ts` — **4** companies linked to existing boards:

| Company | Shared board |
|---------|--------------|
| Split | greenhouse/harnessinc |
| Figment | greenhouse/figment |
| harrison.ai | ashby/harrison |
| Hivehealth | lever/avalerehealth |

`classBActivationLib` now uses `link_shared_endpoint` instead of `skip_collision`.

## Phase 4 — Token activation pass

**Script:** `activateTokenCompanies.ts` (Class B crawlable types only)

- **~200** ingest jobs enqueued (batched, 100ms delay)
- **5** new endpoint rows created (Accelevents, Bold Business, CloudTrucks, Cockroach Labs, Fig + others)
- Companies tagged `class_b_activation:token_wired` to avoid duplicate enqueue

**Follow-up:** Run `activateRecoveredClassBPostIngest.ts` after ingest workers process the queue to flip endpoints with jobs to `isActive=true`.

## Safety measures applied

- Dry-run gate on orchestrator
- Batch limits (`--limit=50`) and enqueue delay
- Live board probe before persisting slugs (`boardProbe.ts`)
- `dead_board` exclusion from round 2 recovery
- Token activation restricted to greenhouse / lever / ashby / workday
- Additive-only schema migration + backfill
- Queue connection closed + `process.exit(0)` to avoid script hang
- Unit tests: **314/314** pass

## New / updated files

| File | Purpose |
|------|---------|
| `prisma/migrations/20260603180000_company_ats_endpoint_join/` | M:N join table + backfill |
| `src/modules/companyEndpoint/companyEndpointLink.service.ts` | Link helpers |
| `scripts/rollout/boardProbe.ts` | Live API probe + re-extract |
| `scripts/rollout/tokenActivationLib.ts` | Token company query |
| `scripts/rollout/coverageExpansionRollout.ts` | Phased orchestrator |
| `scripts/migrations/revalidateBadSlugCohort.ts` | Bad slug cleanup |
| `scripts/migrations/activateTokenCompanies.ts` | Token → endpoint → ingest |
| `scripts/migrations/linkSharedBoardCollisions.ts` | Class A collision linker |

## Commands (re-run)

```bash
cd apps/server
npx tsx scripts/rollout/coverageExpansionRollout.ts --dry-run --limit=50
npx tsx scripts/rollout/coverageOpportunitySnapshot.ts
npx tsx scripts/migrations/activateRecoveredClassBPostIngest.ts
```
