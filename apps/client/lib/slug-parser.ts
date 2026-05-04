import { JOB_CATEGORIES, KNOWN_SKILL_SLUGS } from "./taxonomy";

/** Guardrails so malicious/huge query strings cannot OOM the Next dev server or RSC cache. */
export const MAX_JOB_FILTER_QUERY_VALUE_LEN = 4096;
export const MAX_JOB_FILTER_QUERY_TOKENS = 48;

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
  /** Multi-select categories (API: `categories=a,b`). */
  categories?: string[];
  /** API-only (not shown in URLs): `surface=seo` for programmatic SEO routes. */
  surface?: "browse" | "seo";
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

const CANONICAL_SLUG_KEYS = new Set([
  "role",
  "category",
  "skill",
  "location",
  "work-type",
  "experience",
]);

function toSlugToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function fromExperienceSlug(v: string): JobFilters["experience"] | undefined {
  if (v === "0-2-years") return "junior";
  if (v === "3-5-years") return "mid";
  if (v === "6-plus-years") return "senior";
  return undefined;
}

function toExperienceSlug(v: JobFilters["experience"]): string | null {
  if (v === "junior") return "0-2-years";
  if (v === "mid") return "3-5-years";
  if (v === "senior") return "6-plus-years";
  return null;
}

