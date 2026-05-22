import type { JobFilters } from "./slug-parser";

export type SeoPolicyReason =
  | "allow_jobs_root"
  | "allow_jobs_canonical_leaf"
  | "allow_jobs_category_leaf"
  | "allow_jobs_location_leaf"
  | "allow_jobs_skill_leaf"
  | "allow_jobs_experience_leaf"
  | "allow_job_detail"
  | "allow_company_default"
  | "canonicalize_jobs_query_to_slug"
  | "canonicalize_noncanonical_slug"
  | "noindex_pagination"
  | "noindex_deep_refinement"
  | "noindex_experience_refinement"
  | "noindex_disallowed_param"
  | "noindex_company_broken"
  | "exclude_sitemap_noncanonical"
  | "exclude_sitemap_refinement"
  | "exclude_sitemap_pagination"
  | "exclude_sitemap_noindex";

export type SeoPolicyDecision = {
  index: boolean;
  follow: boolean;
  sitemapEligible: boolean;
  canonicalTarget?: string;
  action?: "allow" | "noindex" | "canonicalize" | "redirect";
  reason: SeoPolicyReason;
  policyVersion: "v1";
};

const DEFAULT_JOBS_LIMIT = 20;

const KNOWN_JOB_QUERY_KEYS = new Set([
  "page",
  "limit",
  "offset",
  "role",
  "roles",
  "skills",
  "country",
  "location",
  "locations",
  "category",
  "categories",
  "types",
  "remote",
  "experience",
  "posted",
  "minSalary",
  "companyId",
  "sort",
]);

function allow(reason: SeoPolicyReason): SeoPolicyDecision {
  return {
    index: true,
    follow: true,
    sitemapEligible: true,
    action: "allow",
    reason,
    policyVersion: "v1",
  };
}

function noindex(reason: SeoPolicyReason): SeoPolicyDecision {
  return {
    index: false,
    follow: true,
    sitemapEligible: false,
    action: "noindex",
    reason,
    policyVersion: "v1",
  };
}

function canonicalize(reason: SeoPolicyReason, canonicalTarget: string): SeoPolicyDecision {
  return {
    index: false,
    follow: true,
    sitemapEligible: false,
    canonicalTarget,
    action: "canonicalize",
    reason,
    policyVersion: "v1",
  };
}

export function hasUnknownJobQueryParams(searchParamKeys: string[]): boolean {
  for (const k of searchParamKeys) {
    if (!KNOWN_JOB_QUERY_KEYS.has(k)) return true;
  }
  return false;
}

export function classifyJobRefinement(
  filters: JobFilters,
  searchParamKeys: string[] = [],
): {
  hasPagination: boolean;
  hasDeepRefinement: boolean;
  hasDisallowedParam: boolean;
} {
  const hasPagination = Boolean((filters.page && filters.page > 1) || (filters.offset && filters.offset > 0));
  const multiTokenRefinement = Boolean(
    (filters.roles?.length ?? 0) > 1 ||
      (filters.skills?.length ?? 0) > 1 ||
      (filters.locations?.length ?? 0) > 1 ||
      (filters.categories?.length ?? 0) > 1,
  );
  const hasDisallowedParam = Boolean(
    filters.sort === "salary_desc" ||
      (typeof filters.minSalary === "number" && filters.minSalary > 0) ||
      Boolean(filters.companyId),
  );
  const experienceFromQuery = searchParamKeys.includes("experience");
  const hasDeepRefinement = Boolean(
    multiTokenRefinement ||
      Boolean(filters.posted) ||
      (experienceFromQuery && Boolean(filters.experience)) ||
      (typeof filters.limit === "number" && filters.limit !== DEFAULT_JOBS_LIMIT),
  );
  return { hasPagination, hasDeepRefinement, hasDisallowedParam };
}

