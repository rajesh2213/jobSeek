import type { Metadata } from "next";
import type { JobItem } from "./api";
import type { JobFilters } from "./slug-parser";
import { getCanonicalJobListingUrl, hasActiveJobFilters } from "./slug-parser";
import { absoluteUrl, getSiteBaseUrl } from "./seoSite";
import {
  decideJobsListingSeoPolicy,
  type SeoPolicyDecision,
  type SeoPolicyReason,
} from "./seoIndexability";
import { isKnownSkillSlug } from "./taxonomy";

function toTitleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

const POSTED_LABEL: Record<NonNullable<JobFilters["posted"]>, string> = {
  "24h": "last 24 hours",
  "3d": "last 3 days",
  "1w": "last week",
  "1m": "last month",
};

/** Compact geography for SERP titles (identity match + screen space). */
const TITLE_LOCATION_SHORT: Record<string, string> = {
  US: "USA",
  GB: "UK",
  IN: "India",
  CA: "Canada",
  DE: "Germany",
  AU: "Australia",
  FR: "France",
  NL: "Netherlands",
  ES: "Spain",
  IT: "Italy",
  SE: "Sweden",
  PL: "Poland",
  SG: "Singapore",
  AE: "UAE",
  JP: "Japan",
  BR: "Brazil",
  MX: "Mexico",
  ZA: "South Africa",
};

const LOCATION_DISPLAY: Record<string, string> = {
  US: "the United States",
  IN: "India",
  GB: "the United Kingdom",
  CA: "Canada",
  DE: "Germany",
  AU: "Australia",
  FR: "France",
  NL: "the Netherlands",
  ES: "Spain",
  IT: "Italy",
  SE: "Sweden",
  PL: "Poland",
  SG: "Singapore",
  AE: "the UAE",
  JP: "Japan",
  BR: "Brazil",
  MX: "Mexico",
  ZA: "South Africa",
};

function isLegacySeoTitleTemplate(): boolean {
  return process.env.SEO_TITLE_TEMPLATE === "legacy";
}

