# Slug Fix — Post-Rollout Metrics (Phase 6)

Captured: 2026-06-04T13:35:53.526Z

Baseline: `slug-fix-baseline.json` (2026-06-04T13:17:43.583Z)

## Delta table

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Total AtsEndpoint rows | 1128 | 1129 | +1 |
| Linked endpoints | 901 | 904 | **+3** |
| Orphan endpoints | 227 | 225 | **−2** |
| Distinct companies with linked endpoint | 844 | 846 | **+2** |
| Active endpoints | 809 | 809 | 0 |
| Active linked | 582 | 584 | **+2** |
| Active orphans | 227 | 225 | **−2** |
| Companies with `atsBoardToken` | 723 | 722 | −1 |
| Companies `status=ready` | 724 | 725 | +1 |
| Ready + token | 723 | 722 | −1 |
| Invalid tokens (posting-api, embed, login, signin, api) | **15** | **0** | **−15** |

## Collision audit (Phase 7)

### Removed bad-token collisions

| atsType | atsBoardToken | Before | After |
|---------|---------------|-------:|------:|
| ashby | posting-api | 8 | **0** |
| greenhouse | embed | 7 | **0** |

### Remaining duplicate tokens (non-generic)

| atsType | atsBoardToken | Count |
|---------|---------------|------:|
| lever | octoenergy | 2 |
| lever | avalerehealth | 2 |
| workday | `{"host":"coke.wd1.myworkdayjobs.com",...}` | 2 |
| ashby | harrison | 2 |
| greenhouse | harnessinc | 2 |
| greenhouse | figment | 2 |

No rows remain for `login`, `signin`, or `api`.

## Interpretation

- **+2 coverage companies** from orphan linker (Avantus, Vanta).
- **+1 total endpoint** and **+3 linked rows** vs baseline: migration/re-enrich pipeline may have created or relinked one additional row beyond the two orphan links (investigate if reconciling to exact +2).
- **Invalid token count → 0** is the primary data-quality win from Phase 2.
