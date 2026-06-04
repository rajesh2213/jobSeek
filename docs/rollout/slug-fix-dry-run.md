# Slug Fix Migration Dry Run

Generated: 2026-06-04T13:18:31.849Z

## Summary

- Companies affected: **15**
- Recover: **13**
- Clear: **2**
- Suspicious (would block rollout): **0**

## Conversion table

| Company | ATS | Old | New | Action |
|---------|-----|-----|-----|--------|
| Fig | greenhouse | embed | figs15 | recover |
| Synthesia | ashby | posting-api | (null) | clear |
| Homesty | greenhouse | embed | phxpreview | recover |
| MarketFinance | ashby | posting-api | allica-bank | recover |
| Kota | ashby | posting-api | kota | recover |
| Bold Business | greenhouse | embed | boldbusiness | recover |
| Avantus | greenhouse | embed | avantus | recover |
| QA Wolf | ashby | posting-api | qawolf | recover |
| Accelevents | greenhouse | embed | accelevents | recover |
| SpotDraft | ashby | posting-api | spotdraft | recover |
| CloudTrucks | ashby | posting-api | cloudtrucks | recover |
| Kin Insurance | ashby | posting-api | kin | recover |
| CircleCI | greenhouse | embed | (null) | clear |
| Cockroach Labs | greenhouse | embed | cockroachlabs | recover |
| Vanta | ashby | posting-api | vanta | recover |

## Validation

**PASS** — No conversion preserves posting-api, embed, login, signin, or api.