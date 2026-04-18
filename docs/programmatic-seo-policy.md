# Programmatic SEO policy (JobSeek)

This document defines crawl and indexing rules implemented in the app. Tune thresholds via environment variables where noted.

## Canonical URLs (job discovery)

- **Preferred shape:** Path slug built with `filtersToSlug` (category, role tokens, skills sorted, ISO country as two letters, optional `-remote`) plus **only** query parameters that are not encoded in the slug.
- **Query-only URLs** (`/jobs?skills=…`) that duplicate an equivalent slug URL should resolve with `rel=canonical` pointing to the slug form when the slug can represent the same filters.
- **Implementation:** `getCanonicalJobListingPathAndQuery` / `getCanonicalJobListingUrl` in [`apps/client/lib/slug-parser.ts`](../apps/client/lib/slug-parser.ts).

## Pagination

- **Model:** Each page ≥ 2 is **self-canonical** with `?page=N` on the canonical path. Page 1 omits `page` from the canonical query.
- Titles include “Page N” when `page > 1` (see `buildJobsSeo`).

## Minimum value (thin pages)

- **Index threshold:** Listings with fewer than `NEXT_PUBLIC_SEO_MIN_JOBS_INDEX` matching jobs (default **3**) send `noindex, follow` so thin faceted URLs do not bloat the index. Sitemap entries use a higher bar for inclusion where applicable.

## Crawl budget

- **Sitemap:** Programmatic job-discovery URLs come from `GET /seo/landing-pages` with caps (`maxSlugs`, `minCount`). Job detail URLs remain capped (500) for the main sitemap unless raised deliberately.
- **Stale URLs:** Combination pages that drop below thresholds fall out on the next sitemap generation.

## robots.txt

- **Allow:** Public marketing and job discovery.
- **Disallow:** `/account`, `/applications`, `/saved-searches`, `/smart-apply` (authenticated or low SEO value).

## Index / noindex matrix (summary)

| URL pattern | Index when |
|-------------|------------|
| `/`, `/jobs`, `/jobs/…`, `/job/:id`, `/company/:slug`, `/companies`, legal pages | Meets thin threshold for listings; jobs always indexable if found |
| `/account`, `/applications`, … | Blocked in `robots.txt`; not relied on for SEO |

## Operations

- **Google Search Console:** Submit sitemap URL, monitor coverage and canonical duplicates.
- **Production:** Set `NEXT_PUBLIC_SITE_URL` to the canonical origin (https, no trailing slash).
