# SEO monitoring (operations)

## Google Search Console

1. Verify domain ownership for the production origin.
2. Submit the sitemap URL: `https://<your-domain>/sitemap.xml`.
3. Monitor **Coverage**, **Page indexing**, and **Core Web Vitals** for `/`, `/jobs`, `/job/*`, and `/company/*`.

## Environment

- **`NEXT_PUBLIC_SITE_URL`** — Canonical site origin (https, no trailing slash). Used for sitemaps, canonical tags, and JSON-LD URLs.
- **`JOB_LIST_VIEW_CAP_BYPASS_TOKEN`** — Shared secret for server-side bulk reads (`GET /seo/landing-pages`, sitemap job lists). Set the same value on the Fastify server and Next.js server environment (not `NEXT_PUBLIC_*`).

## Automated smoke check

From the repo root:

```bash
NEXT_PUBLIC_SITE_URL=https://your.production.domain npm run seo:check-sitemap
```

Exits with code 1 if `sitemap.xml` or `robots.txt` is not HTTP 2xx.

## Thin URL audit

Programmatic listing URLs use `noindex,follow` when result count is below `NEXT_PUBLIC_SEO_MIN_JOBS_INDEX` (default `3`). Periodically review Search Console for unexpected exclusions or duplicate canonicals.
