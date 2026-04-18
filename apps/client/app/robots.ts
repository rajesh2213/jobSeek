import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "../lib/seoSite";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/applications", "/saved-searches", "/smart-apply"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
