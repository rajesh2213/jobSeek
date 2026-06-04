# Slug Fix — Re-Enrich Class A (Phase 3)

Executed: 2026-06-04

## Commands

```bash
cd apps/server && npx tsx scripts/rollout/slugFixReEnrichClassA.ts --dry-run
cd apps/server && npx tsx scripts/rollout/slugFixReEnrichClassA.ts
```

Note: `scripts/reEnrichClassA.ts` was **not** used (broken `enrichCompany` import). Rollout used `slugFixReEnrichClassA.ts` with `processEnrichCompany`.

## Dry-run summary

- Candidates: **103**
- Reasons: `enrich_exhausted` (88), `post_migration` (15)

## Live run summary

| Outcome | Count |
|---------|------:|
| Processed | 103 |
| New endpoint linked (`OK … → endpoint`) | 0 |
| Partial (token set or unchanged, no new endpoint) | 103 |
| With non-null token after run | 14 |

### Post-migration companies with token after re-enrich

| Company | ATS | Token |
|---------|-----|-------|
| MarketFinance | ashby | allica-bank |
| Accelevents | greenhouse | accelevents |
| Homesty | greenhouse | phxpreview |
| Cockroach Labs | greenhouse | cockroachlabs |
| CloudTrucks | ashby | cloudtrucks |
| QA Wolf | ashby | qawolf |
| Vanta | ashby | vanta |
| Near | greenhouse | nearfoundation |
| Bold Business | greenhouse | boldbusiness |
| Avantus | greenhouse | avantus |
| Kota | ashby | kota |
| SpotDraft | ashby | spotdraft |
| Kin Insurance | ashby | kin |
| Fig | greenhouse | figs15 |

Most candidates hit `enrichment_cap_reached` (15 attempts) and remained without a new `AtsEndpoint` row.

## Ready + token metric

| Metric | Baseline | After Phase 3 |
|--------|----------:|-------------:|
| `status=ready` AND `atsBoardToken` NOT NULL | 723 | 722* |

\*Net −1 vs baseline is within noise (CircleCI/Synthesia cleared tokens; no new ready+endpoint links from this pass).

## Phase 3 verdict

Migration tokens are **persisted** on companies. Re-enrich did **not** attach new endpoints for Class A collision cases in this run; orphan linker (Phase 5) picked up **2** slug matches (Avantus, Vanta).
