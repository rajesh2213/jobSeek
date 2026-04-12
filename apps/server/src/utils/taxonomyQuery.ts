import { tryResolveCountryInput } from "../config/countries.js";
import { isKnownSkillSlug, isValidJobCategory } from "../config/taxonomy.js";
import type { JobDiscoveryFilters } from "../modules/job/job.repository.js";

function parseBool(v: unknown): boolean | undefined {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return undefined;
}

function parseIntSafe(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

/** Allow known skill slugs or generic hyphenated slugs for forward compatibility. */
function isValidSkillFilterToken(s: string): boolean {
  return isKnownSkillSlug(s) || /^[a-z0-9][a-z0-9-]*$/.test(s);
}

/** Free-form role slug from job titles (slugified). */
function isValidRoleSlug(s: string): boolean {
  return s.length > 0 && s.length <= 160 && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

const WORK_TYPES = new Set(["remote", "onsite", "hybrid"]);
const EXPERIENCE_LEVELS = new Set(["junior", "mid", "senior"]);
const POSTED_WINDOWS = new Set(["24h", "3d", "1w", "1m"]);

/**
 * Parse GET /jobs query into validated taxonomy filters (invalid tokens dropped).
 */
export function parseJobDiscoveryQuery(query: Record<string, unknown>): JobDiscoveryFilters {
  const filters: JobDiscoveryFilters = {};

  const role = query.role;
  if (typeof role === "string" && isValidRoleSlug(role)) {
    filters.role = role;
    filters.roleTerms = [role.replace(/-/g, " ")];
  }
  const rolesRaw = query.roles;
  if (typeof rolesRaw === "string" && rolesRaw.trim() !== "") {
    const roles = rolesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => isValidRoleSlug(s));
    if (roles.length > 0) {
      filters.roles = Array.from(new Set(roles));
      filters.roleTerms = filters.roles.map((r) => r.replace(/-/g, " "));
    }
  }

  const locationsParam = query.locations;
  if (typeof locationsParam === "string" && locationsParam.trim().length > 0) {
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const s of locationsParam.split(",")) {
      const t = s.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      tokens.push(t);
    }
    if (tokens.length > 0) {
      filters.locationTokens = tokens;
    }
  }

  const location = query.location;
  if (
    typeof location === "string" &&
    location.trim().length > 0 &&
    !filters.locationTokens?.length
  ) {
    filters.location = location.trim();
  }

  const country = query.country;
  if (
    typeof country === "string" &&
    country.trim().length > 0 &&
    !filters.locationTokens?.length
  ) {
    const t = country.trim();
    if (t.toUpperCase() === "UNKNOWN") {
      filters.country = "UNKNOWN";
    } else {
      const code = tryResolveCountryInput(t);
      if (code) filters.country = code;
    }
  }

  const category = query.category;
  if (typeof category === "string" && category.length > 0 && isValidJobCategory(category)) {
    filters.category = category;
  }

  const types = query.types;
  if (typeof types === "string" && types.trim().length > 0) {
    const parsed = types
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => WORK_TYPES.has(s)) as Array<"remote" | "onsite" | "hybrid">;
    if (parsed.length > 0) {
      filters.workTypes = Array.from(new Set(parsed));
    }
  }

  const remote = parseBool(query.remote);
  if (remote === true && !filters.workTypes?.length) {
    filters.workType = "remote";
  }
  if (remote === true) filters.isRemote = true;

  const experience = query.experience;
  if (typeof experience === "string" && EXPERIENCE_LEVELS.has(experience)) {
    filters.experienceLevel = experience as JobDiscoveryFilters["experienceLevel"];
  }

  const posted = query.posted;
  if (typeof posted === "string" && POSTED_WINDOWS.has(posted)) {
    filters.postedWithin = posted as JobDiscoveryFilters["postedWithin"];
  }

  const minSalary = parseIntSafe(query.minSalary);
  if (minSalary !== undefined && minSalary >= 0) filters.minSalary = minSalary;

  const companyId = query.companyId;
  if (typeof companyId === "string" && companyId.length > 0) {
    filters.companyId = companyId;
  }

  const skillsRaw = query.skills;
  if (typeof skillsRaw === "string" && skillsRaw.trim() !== "") {
    const skills = skillsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && isValidSkillFilterToken(s));
    if (skills.length > 0) filters.skills = skills;
  }

  return filters;
}
