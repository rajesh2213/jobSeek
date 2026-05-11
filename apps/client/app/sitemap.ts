import type { MetadataRoute } from "next";
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
 * This route paginates jobs/companies across many HTTP requests. Static generation during
 * `next build` exceeds Vercel's per-route timeout (~60s). Generate at request time instead.
 */
export const dynamic = "force-dynamic";

const MAX_JOB_SITEMAP_PAGES = 10000;
const MAX_COMPANY_SITEMAP_PAGES = 500;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const startedAt = Date.now();
  const base = getSiteBaseUrl();
  const now = new Date();
  const internalSeoSecret = process.env.INTERNAL_SEO_SECRET ?? null;
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

  const landing: MetadataRoute.Sitemap = [];
  try {
    const res = await fetchSeoLandingPages({
      minCount: 5,
      maxSlugs: 20000,
      internalSeoSecret,
    });
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
  } catch {
    /* sitemap still useful without programmatic slugs */
  }

  const jobEntries: MetadataRoute.Sitemap = [];
  try {
    let page = 1;
    const limit = 1000;
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
      const hasMore =
        jobs.meta?.hasMore === true ||
        ((jobs.meta?.totalPages ?? 1) > (jobs.meta?.page ?? page));
      if (!hasMore) break;
      page += 1;
      if (page > MAX_JOB_SITEMAP_PAGES) break;
    }
  } catch {
    /* ignore */
  }

  const companyEntries: MetadataRoute.Sitemap = [];
  try {
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
      const totalPages = res.meta.totalPages ?? 1;
      if (!res.meta.hasMore || page >= totalPages) break;
      page += 1;
      if (page > MAX_COMPANY_SITEMAP_PAGES) break;
    }
  } catch {
    /* ignore */
  }

  const output = [...staticEntries, ...landing, ...companyEntries, ...jobEntries];
  const excludedCounts: Record<string, number> = {};
  for (const [k, v] of excludedByReason.entries()) excludedCounts[k] = v;
  const payloadBytes = Buffer.byteLength(JSON.stringify(output), "utf8");
  const mem = process.memoryUsage();
  console.info("[sitemap] generation", {
    durationMs: Date.now() - startedAt,
    countTotal: output.length,
    countStatic: staticEntries.length,
    countLanding: landing.length,
    countCompany: companyEntries.length,
    countJob: jobEntries.length,
    excludedByReason: excludedCounts,
    payloadBytes,
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    pruningEnabled: sitemapPruningEnabled,
  });
  return output;
}