export function getSeoMinJobsIndex(): number {
  const n = parseInt(process.env.NEXT_PUBLIC_SEO_MIN_JOBS_INDEX ?? "5", 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Prefer API total; fall back to first-page job count when total is omitted (SEO listing cap). */
export function resolveListingJobCount(
  metaTotal: number | null | undefined,
  jobsOnPage: number,
): number {
  if (typeof metaTotal === "number" && metaTotal > 0) return metaTotal;
  return jobsOnPage > 0 ? jobsOnPage : 0;
}

function buildJobsSeoLegacy(filters: JobFilters, total?: number): {
  title: string;
  description: string;
} {
  const parts: string[] = [];
  const remoteish =
    filters.workType === "remote" ||
    filters.isRemote ||
    (filters.workTypes?.length === 1 && filters.workTypes[0] === "remote");
  if (remoteish) parts.push("Remote");
  if (filters.category) parts.push(toTitleCase(filters.category));
  if (filters.role) parts.push(toTitleCase(filters.role));
  if (filters.skills?.length) {
    parts.push(filters.skills.map((s) => toTitleCase(s)).join(", "));
  }
  parts.push("Jobs");
  if (filters.country) parts.push(`in ${filters.country}`);
  if (filters.locations?.length) {
    parts.push(`· ${filters.locations.slice(0, 3).join(", ")}`);
  } else if (filters.location?.trim()) {
    parts.push(`· ${filters.location.trim()}`);
  }

  const titleCore = parts.join(" ");
  const countPrefix =
    typeof total === "number" && total >= 0 ? `${total.toLocaleString()} ` : "";
  const pagePart = filters.page && filters.page > 1 ? ` · Page ${filters.page}` : "";
  const title = `${countPrefix}${titleCore} Hiring Now (Updated Daily)${pagePart} | JobLoom`;

  const { description } = buildJobsSeoDescriptionBody(filters, remoteish, total, titleCore);
  return { title, description };
}

function buildJobsSeoDescriptionBody(
  filters: JobFilters,
  remoteish: boolean,
  total: number | undefined,
  _legacyTitleCore: string,
): { description: string } {
  const refinements: string[] = [];
  if (filters.experience) {
    refinements.push(`${filters.experience} level`);
  }
  if (filters.posted) {
    refinements.push(POSTED_LABEL[filters.posted] ?? filters.posted);
  }
  if (filters.minSalary !== undefined && filters.minSalary > 0) {
    refinements.push(`min. salary ${filters.minSalary.toLocaleString()}`);
  }
  if (filters.workTypes && filters.workTypes.length > 1) {
    refinements.push(`types: ${filters.workTypes.join(", ")}`);
  }

  const freshHint =
    filters.posted && POSTED_LABEL[filters.posted]
      ? `Freshest postings from ${POSTED_LABEL[filters.posted]}.`
      : "Updated daily with the newest roles.";
  let description =
    filters.role || filters.skills?.length || filters.category || filters.country
      ? `Find ${remoteish ? "remote " : ""}${filters.category ? `${filters.category} ` : ""}jobs${
          filters.country ? ` (${filters.country})` : ""
        }${refinements.length ? `. Filter: ${refinements.join("; ")}.` : "."}`
      : "Browse jobs with category, role, skill, and country filters.";

  if (typeof total === "number" && total >= 0) {
    description = `${description} ${total.toLocaleString()} open roles match this search. ${freshHint}`;
  } else {
    description = `${description} ${freshHint}`;
  }

  return { description };
}

function refineryForDescription(filters: JobFilters): string[] {
  const refinements: string[] = [];
  if (filters.experience) refinements.push(`${filters.experience} level`);
  if (filters.posted) refinements.push(POSTED_LABEL[filters.posted] ?? filters.posted);
  if (filters.minSalary !== undefined && filters.minSalary > 0) {
    refinements.push(`min. salary ${filters.minSalary.toLocaleString()}`);
  }
  if (filters.workTypes && filters.workTypes.length > 1) {
    refinements.push(`types: ${filters.workTypes.join(", ")}`);
  }
  return refinements;
}

function titleSalaryFragment(minSalary: number): string {
  if (minSalary >= 1000) return ` · From $${Math.round(minSalary / 1000)}k+`;
  return ` · From $${minSalary.toLocaleString()}+`;
}

/** Prefer role > category > skills for query intent. */
function primarySubjectTitle(filters: JobFilters): string {
  if (filters.role?.trim()) return toTitleCase(filters.role.trim());
  if (filters.category?.trim()) return toTitleCase(filters.category.trim());
  if (filters.skills?.length) {
    return filters.skills.slice(0, 2).map((s) => toTitleCase(s.trim())).filter(Boolean).join(", ");
  }
  return "";
}

function listingMidTitle(filters: JobFilters, remoteish: boolean, locShort: string, subject: string): string {
  if (subject) {
    if (remoteish && locShort) return `Remote ${subject} Jobs in ${locShort}`;
    if (remoteish) return `Remote ${subject} Jobs`;
    if (locShort) return `${subject} Jobs in ${locShort}`;
    return `${subject} Jobs`;
  }
  if (remoteish && locShort) return `Remote Jobs in ${locShort}`;
  if (remoteish) return `Remote Jobs`;
  if (locShort) return `Jobs in ${locShort}`;
  return "Jobs";
}

/** Prose location for meta description (longer form than title). */
function descriptionLocationPhrase(filters: JobFilters): string {
  const code = filters.country?.trim().toUpperCase();
  if (code) return LOCATION_DISPLAY[code] ?? code;
  if (filters.locations?.length) return filters.locations.slice(0, 2).join(", ");
  if (filters.location?.trim()) return filters.location.trim();
  return "";
}

function fitListingTitleCore(core: string, maxChars: number): string {
  let s = core;
  if (s.length <= maxChars) return s;
  s = s.replace(/\s*·\s*From \$[^·]+$/, "");
  if (s.length <= maxChars) return s;
  s = s.replace(/\s*·\s*Hiring now\s*$/i, " · Apply");
  if (s.length <= maxChars) return s;
  s = s.replace(/\s*·\s*Apply early\s*$/i, " · Apply");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars - 1).trimEnd()}…`;
}

function buildJobsSeoV2(filters: JobFilters, total?: number): {
  title: string;
  description: string;
} {
  const remoteish =
    filters.workType === "remote" ||
    filters.isRemote ||
    (filters.workTypes?.length === 1 && filters.workTypes[0] === "remote");
  const locCode = filters.country?.trim().toUpperCase() ?? "";
  const locShort = locCode ? (TITLE_LOCATION_SHORT[locCode] ?? locCode) : "";
  const subject = primarySubjectTitle(filters);
  const mid = listingMidTitle(filters, remoteish, locShort, subject);
  const pagePart = filters.page && filters.page > 1 ? ` · Page ${filters.page}` : "";
  const refinements = refineryForDescription(filters);
  const locPhrase = descriptionLocationPhrase(filters);

  let title: string;
  const hasSalaryTitle =
    filters.minSalary !== undefined && filters.minSalary > 0 ? titleSalaryFragment(filters.minSalary) : "";

  if (typeof total === "number" && total > 0) {
    const coreRaw = `${total.toLocaleString()} ${mid} · Apply early${hasSalaryTitle}`;
    const core = fitListingTitleCore(coreRaw, 58);
    title = `${core}${pagePart} | JobLoom`;
  } else if (typeof total === "number" && total === 0) {
    const exploreMid = subject
      ? remoteish && locShort
        ? `Remote ${subject} openings in ${locShort}`
        : remoteish
          ? `Remote ${subject} openings`
          : locShort
            ? `${subject} openings in ${locShort}`
            : `${subject} openings`
      : remoteish && locShort
        ? `Remote openings in ${locShort}`
        : remoteish
          ? "Remote openings"
          : locShort
            ? `Openings in ${locShort}`
            : "Job openings";
    title = `Explore ${exploreMid} — listings refresh daily${pagePart} | JobLoom`;
  } else {
    const discoverSubject = subject
      ? `${remoteish ? "remote " : ""}${subject} roles`
      : remoteish
        ? "remote roles from top employers"
        : "roles from top employers";
    title = `Discover ${discoverSubject} · New listings daily${pagePart} | JobLoom`;
  }

  const freshHint =
    filters.posted && POSTED_LABEL[filters.posted]
      ? `Highlighting ${POSTED_LABEL[filters.posted]} so you see the newest posts first.`
      : "Listings refresh daily as companies publish to their career sites.";

  const refineClause = refinements.length ? ` Filters: ${refinements.join("; ")}.` : "";

  let description: string;
  if (typeof total === "number" && total > 0) {
    const geoBit = locPhrase ? ` in ${locPhrase}` : "";
    const focus = subject ? `${remoteish ? "remote " : ""}${subject.toLowerCase()} jobs${geoBit}` : `${remoteish ? "remote " : ""}jobs${geoBit}`;
    description = `${total.toLocaleString()} open roles for ${focus.trim()}—apply early via employer career pages.${refineClause} ${freshHint}`;
  } else if (typeof total === "number" && total === 0) {
    const geoBit = locPhrase ? ` in ${locPhrase}` : "";
    description = `Explore ${subject ? `${subject.toLowerCase()} openings` : "openings"}${geoBit} on JobLoom—new listings appear as companies hire.${refineClause} Direct career-page sourcing; widen filters or check back soon.`;
  } else {
    const geoBit = locPhrase ? ` (${locPhrase})` : "";
    description = `Find ${remoteish ? "remote " : ""}${subject ? `${subject.toLowerCase()} roles` : "open roles"}${geoBit} from company career sites—discover openings early in one search.${refineClause} ${freshHint}`;
  }

  description = description.replace(/\s+/g, " ").trim();
  if (description.length > 160) description = `${description.slice(0, 157).trimEnd()}…`;

  return { title, description };
}

export function buildJobsSeo(filters: JobFilters, total?: number): {
  title: string;
  description: string;
} {
  return isLegacySeoTitleTemplate() ? buildJobsSeoLegacy(filters, total) : buildJobsSeoV2(filters, total);
}

function hasDuplicateLikeFilters(filters: JobFilters): boolean {
  if (filters.page && filters.page > 1 && !hasActiveJobFilters({ ...filters, page: undefined })) {
    return true;
  }
  if (filters.role && filters.roles && filters.roles.length === 1 && filters.roles[0] === filters.role) {
    return false;
  }
  return false;
}

function hasUnknownSkillFilter(filters: JobFilters): boolean {
  const skills = filters.skills ?? [];
  if (skills.length !== 1) return false;
  const slug = skills[0]?.trim().toLowerCase() ?? "";
  return slug.length > 0 && !isKnownSkillSlug(slug);
}

export function formatJobDiscoveryBreadcrumbLabel(filters: JobFilters): string {
  const { title } = buildJobsSeo(filters);
  return title
    .replace(/\s*\|\s*JobLoom$/i, "")
    .replace(/\s*·\s*Page \d+$/i, "")
    .replace(/\s*·\s*Hiring Now \(Updated Daily\)\s*$/i, "")
    .replace(/\s*·\s*Hiring now\s*$/i, "")
    .replace(/\s*·\s*Hiring\s*$/i, "")
    .replace(/\s*—\s*listings refresh daily\s*$/i, "")
    .replace(/\s*·\s*New listings daily\s*$/i, "")
    .replace(/\s*\(by salary\)/i, "")
    .trim();
}

export function jobsMetadata(filters: JobFilters, total?: number): Metadata {
  const { title, description } = buildJobsSeo(filters, total);
  return { title, description };
}

export function jobsRouteMetadata(
  filters: JobFilters,
  options: {
    canonicalPath: string;
    routeKind: "jobs-root" | "jobs-slug";
    searchParamKeys: string[];
    validCanonicalSlugPath?: boolean;
    total?: number;
  },
): Metadata {
  const { title, description } = buildJobsSeo(filters, options.total);
  const canonical = absoluteUrl(options.canonicalPath);
  const indexMatrixEnabled = process.env.SEO_INDEX_MATRIX_ENABLED === "true";
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  let decision: SeoPolicyDecision;
  if (!indexMatrixEnabled) {
    const min = getSeoMinJobsIndex();
    const indexable =
      options.total === undefined ||
      (options.total >= min &&
        options.total > 0 &&
        !hasDuplicateLikeFilters(filters) &&
        !hasUnknownSkillFilter(filters));
    decision = {
      index: indexable,
      follow: true,
      sitemapEligible: indexable,
      action: indexable ? "allow" : "noindex",
      reason: indexable ? "allow_jobs_canonical_leaf" : "exclude_sitemap_noindex",
      policyVersion: "v1",
    };
  } else {
    decision = decideJobsListingSeoPolicy({
      routeKind: options.routeKind,
      filters,
      searchParamKeys: options.searchParamKeys,
      canonicalPath: options.canonicalPath,
      validCanonicalSlugPath: options.validCanonicalSlugPath,
    });
  }

  if (forceNoindexAll) {
    decision = { ...decision, index: false, follow: true, sitemapEligible: false };
  } else if (disableAllNoindex) {
    decision = { ...decision, index: true, follow: true };
  }
  recordSeoDecisionCounter("jobs", decision.reason);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: decision.index, follow: decision.follow },
  };
}

const seoDecisionCounters = new Map<string, number>();
let seoDecisionCounterLogs = 0;

function recordSeoDecisionCounter(surface: "jobs", reason: SeoPolicyReason): void {
  if (process.env.SEO_INDEX_MATRIX_ENABLED !== "true") return;
  const key = `${surface}:${reason}`;
  seoDecisionCounters.set(key, (seoDecisionCounters.get(key) ?? 0) + 1);
  seoDecisionCounterLogs += 1;
  if (seoDecisionCounterLogs % 50 !== 0) return;
  const compact: Record<string, number> = {};
  for (const [k, v] of seoDecisionCounters.entries()) compact[k] = v;
  console.info("[seo-policy] decision-counters", compact);
}

// ---------------------------------------------------------------------------
// Dynamic intro for SEO landing pages
// ---------------------------------------------------------------------------

/**
 * Deterministic page intro derived only from filters + the existing SSR listing
 * response (total count, first-page job items). No additional fetches or DB queries.
 * Falls back to a generic intro when insufficient context is available.
 */
export function buildDynamicIntro(
  filters: JobFilters,
  meta: { total?: number | null; jobs?: JobItem[] },
): string {
  const total = typeof meta.total === "number" && meta.total > 0 ? meta.total : null;
  const isRemote =
    filters.workType === "remote" || filters.isRemote === true;
  const role = filters.role?.trim();
  const category = filters.category?.trim();
  const country = filters.country?.trim()?.toUpperCase();

  const topCompanies = extractTopCompanies(meta.jobs ?? [], 3);
  const companySuffix =
    topCompanies.length >= 2
      ? ` Top employers include ${topCompanies.join(", ")}.`
      : "";

  const countStr = total ? `${total.toLocaleString()} ` : "";

  if (filters.skills?.length === 1 && !role && !category && !country && !isRemote) {
    const skill = filters.skills[0]?.trim();
    if (skill) {
      return `Browse ${countStr}${toTitleCase(skill)} jobs from company career sites—updated daily with new postings.${companySuffix}`;
    }
  }
  if (role && isRemote) {
    return `Browse ${countStr}remote ${toTitleCase(role)} jobs updated daily on JobLoom.${companySuffix}`;
  }
  if (role && country) {
    const loc = LOCATION_DISPLAY[country] ?? country;
    return `Browse ${countStr}${toTitleCase(role)} jobs in ${loc} updated daily on JobLoom.${companySuffix}`;
  }
  if (role) {
    return `Browse ${countStr}${toTitleCase(role)} jobs updated daily on JobLoom.${companySuffix}`;
  }
  if (category && isRemote) {
    return `Explore ${countStr}remote ${toTitleCase(category)} jobs refreshed daily across top companies.${companySuffix}`;
  }
  if (category && country) {
    const loc = LOCATION_DISPLAY[country] ?? country;
    return `Explore ${countStr}${toTitleCase(category)} jobs in ${loc} refreshed daily.${companySuffix}`;
  }
  if (category) {
    return `Explore ${countStr}${toTitleCase(category)} jobs refreshed daily from company career pages.${companySuffix}`;
  }
  if (isRemote) {
    return `Browse ${countStr}remote jobs from verified company career pages, updated daily.${companySuffix}`;
  }
  if (country) {
    const loc = LOCATION_DISPLAY[country] ?? country;
    return `Browse ${countStr}jobs in ${loc} from verified company career pages, updated daily.${companySuffix}`;
  }
  return "JobLoom helps you discover real-time jobs from company career sites in one place, then drill into focused listings like this page.";
}

function extractTopCompanies(jobs: JobItem[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const name = (job as { company?: { name?: string } }).company?.name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name]) => name);
}

export function buildCompanyOrganizationJsonLd(input: {
  name: string;
  slug: string;
  domain?: string | null;
  logoUrl?: string | null;
  careersUrl?: string | null;
  visibleJobCount?: number | null;
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const pageUrl = `${base}/company/${input.slug}`;
  const domain = input.domain?.trim();
  const org: Record<string, unknown> = {
    "@type": "Organization",
    name: input.name,
    url: pageUrl,
  };
  if (domain) {
    const site = domain.startsWith("http") ? domain : `https://${domain}`;
    org.sameAs = [site];
  }
  if (input.logoUrl?.trim()) {
    org.logo = input.logoUrl.trim();
  }
  if (input.careersUrl?.trim()) {
    org.subjectOf = {
      "@type": "WebPage",
      url: input.careersUrl.trim(),
    };
  }
  return {
    "@context": "https://schema.org",
    ...org,
  };
}

