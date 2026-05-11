import { fetchSeoLandingPages } from "./api";
import { normalizeRelatedSlugPath } from "./slug-parser";

/**
 * Related search links for jobs listing footers (optional SSR helper).
 *
 * Avoid awaiting this on hot App Router paths: `/seo/landing-pages` can take tens of seconds
 * under load. `JobsSearchClient` already loads related slugs after paint via `fetchSeoLandingPages`.
 */
export async function fetchJobsRelatedSlugs(opts: {
  currentSlug: string;
  fallback: string[];
  /** Upper bound on landing-page rows fetched from SEO API (default 150). */
  maxSlugs?: number;
}): Promise<string[]> {
  const { currentSlug, fallback, maxSlugs = 150 } = opts;
  const normalizedCurrent = normalizeRelatedSlugPath(currentSlug).replace(/^\/jobs\/?/, "");
  try {
    const seo = await fetchSeoLandingPages({
      minCount: 5,
      maxSlugs,
      internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
    });
    const next = seo.data
      .map((e) => ({ ...e, slug: normalizeRelatedSlugPath(e.slug).replace(/^\/jobs\/?/, "") }))
      .filter((e) => e.slug && e.slug !== normalizedCurrent)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((e) => e.slug);
    if (next.length > 0) return next;
  } catch {
    /* keep fallback */
  }
  return fallback;
}