export function parseJobFiltersFromSearch(
  sp: Record<string, string | string[] | undefined>,
): JobFilters {
  const g = (k: string): string | undefined => {
    const v = sp[k];
    let raw: string | undefined;
    if (typeof v === "string") raw = v;
    else if (Array.isArray(v) && typeof v[0] === "string") raw = v[0];
    if (!raw) return undefined;
    if (raw.length > MAX_JOB_FILTER_QUERY_VALUE_LEN) {
      return raw.slice(0, MAX_JOB_FILTER_QUERY_VALUE_LEN);
    }
    return raw;
  };

  const filters: JobFilters = {};

  const categoriesRaw = g("categories");
  if (categoriesRaw?.trim()) {
    const allowed = new Set(JOB_CATEGORIES);
    const cats = categoriesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => allowed.has(s as (typeof JOB_CATEGORIES)[number]));
    if (cats.length > 0) {
      filters.categories = Array.from(new Set(cats)).slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
    }
  }

  const category = g("category");
  if (category && !filters.categories?.length) {
    filters.category = category.slice(0, 160);
  }

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
      filters.locations = locations.slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
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
  if (role) filters.role = role.slice(0, 160);
  const rolesRaw = g("roles");
  if (rolesRaw?.trim()) {
    const roles = rolesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (roles.length > 0) {
      const r = roles.slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
      filters.roles = r;
      if (!filters.role) filters.role = r[0];
    }
  }

  const skillsRaw = g("skills");
  if (skillsRaw) {
    const skills = skillsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
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
  if (companyId) filters.companyId = companyId.slice(0, 80);

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
  if (filters.categories?.length) {
    p.set("categories", filters.categories.join(","));
  } else if (filters.category) {
    p.set("category", filters.category);
  }
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

/** Query string for `/company/[slug]` (no `companyId`; company is implied by the path). */
export function filtersToCompanyHubSearchParams(
  filters: Omit<JobFilters, "companyId">,
): URLSearchParams {
  return filtersToSearchParams({ ...filters, companyId: undefined });
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

function parseCanonicalSlug(slug: string[]): JobFilters | null {
  if (slug.length === 0) return {};
  if (slug.length % 2 !== 0) return null;
  const filters: JobFilters = {};
  for (let i = 0; i < slug.length; i += 2) {
    const key = slug[i]?.trim().toLowerCase() ?? "";
    const value = slug[i + 1]?.trim() ?? "";
    if (!key || !value || !CANONICAL_SLUG_KEYS.has(key)) return null;
    switch (key) {
      case "role": {
        const role = toSlugToken(value);
        if (!role) return null;
        filters.role = role;
        filters.roles = [role];
        break;
      }
      case "category": {
        const category = toSlugToken(value);
        if (!JOB_CATEGORIES.includes(category as (typeof JOB_CATEGORIES)[number])) return null;
        filters.category = category;
        break;
      }
      case "skill": {
        const skill = toSlugToken(value);
        if (!skill) return null;
        filters.skills = [skill];
        break;
      }
      case "location": {
        const token = value.trim();
        if (!token) return null;
        if (token.toLowerCase() === "remote") {
          filters.workType = "remote";
          filters.workTypes = ["remote"];
          filters.isRemote = true;
          break;
        }
        if (/^[a-z]{2}$/i.test(token)) {
          filters.country = token.toUpperCase();
        } else {
          filters.location = token.replace(/-/g, " ");
          filters.locations = [filters.location];
        }
        break;
      }
      case "work-type": {
        const wt = value.trim().toLowerCase();
        if (wt !== "remote" && wt !== "onsite" && wt !== "hybrid") return null;
        filters.workType = wt;
        filters.workTypes = [wt];
        if (wt === "remote") filters.isRemote = true;
        break;
      }
      case "experience": {
        const exp = fromExperienceSlug(value.trim().toLowerCase());
        if (!exp) return null;
        filters.experience = exp;
        break;
      }
      default:
        return null;
    }
  }
  return filters;
}

function parseLegacySlug(slug: string[]): JobFilters {
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
  let country: string | undefined;
  if (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    if (/^[a-z]{2}$/.test(last)) {
      country = last.toUpperCase();
      joined = segments.slice(0, -1).join("-");
    }
  }
  const category = JOB_CATEGORIES
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((c) => joined === c || joined.startsWith(`${c}-`));
  if (!category) {
    return {
      country,
      isRemote: isRemote || undefined,
      workType: isRemote ? "remote" : undefined,
    };
  }
  const rest = joined === category ? "" : joined.slice(category.length + 1);
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

export function parseSlugWithMeta(slug: string[]): {
  filters: JobFilters;
  validCanonical: boolean;
} {
  const canonical = parseCanonicalSlug(slug);
  if (canonical) {
    return { filters: canonical, validCanonical: true };
  }
  return { filters: parseLegacySlug(slug), validCanonical: false };
}

export function parseSlug(slug: string[]): JobFilters {
  return parseSlugWithMeta(slug).filters;
}

export function filtersToSlug(
  filters: Pick<
    JobFilters,
    "role" | "skills" | "country" | "category" | "isRemote" | "workType" | "location" | "experience"
  >,
): string {
  const segments: string[] = [];
  const role = filters.role ? toSlugToken(filters.role) : "";
  if (role) segments.push("role", role);
  const category = filters.category ? toSlugToken(filters.category) : "";
  if (category) segments.push("category", category);
  const skill = filters.skills?.[0] ? toSlugToken(filters.skills[0]) : "";
  if (skill) segments.push("skill", skill);
  if (filters.country?.trim()) {
    segments.push("location", filters.country.trim().toLowerCase());
  } else if (filters.location?.trim()) {
    segments.push("location", toSlugToken(filters.location));
  } else if (filters.workType === "remote" || filters.isRemote) {
    segments.push("location", "remote");
  }
  if (filters.workType && filters.workType !== "remote") {
    segments.push("work-type", filters.workType);
  }
  const experience = toExperienceSlug(filters.experience);
  if (experience) {
    segments.push("experience", experience);
  }
  return segments.join("/");
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
    experience: filters.experience,
  });
  if (slug) {
    return qs ? `/jobs/${slug}?${qs}` : `/jobs/${slug}`;
  }
  return qs ? `/jobs?${qs}` : "/jobs";
}

const DEFAULT_LISTING_LIMIT = 20;

/**
 * Canonical job listing URL: path slug for slottable facets; query only for refinements
 * (pagination, experience, posted, salary, sort, multi-location, multi-type, etc.).
 */
export function getCanonicalJobListingUrl(filters: JobFilters): string {
  const slug = filtersToSlug({
    category: filters.category,
    role: filters.role,
    skills: filters.skills,
    country: filters.country,
    isRemote: filters.isRemote,
    workType: filters.workType,
    experience: filters.experience,
  });

  if (!slug) {
    const qs = filtersToSearchParams(filters).toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  }

  const p = new URLSearchParams();
  if (filters.page && filters.page > 1) p.set("page", String(filters.page));
  if (filters.limit && filters.limit !== DEFAULT_LISTING_LIMIT) {
    p.set("limit", String(filters.limit));
  }
  if (filters.offset !== undefined && filters.offset > 0) {
    p.set("offset", String(filters.offset));
  }
  if (filters.experience) p.set("experience", filters.experience);
  if (filters.posted) p.set("posted", filters.posted);
  if (filters.minSalary !== undefined && filters.minSalary > 0) {
    p.set("minSalary", String(filters.minSalary));
  }
  if (filters.sort === "salary_desc") p.set("sort", "salary_desc");
  if (filters.locations?.length) {
    p.set("locations", filters.locations.join(","));
  } else if (filters.location?.trim()) {
    // Single location token is represented in canonical slug path.
  }
  if (filters.workTypes?.length) {
    p.set("types", filters.workTypes.map((t) => t.toUpperCase()).join(","));
  }
  if (filters.roles && filters.roles.length > 1) {
    p.set("roles", filters.roles.join(","));
  }
  if (filters.skills && filters.skills.length > 1) {
    p.set("skills", filters.skills.join(","));
  }
  if (filters.categories?.length) {
    p.set("categories", filters.categories.join(","));
  }
  if (filters.companyId) p.set("companyId", filters.companyId);

  const qs = p.toString();
  return qs ? `/jobs/${slug}?${qs}` : `/jobs/${slug}`;
}

export function canonicalizeSlugPath(slug: string[]): string {
  const parsed = parseSlug(slug);
  const canonical = getCanonicalJobListingUrl(parsed);
  return canonical.split("?")[0] ?? "/jobs";
}

export function normalizeRelatedSlugPath(slug: string): string {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return "/jobs";
  const withoutJobs = clean.startsWith("jobs/") ? clean.slice(5) : clean;
  return canonicalizeSlugPath(withoutJobs.split("/").filter(Boolean));
}

export function isCanonicalListingPath(path: string): boolean {
  const clean = path.trim();
  if (!clean.startsWith("/jobs")) return false;
  const rest = clean.replace(/^\/jobs\/?/, "");
  if (!rest) return true;
  const segments = rest.split("/").filter(Boolean);
  const parsed = parseSlugWithMeta(segments);
  if (!parsed.validCanonical) return false;
  return canonicalizeSlugPath(segments) === `/jobs/${segments.join("/")}`;
}
