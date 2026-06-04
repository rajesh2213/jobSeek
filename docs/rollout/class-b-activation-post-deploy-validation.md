# Class B Activation — Post-Deploy Validation

Validated: 2026-06-04T19:54:00Z  
Git: pending push (includes `fa3a933` + follow-up commit)

## Gate checks

| Check | Result |
|-------|--------|
| `npm run test` | **314/314 pass** |
| `npm run build:server` | **Pass** |
| Duplicate `type_slug` endpoints | **0** |
| Orphan endpoint growth | **No** (224, down from 225) |

## Cohort health (21 recovered companies)

| Metric | After activation | After post-ingest fix |
|--------|-----------------:|----------------------:|
| Active endpoints | 9 | **15** |
| With jobs | 15 | **15** |
| Healthy (active + ready jobs) | 9 | **15** |
| `status=ready` | 16 | **16** |

### Healthy (15)

Airship, Brandwatch, ChargeLab, ContinuumGlobal, Correlation One, CX2, Findigs, Floqast, Menti, Outreach, Radformation, saas.group, Sigma Computing, Superchat, Sysdig

### Remaining blockers (6)

| Company | Issue |
|---------|-------|
| Holmusk | Lever 404 — bad slug `holmusk` |
| Noibu | Lever 404 — bad slug `noibutechnologies` |
| Veho | Lever 404 — bad slug `veho` |
| VideaHealth | Lever 404 — bad slug `videahealth` |
| ResProp Management | Greenhouse 404 — bad slug `resprop` |
| Nevados Engineering | Board empty (0 jobs) — slug may be wrong |

These retain endpoints (inactive) and `enriching` status. Requires manual token correction — out of scope for activation scripts.

## Global coverage (post-deploy)

| Metric | Pre-activation | Post-deploy |
|--------|---------------:|------------:|
| Companies with endpoints | 846 | **867** |
| Companies with active endpoints | 571 | **585** |
| Active endpoints | 809 | **817** |
| Endpoint coverage % | 8.17% | **8.37%** |
| Ready jobs | 97,403 | **97,663** |

## Scripts run

```bash
npx tsx scripts/migrations/activateRecoveredClassB.ts
npx tsx scripts/migrations/validateRecoveredClassB.ts
npx tsx scripts/migrations/activateRecoveredClassBPostIngest.ts
npx tsx scripts/rollout/classBActivationHealthCheck.ts
npx tsx scripts/rollout/classBActivationMetrics.ts post-deploy
```

## Verdict

**Deploy OK for activation scope.** 15/21 recovered companies are fully wired (token → endpoint → jobs → coverage). 6 require token re-audit (separate small fix, not activation).
