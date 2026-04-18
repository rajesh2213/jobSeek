import type { MetadataRoute } from "next";
import { fetchCompanies, fetchJobs, fetchSeoLandingPages } from "../lib/api";
import { getSiteBaseUrl } from "../lib/seoSite";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteBaseUrl();
  const now = new Date();
  const bypass = process.env.JOB_LIST_VIEW_CAP_BYPASS_TOKEN ?? null;

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
      maxSlugs: 2000,
      viewCapBypassSecret: bypass,
    });
    for (const e of res.data) {
      landing.push({
        url: `${base}/jobs/${e.slug}`,
        lastModified: now,
      });
    }
  } catch {
    /* sitemap still useful without programmatic slugs */
  }

  let jobEntries: MetadataRoute.Sitemap = [];
  try {
    const jobs = await fetchJobs(
      { page: 1, limit: 500 },
      { viewCapBypassSecret: bypass },
    );
    jobEntries = jobs.data.map((job) => ({
      url: `${base}/job/${job.id}`,
      lastModified: job.postedAt ? new Date(job.postedAt) : now,
    }));
  } catch {
    /* ignore */
  }

  const companyEntries: MetadataRoute.Sitemap = [];
  try {
    let page = 1;
    const limit = 100;
    for (;;) {
      const res = await fetchCompanies({ page, limit, sort: "jobs" });
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
      if (page > 500) break;
    }
  } catch {
    /* ignore */
  }

  return [...staticEntries, ...landing, ...companyEntries, ...jobEntries];
}
