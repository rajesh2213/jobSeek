import type { NextRequest } from "next/server";

/** RFC 4122 UUID (any version) — used to detect mistaken `/jobs/{uuid}` paths. */
export const JOB_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobUuidSegment(segment: string): boolean {
  return JOB_UUID_PATTERN.test(segment.trim());
}

/**
 * `/jobs/{uuid}` is a common bad inbound pattern (should be `/job/{uuid}`).
 * Only matches a single path segment so slug hubs like `/jobs/skill/...` are untouched.
 */
export function resolveJobsUuidMispathRedirectUrl(
  origin: string,
  pathname: string,
): string | null {
  if (!pathname.startsWith("/jobs/")) return null;
  const segment = pathname.replace(/^\/jobs\/?/, "").split("/").filter(Boolean)[0];
  if (!segment || pathname.replace(/^\/jobs\/?/, "").includes("/")) return null;
  if (!isJobUuidSegment(segment)) return null;
  return new URL(`/job/${segment}`, origin).toString();
}

/** Strip tracking / unknown query params from job detail canonical URLs. */
export function resolveJobDetailCanonicalRedirectUrl(
  origin: string,
  pathname: string,
  searchParams: Record<string, string>,
): string | null {
  if (!pathname.startsWith("/job/")) return null;
  const id = pathname.replace(/^\/job\/?/, "").split("/").filter(Boolean)[0];
  if (!id) return null;
  if (Object.keys(searchParams).length === 0) return null;
  return new URL(`/job/${id}`, origin).toString();
}

export function resolveJobDetailCanonicalRedirect(req: NextRequest): URL | null {
  const url = req.nextUrl;
  const sp: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (value.length > 0) sp[key] = value;
  });
  const destination = resolveJobDetailCanonicalRedirectUrl(url.origin, url.pathname, sp);
  return destination ? new URL(destination) : null;
}
