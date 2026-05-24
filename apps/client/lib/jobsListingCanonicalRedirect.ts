import type { NextRequest } from "next/server";
import {
  buildIncomingJobListingUrl,
  getCanonicalJobListingUrl,
  parseJobFiltersFromSearch,
  parseSlugWithMeta,
} from "./slug-parser";

function searchParamsRecord(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (value.length > 0) out[key] = value;
  });
  return out;
}

/** Skip middleware redirect for non-listing job routes. */
export function isJobsListingRedirectPath(pathname: string): boolean {
  if (pathname === "/jobs") return true;
  if (!pathname.startsWith("/jobs/")) return false;
  if (pathname === "/jobs/browse" || pathname.startsWith("/jobs/browse/")) return false;
  return true;
}

/**
 * Returns an absolute redirect URL when the request should canonicalize to a
 * different path or stripped query string. Pure comparison — safe for Edge middleware.
 */
export function resolveJobsListingCanonicalRedirectUrl(
  origin: string,
  pathname: string,
  searchParams: Record<string, string>,
): string | null {
  if (!isJobsListingRedirectPath(pathname)) return null;

  if (pathname === "/jobs") {
    if (Object.keys(searchParams).length === 0) return null;
    const filters = parseJobFiltersFromSearch(searchParams);
    const canonical = getCanonicalJobListingUrl(filters);
    const incoming = buildIncomingJobListingUrl("/jobs", searchParams);
    if (incoming === canonical) return null;
    return new URL(canonical, origin).toString();
  }

  const segments = pathname.replace(/^\/jobs\/?/, "").split("/").filter(Boolean);
  const parsed = parseSlugWithMeta(segments);
  const filters = {
    ...parsed.filters,
    ...parseJobFiltersFromSearch(searchParams),
  };
  const canonical = getCanonicalJobListingUrl(filters);
  const incoming = buildIncomingJobListingUrl(pathname, searchParams);

  if (incoming === canonical) return null;
  return new URL(canonical, origin).toString();
}

export function resolveJobsListingCanonicalRedirect(req: NextRequest): URL | null {
  const url = req.nextUrl;
  if (!isJobsListingRedirectPath(url.pathname)) return null;

  const sp = searchParamsRecord(url);

  if (url.search.length === 0 && url.pathname !== "/jobs") {
    const segments = url.pathname.replace(/^\/jobs\/?/, "").split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const parsed = parseSlugWithMeta(segments);
    if (parsed.validCanonical) return null;
    const canonicalPath = getCanonicalJobListingUrl(parsed.filters);
    const canonicalPathname = canonicalPath.split("?")[0] ?? "/jobs";
    if (canonicalPathname !== url.pathname) {
      return new URL(canonicalPath, url.origin);
    }
    return null;
  }

  if (url.pathname === "/jobs" && url.search.length === 0) return null;

  const destination = resolveJobsListingCanonicalRedirectUrl(url.origin, url.pathname, sp);
  return destination ? new URL(destination) : null;
}