export function buildJobListingItemListJsonLd(
  jobs: JobItem[],
  listTotal?: number,
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: listTotal ?? jobs.length,
    itemListElement: jobs.map((job, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${base}/job/${job.id}`,
      name: job.title,
    })),
  };
}

export function buildBreadcrumbListJsonLd(
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${base}${item.path.startsWith("/") ? item.path : `/${item.path}`}`,
    })),
  };
}

export function buildJobDiscoveryCrumbItems(filters: JobFilters): Array<{
  name: string;
  href?: string;
}> {
  if (!hasActiveJobFilters(filters)) {
    return [{ name: "Home", href: "/" }, { name: "Jobs" }];
  }
  return [
    { name: "Home", href: "/" },
    { name: "Jobs", href: "/jobs" },
    { name: formatJobDiscoveryBreadcrumbLabel(filters) },
  ];
}

export function jobDiscoveryBreadcrumbJsonLdPaths(
  filters: JobFilters,
): Array<{ name: string; path: string }> {
  const canonical = getCanonicalJobListingUrl(filters);
  if (!hasActiveJobFilters(filters)) {
    return [
      { name: "Home", path: "/" },
      { name: "Jobs", path: "/jobs" },
    ];
  }
  return [
    { name: "Home", path: "/" },
    { name: "Jobs", path: "/jobs" },
    { name: formatJobDiscoveryBreadcrumbLabel(filters), path: canonical },
  ];
}
