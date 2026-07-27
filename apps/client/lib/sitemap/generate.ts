import { unstable_cache } from "next/cache";
import { cache } from "react";
import { fetchCompanies, fetchSeoLandingPages, fetchSeoSitemapJobs } from "../api";
import { getSiteBaseUrl } from "../seoSite";
import { normalizeRelatedSlugPath, parseSlugWithMeta } from "../slug-parser";
import {
  decideCompanySeoPolicy,
  decideJobDetailSeoPolicy,
  isSitemapEligibleJobsPath,
  type SeoPolicyReason,
} from "../seoIndexability";
import {
  COMPANIES_SECTION_BUDGET_MS,
  JOBS_SECTION_BUDGET_MS,
  LANDING_MIN_COUNT,
  LANDING_SECTION_BUDGET_MS,
  MAX_COMPANY_SITEMAP_PAGES,
  MAX_LANDING_SITEMAP_SLUGS,
  MAX_SITEMAP_JOBS,
  SITEMAP_CURSOR_FETCH_LIMIT,
  SITEMAP_JOBS_PARTITION_SIZE,
  SITEMAP_REVALIDATE_SECONDS,
} from "./config";
import type { SitemapUrlEntry } from "./xml";

export type { SitemapUrlEntry };

function createTimeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label}_timeout_${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function jobLastModified(
  job: { postedAt: string | null; createdAt: string },
  now: Date,
): Date {
  if (job.postedAt) return new Date(job.postedAt);
  if (job.createdAt) return new Date(job.createdAt);
  return now;
}

/**
 * Compact cache shape for job entries: id + lastModified epoch ms only.
 *
 * The full `SitemapUrlEntry` (absolute URL + Date) roughly doubles the
 * serialized size. At a 40k cap the expanded array exceeds Vercel's 2MB
 * Data Cache per-entry limit, so the write is silently skipped and every
 * request regenerates non-deterministically (the index lists partitions
 * that then 404). Caching the compact form keeps the full set under the
 * limit so the index and partition routes read one consistent snapshot.
 */
export type CompactJobEntry = { id: string; lm: number };

function expandCompactJobEntries(
  base: string,
  entries: CompactJobEntry[],
): SitemapUrlEntry[] {
  return entries.map((e) => ({
    url: `${base}/job/${e.id}`,
    lastModified: new Date(e.lm),
  }));
}

export async function generateStaticEntries(now = new Date()): Promise<SitemapUrlEntry[]> {
  const base = getSiteBaseUrl();
  return [
    { url: `${base}/`, lastModified: now },
    { url: `${base}/jobs`, lastModified: now },
    { url: `${base}/jobs/browse`, lastModified: now },
    { url: `${base}/companies`, lastModified: now },
    { url: `${base}/features/smart-apply`, lastModified: now },
    { url: `${base}/features/application-tracker`, lastModified: now },
    { url: `${base}/blog`, lastModified: now },
    { url: `${base}/blog/why-youre-probably-finding-jobs-too-late`, lastModified: now },
    { url: `${base}/blog/company-career-sites-vs-linkedin`, lastModified: now },
    { url: `${base}/blog/how-to-find-jobs-before-linkedin`, lastModified: now },
  ];
}

export async function generateLandingEntries(): Promise<{
  entries: SitemapUrlEntry[];
  degraded: boolean;
}> {
  const base = getSiteBaseUrl();
  const now = new Date();
  const internalSeoSecret = process.env.INTERNAL_SEO_SECRET ?? null;
  const sitemapPruningEnabled = process.env.SEO_SITEMAP_PRUNING_ENABLED === "true";
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  const landing: SitemapUrlEntry[] = [];
  const seen = new Set<string>();

  try {
    const res = await withTimeout(
      fetchSeoLandingPages({
        minCount: LANDING_MIN_COUNT,
        maxSlugs: MAX_LANDING_SITEMAP_SLUGS,
        internalSeoSecret,
        noCache: true,
      }),
      LANDING_SECTION_BUDGET_MS,
      "landing_fetch",
    );
    for (const e of res.data) {
      const normalized = normalizeRelatedSlugPath(e.slug);
      if (normalized === "/jobs" || seen.has(normalized)) continue;
      seen.add(normalized);
      if (sitemapPruningEnabled) {
        const rest = normalized.replace(/^\/jobs\/?/, "");
        const segments = rest.split("/").filter(Boolean);
        const parsed = parseSlugWithMeta(segments);
        let decision = isSitemapEligibleJobsPath({
          validCanonicalSlugPath: parsed.validCanonical,
          filters: parsed.filters,
        });
        if (forceNoindexAll) decision = { ...decision, sitemapEligible: false };
        if (disableAllNoindex) decision = { ...decision, sitemapEligible: true };
        if (!decision.sitemapEligible) continue;
      }
      landing.push({ url: `${base}${normalized}`, lastModified: now });
    }
    return { entries: landing, degraded: res.meta?.unauthorized === true };
  } catch {
    return { entries: landing, degraded: true };
  }
}

export async function generateCompanyEntries(): Promise<{
  entries: SitemapUrlEntry[];
  degraded: boolean;
}> {
  const base = getSiteBaseUrl();
  const now = new Date();
  const companyGateEnabled = process.env.SEO_COMPANY_QUALITY_GATE_ENABLED === "true";
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  const fetchCompaniesForSitemap = cache((page: number, limit: number) =>
    fetchCompanies({ page, limit, sort: "jobs", ssrPage: "sitemap" }),
  );
  const companyEntries: SitemapUrlEntry[] = [];
  let degraded = false;

  try {
    const companiesStartedAt = Date.now();
    let page = 1;
    const limit = 100;
    for (;;) {
      const elapsedMs = Date.now() - companiesStartedAt;
      const remainingBudgetMs = COMPANIES_SECTION_BUDGET_MS - elapsedMs;
      if (remainingBudgetMs <= 0) {
        degraded = true;
        break;
      }
      const res = await withTimeout(
        fetchCompaniesForSitemap(page, limit),
        remainingBudgetMs,
        "companies_fetch",
      );
      for (const c of res.data) {
        const visibleJobCount = c.jobCount ?? 0;
        // Sitemap company feed is hiring-filtered; treat jobCount>0 as hasEverHadJobs.
        const maybeEver = (c as { hasEverHadJobs?: boolean }).hasEverHadJobs;
        const hasEverHadJobs =
          typeof maybeEver === "boolean" ? maybeEver : visibleJobCount > 0;
        let decision = decideCompanySeoPolicy({
          gateEnabled: companyGateEnabled,
          company: { id: c.id, name: c.name, slug: c.slug },
          requestedSlug: c.slug,
          visibleJobCount,
          hasEverHadJobs,
        });
        if (forceNoindexAll) decision = { ...decision, sitemapEligible: false };
        if (disableAllNoindex) decision = { ...decision, sitemapEligible: true };
        if (!decision.sitemapEligible) continue;
        companyEntries.push({
          url: `${base}/company/${c.slug}`,
          lastModified: now,
        });
      }
      const totalPages = res.meta.totalPages ?? 1;
      if (!res.meta.hasMore || page >= totalPages) break;
      page += 1;
      if (page > MAX_COMPANY_SITEMAP_PAGES) break;
    }
  } catch {
    degraded = true;
  }
  return { entries: companyEntries, degraded };
}

/**
 * Walk cursor-paginated SEO job feed (no OFFSET) up to MAX_SITEMAP_JOBS.
 */
export async function generateJobEntries(): Promise<{
  entries: CompactJobEntry[];
  degraded: boolean;
  excludedByReason: Record<string, number>;
}> {
  const now = new Date();
  const internalSeoSecret = process.env.INTERNAL_SEO_SECRET ?? null;
  const sitemapPruningEnabled = process.env.SEO_SITEMAP_PRUNING_ENABLED === "true";
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  const excludedByReason = new Map<SeoPolicyReason, number>();
  const recordExcluded = (reason: SeoPolicyReason) => {
    excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
  };

  const jobEntries: CompactJobEntry[] = [];
  let degraded = false;
  let cursor: string | null = null;

  try {
    const jobsStartedAt = Date.now();
    for (;;) {
      const elapsedMs = Date.now() - jobsStartedAt;
      const remainingBudgetMs = JOBS_SECTION_BUDGET_MS - elapsedMs;
      if (remainingBudgetMs <= 0) {
        degraded = true;
        break;
      }
      if (jobEntries.length >= MAX_SITEMAP_JOBS) break;

      const fetchLimit = Math.min(
        SITEMAP_CURSOR_FETCH_LIMIT,
        MAX_SITEMAP_JOBS - jobEntries.length,
      );
      const res: Awaited<ReturnType<typeof fetchSeoSitemapJobs>> = await withTimeout(
        fetchSeoSitemapJobs({ cursor, limit: fetchLimit, internalSeoSecret }),
        remainingBudgetMs,
        "sitemap_jobs_fetch",
      );

      for (const job of res.data) {
        if (sitemapPruningEnabled) {
          let detailDecision = decideJobDetailSeoPolicy();
          if (forceNoindexAll) detailDecision = { ...detailDecision, sitemapEligible: false };
          if (disableAllNoindex) detailDecision = { ...detailDecision, sitemapEligible: true };
          if (!detailDecision.sitemapEligible) {
            recordExcluded("exclude_sitemap_noindex");
            continue;
          }
        }
        jobEntries.push({
          id: job.id,
          lm: jobLastModified(job, now).getTime(),
        });
        if (jobEntries.length >= MAX_SITEMAP_JOBS) break;
      }

      if (!res.meta.hasMore || !res.meta.nextCursor) break;
      cursor = res.meta.nextCursor;
    }
  } catch {
    degraded = true;
  }

  const excludedCounts: Record<string, number> = {};
  for (const [k, v] of excludedByReason.entries()) excludedCounts[k] = v;
  console.info("[sitemap] jobs_cursor_walk", {
    outputCount: jobEntries.length,
    maxJobs: MAX_SITEMAP_JOBS,
    degraded,
    excludedByReason: excludedCounts,
  });
  return { entries: jobEntries, degraded, excludedByReason: excludedCounts };
}

export function partitionJobEntries(entries: SitemapUrlEntry[]): SitemapUrlEntry[][] {
  if (entries.length === 0) return [];
  const parts: SitemapUrlEntry[][] = [];
  for (let i = 0; i < entries.length; i += SITEMAP_JOBS_PARTITION_SIZE) {
    parts.push(entries.slice(i, i + SITEMAP_JOBS_PARTITION_SIZE));
  }
  return parts;
}

export function jobPartitionCount(totalJobs: number): number {
  if (totalJobs <= 0) return 0;
  return Math.ceil(totalJobs / SITEMAP_JOBS_PARTITION_SIZE);
}

export const SITEMAP_JOBS_CACHE_TAG = "sitemap-jobs-v1";
export const SITEMAP_STATIC_CACHE_TAG = "sitemap-static-v1";
export const SITEMAP_LANDING_CACHE_TAG = "sitemap-landing-v1";
export const SITEMAP_COMPANIES_CACHE_TAG = "sitemap-companies-v1";

const getCachedStatic = unstable_cache(generateStaticEntries, ["sitemap-static-v1"], {
  revalidate: SITEMAP_REVALIDATE_SECONDS,
  tags: [SITEMAP_STATIC_CACHE_TAG],
});

const getCachedLanding = unstable_cache(generateLandingEntries, ["sitemap-landing-v1"], {
  revalidate: SITEMAP_REVALIDATE_SECONDS,
  tags: [SITEMAP_LANDING_CACHE_TAG],
});

const getCachedCompanies = unstable_cache(generateCompanyEntries, ["sitemap-companies-v1"], {
  revalidate: SITEMAP_REVALIDATE_SECONDS,
  tags: [SITEMAP_COMPANIES_CACHE_TAG],
});

const getCachedJobs = unstable_cache(generateJobEntries, ["sitemap-jobs-compact-v2"], {
  revalidate: SITEMAP_REVALIDATE_SECONDS,
  tags: [SITEMAP_JOBS_CACHE_TAG],
});

export async function buildRobotsSitemapUrls(base: string): Promise<string[]> {
  const { entries: jobs } = await getCachedJobs();
  const partitions = jobPartitionCount(jobs.length);
  const urls = [
    `${base}/sitemap.xml`,
    `${base}/sitemap-static.xml`,
    `${base}/sitemap-landing.xml`,
    `${base}/sitemap-companies.xml`,
  ];
  for (let p = 1; p <= partitions; p++) {
    urls.push(`${base}/sitemap-jobs-${p}.xml`);
  }
  return urls;
}

export async function getStaticSitemapEntries() {
  return getCachedStatic();
}

export async function getLandingSitemapEntries() {
  return getCachedLanding();
}

export async function getCompanySitemapEntries() {
  return getCachedCompanies();
}

export async function getJobSitemapEntries(): Promise<{
  entries: SitemapUrlEntry[];
  degraded: boolean;
  excludedByReason: Record<string, number>;
}> {
  const base = getSiteBaseUrl();
  const { entries, degraded, excludedByReason } = await getCachedJobs();
  return {
    entries: expandCompactJobEntries(base, entries),
    degraded,
    excludedByReason,
  };
}

export async function buildSitemapIndexLocations(): Promise<string[]> {
  const base = getSiteBaseUrl();
  const { entries: jobs } = await getCachedJobs();
  const partitions = jobPartitionCount(jobs.length);
  const locs = [
    `${base}/sitemap-static.xml`,
    `${base}/sitemap-landing.xml`,
    `${base}/sitemap-companies.xml`,
  ];
  for (let p = 1; p <= partitions; p++) {
    locs.push(`${base}/sitemap-jobs-${p}.xml`);
  }
  return locs;
}
