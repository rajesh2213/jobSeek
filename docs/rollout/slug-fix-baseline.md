# Slug Fix Baseline Snapshot

Captured: 2026-06-04T13:17:43.583Z

## Endpoint metrics

| Metric | Value |
|--------|------:|
| Total AtsEndpoint rows | 1128 |
| Linked (`companyId` NOT NULL) | 901 |
| Orphan (`companyId` IS NULL) | 227 |
| Active endpoints | 809 |
| Active linked | 582 |
| Active orphans | 227 |

## Company metrics

| Metric | Value |
|--------|------:|
| Total companies | 10347 |
| Companies with `atsBoardToken` | 723 |
| Companies `status=ready` | 724 |
| Ready + token | 723 |
| Invalid tokens (posting-api, embed, login, signin, api) | **15** |

## Coverage metrics

| Metric | Value |
|--------|------:|
| Distinct companies with linked endpoint | **844** |

## Token collisions (duplicate atsType + atsBoardToken)

| atsType | atsBoardToken | count |
|---------|---------------|------:|
| ashby | posting-api | 8 |
| greenhouse | embed | 7 |
| workday | `{"host":"coke.wd1.myworkdayjobs.com",...,"site":"introduceYourself"}` | 2 |
| lever | octoenergy | 2 |
| greenhouse | harnessinc | 2 |
| greenhouse | figment | 2 |
| ashby | harrison | 2 |
| lever | avalerehealth | 2 |

## Bad token groups (pre-migration)

| atsType | atsBoardToken | count |
|---------|---------------|------:|
| ashby | posting-api | 8 |
| greenhouse | embed | 7 |
