import type { MetadataRoute } from "next";
import { buildRobotsSitemapUrls } from "../lib/sitemap/generate";
import { getSiteBaseUrl } from "../lib/seoSite";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = getSiteBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/applications", "/saved-searches", "/smart-apply"],
    },
    sitemap: await buildRobotsSitemapUrls(base),
  };
}