export function decideJobsListingSeoPolicy(input: {
  routeKind: "jobs-root" | "jobs-slug";
  filters: JobFilters;
  searchParamKeys: string[];
  canonicalPath: string;
  validCanonicalSlugPath?: boolean;
}): SeoPolicyDecision {
  const { routeKind, filters, searchParamKeys, canonicalPath, validCanonicalSlugPath = true } = input;

  if (hasUnknownJobQueryParams(searchParamKeys)) {
    return noindex("noindex_disallowed_param");
  }

  const { hasPagination, hasDeepRefinement, hasDisallowedParam } = classifyJobRefinement(
    filters,
    searchParamKeys,
  );

  if (routeKind === "jobs-root") {
    const hasQuery = searchParamKeys.length > 0;
    if (!hasQuery) return allow("allow_jobs_root");
    return canonicalize("canonicalize_jobs_query_to_slug", canonicalPath);
  }

  if (!validCanonicalSlugPath) {
    return canonicalize("canonicalize_noncanonical_slug", canonicalPath);
  }
  if (hasPagination) return noindex("noindex_pagination");
  if (hasDisallowedParam) return noindex("noindex_disallowed_param");
  if (hasDeepRefinement) {
    if (isExperienceOnlyRefinement(filters)) {
      return noindex("noindex_experience_refinement");
    }
    return noindex("noindex_deep_refinement");
  }
  return allow(classifyCanonicalLeaf(filters));
}

/**
 * True when the only "deep refinement" trigger is the experience filter.
 * Used for monitoring: distinguishes experience-slug noindex from other refinement noindex.
 */
function isExperienceOnlyRefinement(filters: JobFilters): boolean {
  if (!filters.experience) return false;
  const multiToken = Boolean(
    (filters.roles?.length ?? 0) > 1 ||
      (filters.skills?.length ?? 0) > 1 ||
      (filters.locations?.length ?? 0) > 1 ||
      (filters.categories?.length ?? 0) > 1,
  );
  if (multiToken) return false;
  if (filters.posted) return false;
  if (typeof filters.limit === "number" && filters.limit !== 20) return false;
  return true;
}

/**
 * Finer-grained monitoring reason for canonical leaf pages.
 * Does NOT change index/follow/sitemap behavior — only the `reason` field
 * so telemetry can distinguish category hubs from role hubs from location hubs.
 */
function classifyCanonicalLeaf(filters: JobFilters): SeoPolicyReason {
  const hasRole = Boolean(filters.role?.trim());
  const hasCategory = Boolean(filters.category?.trim());
  const hasSkill = (filters.skills?.length ?? 0) > 0;
  const hasLocation =
    Boolean(filters.country?.trim()) ||
    Boolean(filters.location?.trim()) ||
    filters.isRemote === true ||
    filters.workType === "remote";
  const hasExperience = Boolean(filters.experience);

  if (hasCategory && !hasRole && !hasSkill && !hasLocation && !hasExperience) {
    return "allow_jobs_category_leaf";
  }
  if (hasLocation && !hasRole && !hasCategory && !hasSkill && !hasExperience) {
    return "allow_jobs_location_leaf";
  }
  if (hasSkill && !hasRole && !hasCategory && !hasLocation && !hasExperience) {
    return "allow_jobs_skill_leaf";
  }
  if (hasExperience && !hasLocation && !hasRole && !hasCategory && !hasSkill) {
    return "allow_jobs_experience_leaf";
  }
  return "allow_jobs_canonical_leaf";
}

export function decideCompanySeoPolicy(input: {
  gateEnabled: boolean;
  company: { id?: string | null; name?: string | null; slug?: string | null } | null;
  requestedSlug: string;
}): SeoPolicyDecision {
  if (!input.company) return noindex("noindex_company_broken");
  if (!input.gateEnabled) return allow("allow_company_default");

  const id = input.company.id?.trim() ?? "";
  const name = input.company.name?.trim() ?? "";
  const slug = input.company.slug?.trim() ?? "";
  if (!id || !name || !slug) return noindex("noindex_company_broken");
  if (slug !== input.requestedSlug) return noindex("noindex_company_broken");
  return allow("allow_company_default");
}

export function decideJobDetailSeoPolicy(): SeoPolicyDecision {
  return allow("allow_job_detail");
}

export function isSitemapEligibleJobsPath(input: {
  validCanonicalSlugPath: boolean;
  filters: JobFilters;
}): SeoPolicyDecision {
  if (!input.validCanonicalSlugPath) return noindex("exclude_sitemap_noncanonical");
  const { hasPagination, hasDeepRefinement, hasDisallowedParam } = classifyJobRefinement(input.filters);
  if (hasPagination) return noindex("exclude_sitemap_pagination");
  if (hasDisallowedParam || hasDeepRefinement) return noindex("exclude_sitemap_refinement");
  return allow(classifyCanonicalLeaf(input.filters));
}

