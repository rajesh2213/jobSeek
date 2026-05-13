import { SKILL_ALIAS_MAP, type JobCategory } from "../config/taxonomy.js";
import {
  resolveLocation,
  type ResolvedLocation,
} from "./locationResolver.js";

export type { ResolvedLocation };

/** Junk ATS / nav titles — force `other` for taxonomy; use for dedup/cleanup pipelines. */
export const JUNK_TITLE_RE =
  /^(job\s*role|careers?|jobs?|all|benefits?|culture|locations?|open\s*roles?|career\s*(search|areas?)|searchcareer|teams?|life\s*at\b)/i;

export function isJunkJobTitle(title: string): boolean {
  return JUNK_TITLE_RE.test(title.trim());
}

/** Slugify free text (titles → role slug). */
function slugifyToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Keyword-based industry category (title-only). Order matters: first match wins.
 * Infrastructure / security / product etc. are checked before generic engineering.
 */
export function normalizeCategory(title: string): string {
  const trimmed = title.trim();
  if (isJunkJobTitle(trimmed)) return "other";

  const t = trimmed.toLowerCase();
  const rules: Array<{ cat: JobCategory; re: RegExp }> = [
    {
      cat: "product",
      re: /\b(product\s*manager|product\s*owner|product\s*lead|product\s*director|head\s*of\s*product|vp\s*product|chief\s*product|pm)\b/i,
    },
    {
      cat: "data",
      re: /\b(data\s*scientist|data\s*engineer|data\s*analyst|analytics|machine\s*learning|ml\s*engineer|ai\s*engineer|research\s*scientist|\bllm\b|mlops|data\s*architect)\b/i,
    },
    {
      cat: "management",
      re: /\b(chief|cto|ceo|coo|cfo|vp\s*of|vice\s*president|director\s*of|head\s*of|general\s+manager|\bsvp\b|\bevp\b|managing\s*director)\b/i,
    },
    {
      cat: "security",
      re: /\b(security\s*engineer|cybersecurity|infosec|penetration|soc\s*analyst|security\s*analyst|devsecops|appsec|cloudsec)\b/i,
    },
    {
      cat: "infrastructure",
      re: /\b(devops|platform\s*engineer|site\s*reliability|\bsre\b|cloud\s*engineer|infrastructure|kubernetes|network\s*engineer)\b/i,
    },
    {
      cat: "research",
      re: /\b(researcher|research\s*engineer|scientist|phd\s*intern|postdoc)\b/i,
    },
    {
      cat: "content",
      re: /\b(writer|editor|content\s*creator|copywriter|technical\s*writer|journalist|blogger|content\s*strategist)\b/i,
    },
    {
      cat: "engineering",
      re: /\b(engineer|engineering|developer|programmer|software|technician)\b/i,
    },
    { cat: "sales", re: /\b(sales|account executive|business development|\bbd\b)\b/i },
    { cat: "marketing", re: /\b(marketing|growth|seo|brand)\b/i },
    { cat: "design", re: /\b(designer|design|ux|ui)\b/i },
    { cat: "finance", re: /\b(finance|accounting|controller|treasury|fp&a)\b/i },
    { cat: "operations", re: /\b(operations|logistics|supply chain|procurement)\b/i },
    { cat: "customer-support", re: /\b(support|customer success|help desk)\b/i },
    { cat: "hr", re: /\b(hr|human resources|recruiter|talent|people)\b/i },
    { cat: "healthcare", re: /\b(nurse|physician|doctor|clinical|healthcare|medical)\b/i },
    { cat: "education", re: /\b(teacher|professor|education|curriculum)\b/i },
    { cat: "legal", re: /\b(legal|counsel|attorney|paralegal|compliance)\b/i },
  ];
  for (const { cat, re } of rules) {
    if (re.test(t)) return cat;
  }
  return "other";
}

/**
 * Role = slugified job title (deterministic, no fixed role enum).
 */
export function normalizeRole(title: string): string {
  const s = slugifyToken(title);
  return (s || "job").slice(0, 120);
}

/**
 * Generic skill extraction via SKILL_ALIAS_MAP (substring match, longest aliases first).
 */
