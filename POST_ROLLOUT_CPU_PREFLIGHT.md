# Fluid CPU rollout — pre-flight baseline

Captured before Wave A implementation (local workspace).

## Git

| Field | Value |
|-------|-------|
| SHA | `212c84ce64ee187a5ef521dc2d89dc3f1676215c` |
| Message | `fix(seo): skill hub sidebar aggregations and layout collapse` |

Record production Vercel + VPS SHA after each wave deploy.

## Env flags (snapshot — verify in Vercel + VPS before/after)

| Variable | Purpose |
|----------|---------|
| `INTERNAL_SEO_SECRET` | Must match between Vercel client and VPS API |
| `SEO_ENRICHMENT_AGGREGATIONS` | Sidebar SSR aggregations |
| `JOBS_LISTING_CACHE_ENABLED` | Redis listing cache (not `0`) |
| `SEO_AGGREGATION_REDIS_CACHE` | Wave A: set to `1` |
| `SEO_SITEMAP_REVALIDATE_SECONDS` | Sitemap `unstable_cache` TTL |
| `SSR_PUBLIC_SEO_LOADERS` | Wave B: `1` prod / `0` rollback |
| `SSR_COMPANY_JOBS` | Wave C: `1` prod / `0` rollback |
| `COMPANY_JOBS_SKIP_EXACT_COUNT` | Wave C VPS: `1` optional |

## Vercel Observability (fill from dashboard)

Export 7-day baseline before Wave A; update after each wave:

| Route | Fluid CPU | Invocations | P75 | P95 |
|-------|-----------|-------------|-----|-----|
| `/job/[id]` | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| `/jobs/[...slug]` | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| `/api/jobs` | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| `/sitemap.xml` | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| `/company/[slug]` | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## Rollback

Revert to SHA above + restore middleware matcher + `noStore()` on jobs slug if needed.
