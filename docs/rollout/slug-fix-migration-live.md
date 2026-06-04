# Slug Fix — Production Migration (Phase 2)

Executed: 2026-06-04 (live, no `--dry-run`)

## Command

```bash
cd apps/server && npx tsx scripts/migrations/reextractBadAtsTokens.ts
```

## Results

| Outcome | Count |
|---------|------:|
| Recovered real token | 13 |
| Cleared (unresolvable) | 2 |
| Fetch failed | 0 |

Cleared: **Synthesia** (ashby), **CircleCI** (greenhouse).

## Post-migration verification

```sql
SELECT COUNT(*)
FROM "Company"
WHERE "atsBoardToken" IN (
  'posting-api', 'embed', 'login', 'signin', 'api'
);
```

**Result: 0** — PASS. Rollout continued.

## Tokens corrected (13)

| Company | ATS | Old | New |
|---------|-----|-----|-----|
| Fig | greenhouse | embed | figs15 |
| Homesty | greenhouse | embed | phxpreview |
| MarketFinance | ashby | posting-api | allica-bank |
| Kota | ashby | posting-api | kota |
| Bold Business | greenhouse | embed | boldbusiness |
| Avantus | greenhouse | embed | avantus |
| QA Wolf | ashby | posting-api | qawolf |
| Accelevents | greenhouse | embed | accelevents |
| SpotDraft | ashby | posting-api | spotdraft |
| CloudTrucks | ashby | posting-api | cloudtrucks |
| Kin Insurance | ashby | posting-api | kin |
| Cockroach Labs | greenhouse | embed | cockroachlabs |
| Vanta | ashby | posting-api | vanta |
