import type { Metadata } from "next";
import type { JobItem } from "./api";
import type { JobFilters } from "./slug-parser";
import { getCanonicalJobListingUrl, hasActiveJobFilters } from "./slug-parser";
import { absoluteUrl, getSiteBaseUrl } from "./seoSite";

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
  const n = parseInt(process.env.NEXT_PUBLIC_SEO_MIN_JOBS_INDEX ?? "3", 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
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

  let titleCore = parts.join(" ");
  if (filters.sort === "salary_desc") titleCore += " (by salary)";
  if (filters.page && filters.page > 1) titleCore += ` · Page ${filters.page}`;
  const title = `${titleCore} | JobLoom`;

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

  let description =
    filters.role || filters.skills?.length || filters.category || filters.country
      ? `Find ${remoteish ? "remote " : ""}${filters.category ? `${filters.category} ` : ""}jobs${
          filters.country ? ` (${filters.country})` : ""
        }${refinements.length ? `. Filter: ${refinements.join("; ")}.` : "."}`
      : "Browse jobs with category, role, skill, and country filters.";

  if (typeof total === "number" && total >= 0) {
    description = `${description} ${total.toLocaleString()} open roles match this search.`;
  }

  return { title, description };
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
    total?: number;
  },
): Metadata {
  const { title, description } = buildJobsSeo(filters, options.total);
  const canonical = absoluteUrl(options.canonicalPath);
  const min = getSeoMinJobsIndex();
  const indexable =
    options.total === undefined || options.total >= min;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
    },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: true },
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
