import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { fetchCompanies, fetchJobs, fetchSeoLandingPages } from "../lib/api";
import { getSiteBaseUrl } from "../lib/seoSite";
import { normalizeRelatedSlugPath, parseSlugWithMeta } from "../lib/slug-parser";
import {
  decideCompanySeoPolicy,
  decideJobDetailSeoPolicy,
  isSitemapEligibleJobsPath,
  type SeoPolicyReason,
} from "../lib/seoIndexability";

/**
 * Deployment stabilization:
 * - Prevent build-time prerender execution for /sitemap.xml.
 * - Keep runtime generation on Node where Buffer/process telemetry is used.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseBoundedIntEnv(
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

const SITEMAP_REVALIDATE_SECONDS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_REVALIDATE_SECONDS,
  300,
  60,
  3600,
);
const MAX_JOB_SITEMAP_PAGES = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_JOB_PAGES,
  30,
  1,
  40,
);
const JOBS_FETCH_LIMIT = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_JOB_FETCH_LIMIT,
  100,
  1,
  100,
);
const MAX_COMPANY_SITEMAP_PAGES = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_COMPANY_PAGES,
  100,
  1,
  1000,
);
const MAX_LANDING_SITEMAP_SLUGS = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_MAX_LANDING_SLUGS,
  1500,
  50,
  10000,
);
const LANDING_MIN_COUNT = parseBoundedIntEnv(
  process.env.SEO_SITEMAP_LANDING_MIN_COUNT,
  5,
  1,
  100,
);

let sitemapGenerationRuns = 0;
let lastGenerationCompletedAtMs: number | null = null;

async function generateSitemapData(): Promise<MetadataRoute.Sitemap> {
  const startedAt = Date.now();
  const generationRun = ++sitemapGenerationRuns;
  const base = getSiteBaseUrl();
  const now = new Date();
  const internalSeoSecret = process.env.INTERNAL_SEO_SECRET ?? null;
  const internalSeoSecretPresent = Boolean(internalSeoSecret?.trim());
  const sitemapPruningEnabled = process.env.SEO_SITEMAP_PRUNING_ENABLED === "true";
  const companyGateEnabled = process.env.SEO_COMPANY_QUALITY_GATE_ENABLED === "true";
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  /** Per-request memo: duplicate page fetches in the same generation share one HTTP call (no URL/coverage change). */
  const fetchJobsForSitemap = cache((page: number, limit: number) =>
    fetchJobs({ page, limit }, { internalSeoSecret, ssrPage: "sitemap" }),
  );
  const fetchCompaniesForSitemap = cache((page: number, limit: number) =>
    fetchCompanies({ page, limit, sort: "jobs", ssrPage: "sitemap" }),
  );
  const seen = new Set<string>();
  const excludedByReason = new Map<SeoPolicyReason, number>();
  const recordExcluded = (reason: SeoPolicyReason) => {
    excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
  };

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now },
    { url: `${base}/jobs`, lastModified: now },
    { url: `${base}/jobs/browse`, lastModified: now },
    { url: `${base}/companies`, lastModified: now },
  ];
  const staticPhaseDurationMs = Date.now() - startedAt;

  const landing: MetadataRoute.Sitemap = [];
  let landingFetchDurationMs = 0;
  let landingTransformDurationMs = 0;
  let landingEstimatedCountQueries = 0;
  let landingEstimatedTotalQueries = 0;
  const sections = {
    landing: {
      ok: true,
      error: null as string | null,
      unauthorized: false,
      inputCount: 0,
      outputCount: 0,
    },
    jobs: { ok: true, error: null as string | null, pages: 0, outputCount: 0 },
    companies: { ok: true, error: null as string | null, pages: 0, outputCount: 0 },
  };
  if (!internalSeoSecretPresent) {
    console.warn("[sitemap] missing INTERNAL_SEO_SECRET in runtime");
  }
  console.info("[sitemap] section_start", {
    section: "landing",
    generationRun,
    maxSlugs: MAX_LANDING_SITEMAP_SLUGS,
    minCount: LANDING_MIN_COUNT,
  });
  try {
    const landingFetchStartedAt = Date.now();
    const res = await fetchSeoLandingPages({
      minCount: LANDING_MIN_COUNT,
      maxSlugs: MAX_LANDING_SITEMAP_SLUGS,
      internalSeoSecret,
    });
    landingFetchDurationMs = Date.now() - landingFetchStartedAt;
    landingEstimatedCountQueries = res.meta?.estimatedCountQueries ?? 0;
    landingEstimatedTotalQueries = res.meta?.estimatedTotalQueries ?? 0;
    sections.landing.unauthorized = res.meta?.unauthorized === true;
    sections.landing.inputCount = res.data.length;
    if (sections.landing.unauthorized) {
      sections.landing.ok = false;
      sections.landing.error = "landing_unauthorized";
    }
    const landingTransformStartedAt = Date.now();
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
        if (!decision.sitemapEligible) {
          recordExcluded(decision.reason);
          continue;
        }
      }
      landing.push({
        url: `${base}${normalized}`,
        lastModified: now,
      });
    }
    landingTransformDurationMs = Date.now() - landingTransformStartedAt;
    sections.landing.outputCount = landing.length;
    console.info("[sitemap] section_complete", {
      section: "landing",
      generationRun,
      ok: sections.landing.ok,
      unauthorized: sections.landing.unauthorized,
      inputCount: sections.landing.inputCount,
      outputCount: sections.landing.outputCount,
      fetchDurationMs: landingFetchDurationMs,
      transformDurationMs: landingTransformDurationMs,
      estimatedCountQueries: landingEstimatedCountQueries,
    });
  } catch (err) {
    sections.landing.ok = false;
    sections.landing.error = err instanceof Error ? err.message : "landing_fetch_failed";
    console.warn("[sitemap] section_failed", {
      section: "landing",
      generationRun,
      error: sections.landing.error,
      fetchDurationMs: landingFetchDurationMs,
      transformDurationMs: landingTransformDurationMs,
    });
  }

  const jobEntries: MetadataRoute.Sitemap = [];
  let jobsDurationMs = 0;
  console.info("[sitemap] section_start", {
    section: "jobs",
    generationRun,
    fetchLimit: JOBS_FETCH_LIMIT,
    maxPages: MAX_JOB_SITEMAP_PAGES,
  });
  try {
    const jobsStartedAt = Date.now();
    let page = 1;
    const limit = JOBS_FETCH_LIMIT;
    for (;;) {
      const jobs = await fetchJobsForSitemap(page, limit);
      for (const job of jobs.data) {
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
          url: `${base}/job/${job.id}`,
          lastModified: job.postedAt ? new Date(job.postedAt) : now,
        });
      }
      sections.jobs.pages = page;
      sections.jobs.outputCount = jobEntries.length;
      const hasMore =
        jobs.meta?.hasMore === true ||
        ((jobs.meta?.totalPages ?? 1) > (jobs.meta?.page ?? page));
      if (!hasMore) break;
      page += 1;
      if (page > MAX_JOB_SITEMAP_PAGES) break;
    }
    jobsDurationMs = Date.now() - jobsStartedAt;
    console.info("[sitemap] section_complete", {
      section: "jobs",
      generationRun,
      ok: sections.jobs.ok,
      pages: sections.jobs.pages,
      outputCount: sections.jobs.outputCount,
      durationMs: jobsDurationMs,
    });
  } catch (err) {
    sections.jobs.ok = false;
    sections.jobs.error = err instanceof Error ? err.message : "jobs_fetch_failed";
    console.warn("[sitemap] section_failed", {
      section: "jobs",
      generationRun,
      error: sections.jobs.error,
      pages: sections.jobs.pages,
      outputCount: sections.jobs.outputCount,
      durationMs: jobsDurationMs,
    });
  }

  const companyEntries: MetadataRoute.Sitemap = [];
  let companiesDurationMs = 0;
  console.info("[sitemap] section_start", {
    section: "companies",
    generationRun,
    maxPages: MAX_COMPANY_SITEMAP_PAGES,
  });
  try {
    const companiesStartedAt = Date.now();
    let page = 1;
    const limit = 100;
    for (;;) {
      const res = await fetchCompaniesForSitemap(page, limit);
      for (const c of res.data) {
        if ((c.jobCount ?? 0) < 1) continue;
        if (sitemapPruningEnabled) {
          let decision = decideCompanySeoPolicy({
            gateEnabled: companyGateEnabled,
            company: { id: c.id, name: c.name, slug: c.slug },
            requestedSlug: c.slug,
          });
          if (forceNoindexAll) decision = { ...decision, sitemapEligible: false };
          if (disableAllNoindex) decision = { ...decision, sitemapEligible: true };
          if (!decision.sitemapEligible) {
            recordExcluded(decision.reason);
            continue;
          }
        }
        companyEntries.push({
          url: `${base}/company/${c.slug}`,
          lastModified: now,
        });
      }
      sections.companies.pages = page;
      sections.companies.outputCount = companyEntries.length;
      const totalPages = res.meta.totalPages ?? 1;
      if (!res.meta.hasMore || page >= totalPages) break;
      page += 1;
      if (page > MAX_COMPANY_SITEMAP_PAGES) break;
    }
    companiesDurationMs = Date.now() - companiesStartedAt;
    console.info("[sitemap] section_complete", {
      section: "companies",
      generationRun,
      ok: sections.companies.ok,
      pages: sections.companies.pages,
      outputCount: sections.companies.outputCount,
      durationMs: companiesDurationMs,
    });
  } catch (err) {
    sections.companies.ok = false;
    sections.companies.error = err instanceof Error ? err.message : "companies_fetch_failed";
    console.warn("[sitemap] section_failed", {
      section: "companies",
      generationRun,
      error: sections.companies.error,
      pages: sections.companies.pages,
      outputCount: sections.companies.outputCount,
      durationMs: companiesDurationMs,
    });
  }

  const output = [...staticEntries, ...landing, ...companyEntries, ...jobEntries];
  const excludedCounts: Record<string, number> = {};
  for (const [k, v] of excludedByReason.entries()) excludedCounts[k] = v;
  const serializeStartedAt = Date.now();
  const payloadJson = JSON.stringify(output);
  const payloadSerializeDurationMs = Date.now() - serializeStartedAt;
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  const mem = process.memoryUsage();
  const totalDurationMs = Date.now() - startedAt;
  lastGenerationCompletedAtMs = Date.now();
  console.info("[sitemap] generation", {
    generationRun,
    durationMs: totalDurationMs,
    durationStaticMs: staticPhaseDurationMs,
    durationLandingFetchMs: landingFetchDurationMs,
    durationLandingTransformMs: landingTransformDurationMs,
    durationJobsMs: jobsDurationMs,
    durationCompaniesMs: companiesDurationMs,
    durationSerializeMs: payloadSerializeDurationMs,
    countTotal: output.length,
    countStatic: staticEntries.length,
    countLanding: landing.length,
    countCompany: companyEntries.length,
    countJob: jobEntries.length,
    excludedByReason: excludedCounts,
    estimatedLandingCountQueries: landingEstimatedCountQueries,
    estimatedLandingTotalQueries: landingEstimatedTotalQueries,
    payloadBytes,
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    pruningEnabled: sitemapPruningEnabled,
    maxLandingSlugs: MAX_LANDING_SITEMAP_SLUGS,
    minLandingCount: LANDING_MIN_COUNT,
    jobsFetchLimit: JOBS_FETCH_LIMIT,
    maxJobPages: MAX_JOB_SITEMAP_PAGES,
    maxCompanyPages: MAX_COMPANY_SITEMAP_PAGES,
    revalidateSeconds: SITEMAP_REVALIDATE_SECONDS,
    internalSeoSecretPresent,
    sections,
  });
  return output;
}

const getCachedSitemap = unstable_cache(generateSitemapData, ["sitemap-v2"], {
  revalidate: SITEMAP_REVALIDATE_SECONDS,
});

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestStartedAt = Date.now();
  const beforeRuns = sitemapGenerationRuns;
  const out = await getCachedSitemap();
  const afterRuns = sitemapGenerationRuns;
  console.info("[sitemap] request", {
    durationMs: Date.now() - requestStartedAt,
    cacheStatus: afterRuns > beforeRuns ? "miss_regenerated" : "hit_cached",
    generationRuns: afterRuns,
    lastGenerationCompletedAtMs,
  });
  return out;
}
