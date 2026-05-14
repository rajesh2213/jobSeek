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

export function getSeoMinJobsIndex(): number {
  const n = parseInt(process.env.NEXT_PUBLIC_SEO_MIN_JOBS_INDEX ?? "5", 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

export function buildJobsSeo(filters: JobFilters, total?: number): {
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

  return { title, description };
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

export function formatJobDiscoveryBreadcrumbLabel(filters: JobFilters): string {
  const { title } = buildJobsSeo(filters);
  return title
    .replace(/\s*\|\s*JobLoom$/i, "")
    .replace(/\s*·\s*Page \d+$/i, "")
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
      (options.total >= min && options.total > 0 && !hasDuplicateLikeFilters(filters));
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

const LOCATION_DISPLAY: Record<string, string> = {
  US: "the United States", IN: "India", GB: "the United Kingdom", CA: "Canada",
  DE: "Germany", AU: "Australia", FR: "France", NL: "the Netherlands",
  ES: "Spain", IT: "Italy", SE: "Sweden", PL: "Poland", SG: "Singapore",
  AE: "the UAE", JP: "Japan", BR: "Brazil", MX: "Mexico", ZA: "South Africa",
};

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
