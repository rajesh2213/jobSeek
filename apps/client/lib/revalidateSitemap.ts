import { revalidateTag } from "next/cache";
import {
  SITEMAP_COMPANIES_CACHE_TAG,
  SITEMAP_JOBS_CACHE_TAG,
  SITEMAP_LANDING_CACHE_TAG,
  SITEMAP_STATIC_CACHE_TAG,
} from "./sitemap/generate";

export function revalidateSitemapCaches(): string[] {
  const tags = [
    SITEMAP_JOBS_CACHE_TAG,
    SITEMAP_STATIC_CACHE_TAG,
    SITEMAP_LANDING_CACHE_TAG,
    SITEMAP_COMPANIES_CACHE_TAG,
  ];
  for (const tag of tags) {
    revalidateTag(tag);
  }
  return tags;
}
