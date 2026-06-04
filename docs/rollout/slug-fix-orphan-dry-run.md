# Slug Fix — Orphan Link Validation (Phase 4)

Executed: 2026-06-04

## Command

```bash
cd /home/ubuntu/jobSeek && npx tsx scripts/ingestion/linkOrphanEndpoints.ts --dry-run
```

## Validation rule

Only **confidence 3** links allowed:

- `exact_type_slug_token`: `AtsEndpoint.type === Company.atsType` AND `endpoint.slug === company.atsBoardToken`
- `workday_slug_match`: Workday JSON token encodes to same slug

No confidence 1 (domain) or confidence 2 (fuzzy) matchers exist in this script.

## Orphans scanned

**227** active endpoints with `companyId IS NULL`

## Proposed links (confidence 3)

| Endpoint type | Endpoint slug | Company | Company token | Confidence | Strategy |
|---------------|---------------|---------|---------------|------------|----------|
| greenhouse | avantus | Avantus | avantus | **3** | exact_type_slug_token |
| ashby | vanta | Vanta | vanta | **3** | exact_type_slug_token |

## Summary

| Stat | Count |
|------|------:|
| Would link | 2 |
| No match | 225 |
| Already has endpoint | 0 |
| Invalid slug skipped | 0 |
| Confidence 1 / 2 proposals | **0** |

## Validation result

**PASS** — Proceed to Phase 5 live linking.
