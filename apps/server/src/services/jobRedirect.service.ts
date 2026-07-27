/**
 * OG-1.3 — resolve a durable path for a purged job URL.
 * Order: role(+location) hub → category hub → company hub → /jobs.
 */

export type JobRedirectSource = {
  id: string;
  role?: string | null;
  category?: string | null;
  locationCountry?: string | null;
  isRemote?: boolean | null;
  company?: { slug?: string | null } | null;
  companySlug?: string | null;
};

function slugToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function isUsableTaxonomySlug(value: string | null | undefined): value is string {
  if (!value) return false;
  const t = value.trim().toLowerCase();
  return t.length > 0 && t !== "other" && t !== "unknown";
}

export function resolveJobRedirectTargetPath(job: JobRedirectSource): string {
  const role = isUsableTaxonomySlug(job.role) ? slugToken(job.role) : null;
  const category = isUsableTaxonomySlug(job.category) ? slugToken(job.category) : null;
  const countryRaw = job.locationCountry?.trim() ?? "";
  const country =
    countryRaw && countryRaw.toUpperCase() !== "UNKNOWN"
      ? slugToken(countryRaw)
      : null;
  const remote = job.isRemote === true;

  if (role) {
    if (remote) return `/jobs/role/${role}/location/remote`;
    if (country) return `/jobs/role/${role}/location/${country}`;
    return `/jobs/role/${role}`;
  }

  if (category) {
    if (remote) return `/jobs/category/${category}/location/remote`;
    if (country) return `/jobs/category/${category}/location/${country}`;
    return `/jobs/category/${category}`;
  }

  const companySlug =
    job.company?.slug?.trim() || job.companySlug?.trim() || "";
  if (companySlug) return `/company/${companySlug}`;

  return "/jobs";
}

/** Reject open redirects — only allow relative site paths. */
export function isSafeInternalRedirectPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (path.includes("\\")) return false;
  return path.length <= 512;
}