export function normalizeSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  const entries = Object.entries(SKILL_ALIAS_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, canonical] of entries) {
    if (lower.includes(alias.toLowerCase())) found.add(canonical);
  }
  return Array.from(found).sort();
}

/**
 * Resolve raw ATS location text → structured location (backend authority).
 */
export function normalizeLocation(rawLocation: string): ResolvedLocation {
  return resolveLocation(rawLocation || "");
}

const JUNIOR_RE =
  /\b(intern(?:ship)?|junior|entry[\s-]?level|new\s*grad(?:uate)?|trainee|apprentice|co[\s-]?op)\b/i;

const SENIOR_RE =
  /\b(senior|staff|principal|distinguished|fellow|(?:lead|head\s+of|director|vp|vice\s*president|chief)\b)/i;

/**
 * Infer experience level from job title keywords.
 * Only returns "junior" or "senior" when there is a clear signal;
 * ambiguous or mid-level titles return null.
 */
export function deriveExperienceLevel(title: string): "junior" | "senior" | null {
  const t = title.trim();
  if (!t) return null;

  const isJunior = JUNIOR_RE.test(t);
  const isSenior = SENIOR_RE.test(t);

  if (isJunior && isSenior) return null;
  if (isJunior) return "junior";
  if (isSenior) return "senior";
  return null;
}

const HYBRID_RE = /\bhybrid\b/i;

/**
 * Detect "hybrid" work type from combined title + description + location text.
 * Returns "hybrid" only when there is an explicit signal; otherwise null
 * (caller falls back to isRemote-based remote/onsite).
 */
export function deriveWorkType(
  title: string,
  description?: string,
  location?: string,
): "hybrid" | null {
  const blob = `${title}\n${description ?? ""}\n${location ?? ""}`;
  return HYBRID_RE.test(blob) ? "hybrid" : null;
}

/**
 * Business-metric terms that appear right after a `$NNNk` token.
 * Matches are non-salary: ACV, ARR, quota, budget, deal size, etc.
 * Allows optional `+`, `–`, or whitespace between the amount and the keyword.
 */
const NON_SALARY_AFTER_RE = new RegExp(
  [
    String.raw`^\s*\+?\s*[-–—]?\s*(?:`,
    // Metric acronyms
    String.raw`acv|arr|mrr|gmv|tcv|aov|aum|ltv|cltv|nrr`,
    // Direct business terms
    String.raw`|revenue|quotas?|targets?|budgets?|deals?(?:\s+sizes?)?`,
    String.raw`|spend(?:ing)?|gifts?|donations?|pipelines?|bookings?`,
    String.raw`|capital|endowments?|expenses?|portfolios?|loans?|mortgages?`,
    String.raw`|financ(?:ing|ed?)`,
    // Multi-word business phrases
    String.raw`|(?:assets?\s+)?under\s+management`,
    String.raw`|contracts?\s*(?:values?|sizes?)`,
    String.raw`|projects?\s*(?:costs?|values?|sizes?)`,
    String.raw`|major\s+gifts?|planned\s+giv`,
    String.raw`|(?:sales|annual|yearly|monthly)\s+(?:quotas?|targets?|pipelines?|bookings?|revenue)`,
    String.raw`|(?:total|gross|net)\s+(?:revenue|spend)`,
    String.raw`|per\s+(?:deals?|contracts?|projects?|transactions?)`,
    String.raw`|worth\s+of`,
    String.raw`)\b`,
  ].join(""),
  "i",
);

/**
 * "$NNNk to $NNNM/B" — a range spanning orders of magnitude is always
 * a deal / project / fund size, never a salary.
 */
const LARGE_RANGE_AFTER_RE = /^\s*\+?\s*(?:to|-|–|—)\s*\$\s*[\d,.]+\s*[mb]\b/i;

/**
 * Sales / fundraising verbs immediately before a dollar amount signal
 * that the number is a deal size or raise amount, not compensation.
 */
const NON_SALARY_BEFORE_RE =
  /(?:clos(?:e[sd]?|ing)|sold|sell(?:ing)?|rais(?:e[sd]?|ing))\s*$/i;

