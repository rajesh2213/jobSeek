export function parseBoundedIntEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const SITEMAP_REVALIDATE_SECONDS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_REVALIDATE_SECONDS,
  300,
  60,
  3600,
);

export const MAX_COMPANY_SITEMAP_PAGES = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_COMPANY_PAGES,
  100,
  1,
  1000,
);

export const MAX_LANDING_SITEMAP_SLUGS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_LANDING_SLUGS,
  1500,
  50,
  10000,
);

export const LANDING_MIN_COUNT = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_LANDING_MIN_COUNT,
  5,
  1,
  100,
);

export const LANDING_SECTION_BUDGET_MS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_LANDING_BUDGET_MS,
  16000,
  2000,
  60000,
);

export const JOBS_SECTION_BUDGET_MS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_JOBS_BUDGET_MS,
  45000,
  5000,
  120000,
);

export const COMPANIES_SECTION_BUDGET_MS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_COMPANIES_BUDGET_MS,
  18000,
  5000,
  120000,
);

/** Max job detail URLs emitted across all job sitemap partitions. */
export const MAX_SITEMAP_JOBS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_JOBS,
  10000,
  100,
  50000,
);

/** URLs per `sitemap-jobs-N.xml` child file. */
export const SITEMAP_JOBS_PARTITION_SIZE = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_JOBS_PARTITION_SIZE,
  2000,
  500,
  10000,
);

export const SITEMAP_CURSOR_FETCH_LIMIT = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_CURSOR_FETCH_LIMIT,
  500,
  1,
  1000,
);
