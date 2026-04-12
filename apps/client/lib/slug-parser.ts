import { JOB_CATEGORIES, KNOWN_SKILL_SLUGS } from "./taxonomy";

export interface JobFilters {
  page?: number;
  limit?: number;
  offset?: number;
  role?: string;
  roles?: string[];
  skills?: string[];
  /** Sent to API as `country` (free text or ISO code; server resolves). */
  country?: string;
  /** Single token — sent as `?location=` when `locations` is unset (legacy / short URLs). */
  location?: string;
  /** Multiple tokens — sent as `?locations=` (comma-separated); OR semantics on the server. */
  locations?: string[];
  category?: string;
  /** Legacy SEO slug segment; prefer `workType`. */
  isRemote?: boolean;
  workType?: "remote" | "onsite" | "hybrid";
  workTypes?: Array<"remote" | "onsite" | "hybrid">;
  experience?: "junior" | "mid" | "senior";
  posted?: "24h" | "3d" | "1w" | "1m";
  minSalary?: number;
  companyId?: string;
  /** API: `sort=latest` (default) or `sort=salary_desc` (also accepts legacy `salary`). */
  sort?: "latest" | "salary_desc";
}

function longestMatchFromStart(
  slug: string,
  candidates: readonly string[],
): { match: string; rest: string } | null {
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (slug === c) return { match: c, rest: "" };
    if (slug.startsWith(`${c}-`)) return { match: c, rest: slug.slice(c.length + 1) };
  }
  return null;
}

export function parseJobFiltersFromSearch(
  sp: Record<string, string | string[] | undefined>,
): JobFilters {
  const g = (k: string): string | undefined => {
    const v = sp[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return undefined;
  };

  const filters: JobFilters = {};

  const category = g("category");
  if (category) filters.category = category;

  const locationsRaw = g("locations");
  if (locationsRaw?.trim()) {
    const seen = new Set<string>();
    const locations: string[] = [];
    for (const s of locationsRaw.split(",")) {
      const t = s.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      locations.push(t);
    }
    if (locations.length > 0) {
      filters.locations = locations;
    }
  }

  const locationParam = g("location");
  if (locationParam?.trim() && !filters.locations?.length) {
    filters.location = locationParam.trim();
  }

  const country = g("country");
  if (country?.trim() && !filters.locations?.length && !filters.location) {
    const t = country.trim();
    filters.country = t.length === 2 ? t.toUpperCase() : t;
  }

  const role = g("role");
  if (role) filters.role = role;
  const rolesRaw = g("roles");
  if (rolesRaw?.trim()) {
    const roles = rolesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (roles.length > 0) {
      filters.roles = roles;
      if (!filters.role) filters.role = roles[0];
    }
  }

  const skillsRaw = g("skills");
  if (skillsRaw) {
    const skills = skillsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (skills.length > 0) filters.skills = skills;
  }

  const typesRaw = g("types");
  if (typesRaw?.trim()) {
    const workTypes = typesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is "remote" | "onsite" | "hybrid" => s === "remote" || s === "onsite" || s === "hybrid");
    if (workTypes.length > 0) {
      filters.workTypes = Array.from(new Set(workTypes));
    }
  }

  const remote = g("remote");
  if (remote === "true" || remote === "1") {
    filters.isRemote = true;
    if (!filters.workTypes?.length) filters.workType = "remote";
  }
  if (remote === "false" || remote === "0") filters.isRemote = false;

  const experience = g("experience");
  if (experience === "junior" || experience === "mid" || experience === "senior") {
    filters.experience = experience;
  }

  const posted = g("posted");
  if (posted === "24h" || posted === "3d" || posted === "1w" || posted === "1m") {
    filters.posted = posted;
  }

  const minSalary = g("minSalary");
  if (minSalary) {
    const n = parseInt(minSalary, 10);
    if (!Number.isNaN(n)) filters.minSalary = n;
  }

  const companyId = g("companyId");
  if (companyId) filters.companyId = companyId;

  const page = g("page");
  if (page) {
    const n = parseInt(page, 10);
    if (!Number.isNaN(n) && n >= 1) filters.page = n;
  }
  const limit = g("limit");
  if (limit) {
    const n = parseInt(limit, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 100) filters.limit = n;
  }
  const offset = g("offset");
  if (offset) {
    const n = parseInt(offset, 10);
    if (!Number.isNaN(n) && n >= 0) filters.offset = n;
  }

  const sort = g("sort");
  if (sort === "salary_desc" || sort === "salary") filters.sort = "salary_desc";

  return filters;
}

