# SEO CTR rollout — production checklist

Use after shipping listing/job/company metadata changes (`buildJobsSeo` v2, `buildJobDetailSeo`, company titles).

## Pre-deploy

- Run `npm run test:soft` in `apps/client` (includes `lib/seo.test.ts` and `lib/seoJobDetail.test.ts`).
- Run `npx tsc --noEmit -p tsconfig.json` in `apps/client`.
- Optional: spot-check `/jobs/role/...`, `/job/{id}`, `/company/{slug}` HTML `<title>` and `<meta name="description">` locally.

## Post-deploy (24–72h)

- **Vercel / hosting**: error rate and latency for `/jobs/*`, `/job/*`; no spike in SSR timeouts.
- **Google Search Console**: Indexing → watch for unusual “Excluded” or “Error” surges on listing URLs.
- **CTR**: Performance → compare average CTR for URL prefix `/jobs/` vs previous week.

## Rollback

- **Fast**: Vercel rollback to prior deployment, or revert the PR and redeploy.
- **Titles only**: set `SEO_TITLE_TEMPLATE=legacy` in the client env to restore pre-v2 listing title/description templates.

## Kill-switch env vars

| Variable | Effect |
|---------|--------|
| `SEO_TITLE_TEMPLATE=legacy` | Listing pages use legacy `Hiring Now (Updated Daily)` pattern. |
| `SEO_DEBUG_META=true` | Reserved for optional verbose meta logging (keep off in prod). |
