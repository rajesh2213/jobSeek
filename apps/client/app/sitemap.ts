import type { MetadataRoute } from "next";
import { fetchCompanies, fetchJobs, fetchSeoLandingPages } from "../lib/api";
import { getSiteBaseUrl } from "../lib/seoSite";
import { normalizeRelatedSlugPath } from "../lib/slug-parser";

const MAX_JOB_SITEMAP_PAGES = 10000;
const MAX_COMPANY_SITEMAP_PAGES = 500;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteBaseUrl();
  const now = new Date();
  const internalSeoSecret = process.env.INTERNAL_SEO_SECRET ?? null;
  const seen = new Set<string>();

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
      const jobs = await fetchJobs(
        { page, limit },
        { internalSeoSecret, ssrPage: "sitemap" },
      );
      for (const job of jobs.data) {
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
      const res = await fetchCompanies({ page, limit, sort: "jobs", ssrPage: "sitemap" });
      for (const c of res.data) {
        if ((c.jobCount ?? 0) >= 1) {
          companyEntries.push({
            url: `${base}/company/${c.slug}`,
            lastModified: now,
          });
        }
      }
      const totalPages = res.meta.totalPages ?? 1;
      if (!res.meta.hasMore || page >= totalPages) break;
      page += 1;
      if (page > MAX_COMPANY_SITEMAP_PAGES) break;
    }
  } catch {
    /* ignore */
  }

  return [...staticEntries, ...landing, ...companyEntries, ...jobEntries];
}
