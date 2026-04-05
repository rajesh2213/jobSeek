import type { MetadataRoute } from "next";
import { fetchJobs } from "../lib/api";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
const SEO_SLUGS = ["nodejs", "python", "react", "nodejs-remote", "python-india", "remote"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/jobs`, lastModified: now },
    ...SEO_SLUGS.map((slug) => ({
      url: `${BASE_URL}/jobs/${slug}`,
      lastModified: now,
    })),
  ];

  try {
    const jobs = await fetchJobs(
      { page: 1, limit: 500 },
      { viewCapBypassSecret: process.env.JOB_LIST_VIEW_CAP_BYPASS_TOKEN ?? null },
    );
    const jobEntries = jobs.data.map((job) => ({
      url: `${BASE_URL}/job/${job.id}`,
      lastModified: job.postedAt ? new Date(job.postedAt) : now,
    }));
    return [...staticEntries, ...jobEntries];
  } catch {
    return staticEntries;
  }
}