export function extractSalaryMinUsd(description: string): number | null {
  const pattern = /\$\s*(\d{1,3})\s*k\b/gi;
  let match;
  while ((match = pattern.exec(description)) !== null) {
    const value = parseInt(match[1]!, 10) * 1000;
    if (value < 10_000) continue;

    const end = match.index + match[0].length;
    const afterSlice = description.slice(end, end + 80);
    if (NON_SALARY_AFTER_RE.test(afterSlice)) continue;
    if (LARGE_RANGE_AFTER_RE.test(afterSlice)) continue;

    const beforeSlice = description.slice(
      Math.max(0, match.index - 100),
      match.index,
    );
    if (NON_SALARY_BEFORE_RE.test(beforeSlice)) continue;

    return value;
  }
  return null;
}

/** True when there is no usable ISO country (null, empty, whitespace, or UNKNOWN). */
function isMissingLocation(value?: string | null): boolean {
  const t = value?.trim();
  return !t || t === "UNKNOWN";
}

function isMultiLocation(text?: string): boolean {
  if (!text) return false;
  return /[;|]/.test(text);
}

export function splitLocations(text: string): string[] {
  return text
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Remote job ads often restrict hiring to a region; do not label those as worldwide. */
function hasRegionRestriction(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(us|usa|uk)\b/i.test(t)) return true;
  if (/\b(united states|united kingdom)\b/i.test(t)) return true;
  if (/\b(europe|emea|india|canada)\b/i.test(t)) return true;
  return false;
}

/** Multi-office lines (e.g. Ashby primary + secondary joined with "; ") — resolve structured fields from the first site only. */
function primaryLocationLineForResolution(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const first = t.split(";")[0]?.trim() ?? t;
  return first;
}

function locationInputWithRemoteHint(part: string, isRemote: boolean): string {
  return `${part} ${isRemote ? "remote" : ""}`.trim();
}

export function normalizeJobAttributes(job: {
  title: string;
  description?: string;
  location?: string;
  isRemote: boolean;
}): {
  category: string;
  role: string;
  skills: string[];
  country: string;
  isRemote: boolean;
  city: string | null;
  state: string | null;
  region: string | null;
  hasMultipleLocations?: boolean;
} {
  const blob = `${job.title}\n${job.description ?? ""}`;

  if (isMultiLocation(job.location) && job.location?.trim()) {
    const parts = splitLocations(job.location!);
    if (parts.length === 0) {
      // e.g. only separators — fall through to single-line resolution
    } else {
    const orderedDistinct: string[] = [];
    const seen = new Set<string>();
    let mergedRemote = job.isRemote;
    for (const part of parts) {
      const locPart = normalizeLocation(locationInputWithRemoteHint(part, job.isRemote));
      mergedRemote = mergedRemote || locPart.isRemote;
      if (!isMissingLocation(locPart.country) && !seen.has(locPart.country)) {
        seen.add(locPart.country);
        orderedDistinct.push(locPart.country);
      }
    }
    const primary = normalizeLocation(
      locationInputWithRemoteHint(parts[0] ?? "", job.isRemote),
    );
    const country = orderedDistinct[0] ?? "UNKNOWN";
    const hasMultipleLocations = orderedDistinct.length > 1;
    return {
      category: normalizeCategory(job.title),
      role: normalizeRole(job.title),
      skills: normalizeSkills(blob),
      country,
      isRemote: mergedRemote,
      city: primary.city,
      state: primary.state,
      region: primary.region,
      ...(hasMultipleLocations ? { hasMultipleLocations: true } : {}),
    };
    }
  }

  const loc = normalizeLocation(
    `${primaryLocationLineForResolution(job.location ?? "")} ${job.isRemote ? "remote" : ""}`,
  );
  const mergedRemote = loc.isRemote || job.isRemote;
  const combinedText = [job.title, job.description ?? "", job.location ?? ""].join(" ").toLowerCase();

  let country = loc.country;
  if (!isMissingLocation(loc.country)) {
    // keep resolver output
  } else if (
    mergedRemote &&
    !isMultiLocation(job.location) &&
    !hasRegionRestriction(combinedText)
  ) {
    country = "GLOBAL";
  }

  return {
    category: normalizeCategory(job.title),
    role: normalizeRole(job.title),
    skills: normalizeSkills(blob),
    country,
    isRemote: mergedRemote,
    city: loc.city,
    state: loc.state,
    region: loc.region,
  };
}
