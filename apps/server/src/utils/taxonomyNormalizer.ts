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

export function extractSalaryMinUsd(description: string): number | null {
  const m = description.match(/\$\s*(\d{1,3})\s*k\b/i);
  if (m) return parseInt(m[1]!, 10) * 1000;
  return null;
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
} {
  const blob = `${job.title}\n${job.description ?? ""}`;
  const loc = normalizeLocation(`${job.location ?? ""} ${job.isRemote ? "remote" : ""}`);
  return {
    category: normalizeCategory(job.title),
    role: normalizeRole(job.title),
    skills: normalizeSkills(blob),
    country: loc.country,
    isRemote: loc.isRemote || job.isRemote,
    city: loc.city,
    state: loc.state,
    region: loc.region,
  };
}
