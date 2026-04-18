import { fetchSeoLandingPages } from "./api";

/**
 * Related search links for jobs listing footers. Runs in parallel with `GET /jobs` on the page.
 * Caps SEO payload size so the API responds quickly.
 */
export async function fetchJobsRelatedSlugs(opts: {
  currentSlug: string;
  fallback: string[];
  /** Upper bound on landing-page rows fetched from SEO API (default 150). */
  maxSlugs?: number;
}): Promise<string[]> {
  const { currentSlug, fallback, maxSlugs = 150 } = opts;
  try {
    const seo = await fetchSeoLandingPages({
      minCount: 5,
      maxSlugs,
      viewCapBypassSecret: process.env.JOB_LIST_VIEW_CAP_BYPASS_TOKEN ?? null,
    });
    const next = seo.data
      .filter((e) => e.slug !== currentSlug)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((e) => e.slug);
    if (next.length > 0) return next;
  } catch {
    /* keep fallback */
  }
  return fallback;
}
