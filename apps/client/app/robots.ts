import type { MetadataRoute } from "next";
import { MAX_SITEMAP_JOBS, SITEMAP_JOBS_PARTITION_SIZE } from "../lib/sitemap/config";
import { getSiteBaseUrl } from "../lib/seoSite";

function buildSitemapUrls(base: string): string[] {
  const jobPartitions = Math.max(
    1,
    Math.ceil(MAX_SITEMAP_JOBS / SITEMAP_JOBS_PARTITION_SIZE),
  );
  const jobSitemaps = Array.from(
    { length: jobPartitions },
    (_, i) => `${base}/sitemap-jobs-${i + 1}.xml`,
  );
  return [
    `${base}/sitemap.xml`,
    `${base}/sitemap-static.xml`,
    `${base}/sitemap-landing.xml`,
    `${base}/sitemap-companies.xml`,
    ...jobSitemaps,
  ];
}

export default function robots(): MetadataRoute.Robots {
  const base = getSiteBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/applications", "/saved-searches", "/smart-apply"],
    },
    sitemap: buildSitemapUrls(base),
  };
}
