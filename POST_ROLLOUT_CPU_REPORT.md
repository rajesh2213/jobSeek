# Fluid CPU rollout — post-deploy report

Fill after each wave. Baseline: [POST_ROLLOUT_CPU_PREFLIGHT.md](./POST_ROLLOUT_CPU_PREFLIGHT.md).

## Wave A — deployed

| Item | Status |
|------|--------|
| Git SHA | _fill after push_ |
| Vercel Ready | _yes/no_ |
| VPS restart | _only if SEO_AGGREGATION_REDIS_CACHE set on API_ |
| Sitemap 200 | _curl -sI /sitemap.xml_ |
| Slug ISR | _repeat URL, check cache headers_ |
| `/account` protected | _yes/no_ |

## Wave B — deployed

| Item | Status |
|------|--------|
| `SSR_PUBLIC_SEO_LOADERS=1` on Vercel | _yes/no_ |
| Anon job detail JSON-LD | _yes/no_ |
| Signed-in caps | _yes/no_ |

## Wave C — deployed

| Item | Status |
|------|--------|
| Git SHA | _fill_ |
| `SSR_COMPANY_JOBS=1` | _yes/no_ |
| `COMPANY_JOBS_SKIP_EXACT_COUNT=1` on VPS | _yes/no_ |
| `bash deploy/restart-jobseek.sh` | _done_ |
| `curl health` | _200_ |

## CPU delta (48h after Wave C)

| Route | Before | After | Δ% |
|-------|--------|-------|-----|
| `/job/[id]` | | | |
| `/jobs/[...slug]` | | | |
| `/api/jobs` | | | |
| `/sitemap.xml` | | | |
| `/company/[slug]` | | | |

## Production deploy commands (VPS)

```bash
cd /home/deploy/apps/jobSeek
git pull
npm install
npm run build:server
# set env flags in .env then:
bash deploy/restart-jobseek.sh
curl -s http://127.0.0.1:3000/health
```

## Rollback

- Vercel: `SSR_PUBLIC_SEO_LOADERS=0`, `SSR_COMPANY_JOBS=0`, `API_JOBS_ANON_CACHE_ENABLED=0`
- VPS: `COMPANY_JOBS_SKIP_EXACT_COUNT=0` + restart API
- Git: revert to preflight SHA and redeploy both surfaces