export function filtersToSearchParams(filters: JobFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.page) p.set("page", String(filters.page));
  if (filters.limit) p.set("limit", String(filters.limit));
  if (filters.offset !== undefined) p.set("offset", String(filters.offset));
  if (filters.category) p.set("category", filters.category);
  if (filters.role) p.set("role", filters.role);
  if (filters.roles?.length) p.set("roles", filters.roles.join(","));
  if (filters.skills?.length) p.set("skills", filters.skills.join(","));
  if (filters.locations?.length) {
    p.set("locations", filters.locations.join(","));
  } else if (filters.location?.trim()) {
    p.set("location", filters.location.trim());
  } else if (filters.country?.trim()) {
    p.set("country", filters.country.trim());
  }
  if (filters.workTypes?.length) p.set("types", filters.workTypes.map((t) => t.toUpperCase()).join(","));
  if (filters.isRemote === true && !filters.workTypes?.length) p.set("remote", "true");
  if (filters.experience) p.set("experience", filters.experience);
  if (filters.posted) p.set("posted", filters.posted);
  if (filters.minSalary !== undefined && filters.minSalary > 0) {
    p.set("minSalary", String(filters.minSalary));
  }
  if (filters.companyId) p.set("companyId", filters.companyId);
  if (filters.sort === "salary_desc") p.set("sort", "salary_desc");
  return p;
}

/** True when URL would carry any filter besides pagination (`page` / `limit` / `offset`). */
export function hasActiveJobFilters(f: JobFilters): boolean {
  const p = filtersToSearchParams({
    ...f,
    page: undefined,
    limit: undefined,
    offset: undefined,
  });
  return p.toString().length > 0;
}

export function parseSlug(slug: string[]): JobFilters {
  let joined = slug
    .flatMap((segment) => segment.split("-"))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .join("-");

  let isRemote = false;
  if (joined.endsWith("-remote")) {
    isRemote = true;
    joined = joined.slice(0, -"-remote".length);
  }

  if (!joined) {
    return { isRemote: isRemote || undefined, workType: isRemote ? "remote" : undefined };
  }

  const segments = joined.split("-").filter(Boolean);
  let work = joined;
  let country: string | undefined;

  if (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    if (/^[a-z]{2}$/.test(last)) {
      country = last.toUpperCase();
      work = segments.slice(0, -1).join("-");
    }
  }

  const catMatch = longestMatchFromStart(work, JOB_CATEGORIES);
  if (!catMatch) {
    return {
      country,
      isRemote: isRemote || undefined,
      workType: isRemote ? "remote" : undefined,
    };
  }

  const rest = catMatch.rest;
  const category = catMatch.match;

  const tokens = rest ? rest.split("-").filter(Boolean) : [];
  const skillSet = new Set<string>([...KNOWN_SKILL_SLUGS]);
  const skills: string[] = [];
  const roleParts: string[] = [];
  for (const t of tokens) {
    if (skillSet.has(t)) skills.push(t);
    else roleParts.push(t);
  }
  const role = roleParts.length > 0 ? roleParts.join("-") : undefined;

  return {
    category,
    role,
    skills: skills.length > 0 ? skills : undefined,
    country,
    isRemote: isRemote || undefined,
    workType: isRemote ? "remote" : undefined,
  };
}

export function filtersToSlug(
  filters: Pick<JobFilters, "role" | "skills" | "country" | "category" | "isRemote" | "workType">,
): string {
  const parts: string[] = [];
  if (filters.category) parts.push(filters.category);
  if (filters.role) parts.push(...filters.role.split("-").filter(Boolean));
  if (filters.skills?.length) parts.push(...[...filters.skills].sort());
  if (filters.country) parts.push(filters.country.toLowerCase());
  if (filters.workType === "remote" || filters.isRemote) parts.push("remote");
  return parts.join("-");
}

export function buildJobsListingUrl(filters: JobFilters): string {
  const qs = filtersToSearchParams(filters).toString();
  const slug = filtersToSlug({
    category: filters.category,
    role: filters.role,
    skills: filters.skills,
    country: filters.country,
    isRemote: filters.isRemote,
    workType: filters.workType,
  });
  if (slug) {
    return qs ? `/jobs/${slug}?${qs}` : `/jobs/${slug}`;
  }
  return qs ? `/jobs?${qs}` : "/jobs";
}
