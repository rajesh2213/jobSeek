# Phase 6 — JSON-LD, sitemap, and SEO aggregations

Strategy A throughout: never emit a freshness signal we can't truthfully back.

## 1. `JobPosting` JSON-LD (`apps/client/lib/jobPostingJsonLd.ts`)

### Behavior change

| Field | Before | After |
|---|---|---|
| `datePosted` | `firstValidDateIso(postedAt, effectivePostedAt, createdAt)` — emitted crawl date when no publish date existed | Emitted **only** when `postedAt` is a valid ISO string. Omitted otherwise. |
| `validThrough` | `(postedAt ?? createdAt) + 45 days` — extended from crawl date too | Derived **only** from `postedAt`. Omitted when no real publish date. |

### Sample output (DISCOVERED — no `postedAt`)

Before (incorrect — `datePosted` is the crawl time):

```json
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Engineer",
  "datePosted": "2026-05-12T09:14:22.000Z",
  "validThrough": "2026-06-26T09:14:22.000Z"
}
```

After (correct — both fields omitted):

```json
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Engineer"
}
```

### Sample output (POSTED — real publish date)

Unchanged in both before/after:

```json
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Engineer",
  "datePosted": "2026-05-08T00:00:00.000Z",
  "validThrough": "2026-06-22T00:00:00.000Z"
}
```

### Google Rich Results compatibility

- `datePosted` is **recommended** but **not required** by Google's JobPosting markup
  spec. Omitting it does not block Rich Results eligibility; Google falls back to
  "crawl-time-of-page" which is the semantically correct behavior for discovery-only
  rows.
- Test with: https://search.google.com/test/rich-results — paste the rendered HTML
  of `/job/<id>` for a DISCOVERED row and confirm no schema validation errors.

## 2. Sitemap (`apps/client/app/sitemap.ts`)

### Behavior change

| Row state | Before `lastModified` | After `lastModified` |
|---|---|---|
| Has `postedAt` | `postedAt` | `postedAt` (unchanged) |
| No `postedAt`, has `createdAt` | `now()` — moved every sitemap regen | `createdAt` — stable per row |
| Neither | `now()` | `now()` (preserved fallback) |

### Why this matters

Bumping `lastModified` to `now()` for every discovery-only row caused Googlebot to
re-fetch unchanged URLs on every sitemap pull. That wastes crawl budget, can be
interpreted as instability, and risks ranking degradation. The new deterministic
`createdAt` fallback means lastmod only moves when the row's underlying date
actually changes.

## 3. SEO hiring-trend aggregation (`apps/server/src/modules/seo/seoAggregations.service.ts`)

### Behavior change

The 14-day hiring trend now buckets by `postedAt` only:

```diff
- SELECT DATE_TRUNC('day', COALESCE(j."postedAt", j."createdAt")) AS day, ...
- WHERE COALESCE(j."postedAt", j."createdAt") >= NOW() - INTERVAL '14 days'
+ SELECT DATE_TRUNC('day', j."postedAt") AS day, ...
+ WHERE j."postedAt" IS NOT NULL
+   AND j."postedAt" >= NOW() - INTERVAL '14 days'
```

### Why this matters

The hiring-trend chart on SEO landing pages is labeled "jobs posted per day". Mixing
in crawl timestamps inflated the bars for sources without a real publish date and
created a flat plateau aligned with the crawler's cadence. SEO consumers (Google's
indexing pipeline, AI summarizers, recruiter analytics tools) treat this chart as a
trust signal. Strict bucketing makes the chart smaller but accurate.

### Trade-off

Sources where `postedAt` coverage is poor (`wellfound`, `careers_page`) will produce
empty trends on landing pages that filter to those sources. The follow-up to address
this is to extract `datePosted` from career-page JSON-LD during ingestion (see
"Follow-up recommendations" in `docs/freshness-overhaul/12-final-report.md`).

## 4. What was NOT touched in Phase 6

- Adapter parsers (Greenhouse `updated_at` issue, careers_page JSON-LD `datePosted`
  extraction) — listed as follow-ups in the final report.
- Application JSON `JobItem` contract — Phase 7 extends it with `freshness`.
- Frontend rendering of "Posted X ago" vs "Added X ago" — Phase 8.

## 5. Validation

```sh
# Pull a known DISCOVERED row and assert datePosted is absent:
curl -s 'https://jobloom.example/job/<discovered-row-id>' \
  | grep -oE 'application/ld\+json.*?</script>' \
  | grep -E 'datePosted|validThrough' \
  | tee /tmp/jsonld-discovered.txt
# Expected: empty file (datePosted + validThrough both omitted).

# Pull a known POSTED row and assert datePosted is present and matches postedAt:
curl -s 'https://jobloom.example/job/<posted-row-id>' \
  | grep -oE 'datePosted":"[^"]+'
```
