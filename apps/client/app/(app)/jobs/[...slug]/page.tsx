import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadJobsDiscoveryPage, stableJobFiltersKey } from "../../../../lib/jobsPageData";
import {
  buildDynamicIntro,
  buildJobDiscoveryCrumbItems,
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
  resolveListingJobCount,
} from "../../../../lib/seo";
import { JobsSearchPage } from "../../../../components/job/JobsSearchPage";
import { JOB_CATEGORIES } from "../../../../lib/taxonomy";
import {
  getCanonicalJobListingUrl,
  normalizeRelatedSlugPath,
  parseJobFiltersFromSearch,
  parseSlugWithMeta,
  type JobFilters,
} from "../../../../lib/slug-parser";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { JobsListingFaq, buildFaqJsonLd } from "../../../../components/seo/JobsListingFaq";
import { SeoBreadcrumbs } from "../../../../components/seo/SeoBreadcrumbs";
import { decideJobsListingSeoPolicy } from "../../../../lib/seoIndexability";

const FALLBACK_RELATED_SLUGS = [
  "role/data-engineer/location/remote",
  "role/product-manager/location/us",
  "role/product-designer/location/remote",
];

export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const parsed = parseSlugWithMeta(slug);
  const filters = {
    ...parsed.filters,
    ...parseJobFiltersFromSearch(sp),
    surface: "seo" as const,
  };
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters));
  const searchParamKeys = Object.keys(sp).filter(Boolean).sort();
  return jobsRouteMetadata(filters, {
    routeKind: "jobs-slug",
    searchParamKeys,
    validCanonicalSlugPath: parsed.validCanonical,
    canonicalPath: getCanonicalJobListingUrl(filters),
    total: resolveListingJobCount(response.meta?.total, response.data.length) || undefined,
  });
}

export default async function JobsSeoPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const parsed = parseSlugWithMeta(slug);
  const filters = {
    ...parsed.filters,
    ...parseJobFiltersFromSearch(sp),
    surface: "seo" as const,
  };
  const canonicalPath = getCanonicalJobListingUrl(filters);
  const canonicalSlugPath = canonicalPath.split("?")[0] ?? "/jobs";
  const incomingPath = `/jobs/${slug.join("/")}`;
  if (incomingPath !== canonicalSlugPath || !parsed.validCanonical) {
    redirect(canonicalPath);
  }
  const filtersKey = stableJobFiltersKey(filters);
  /**
   * Do not await `fetchSeoLandingPages` on the server for slug SEO routes: it fans out into the
   * same expensive `/seo/landing-pages` work as the sitemap and can dominate TTFB (~30s+), while
   * `JobsSearchClient` already hydrates related links from the same API after paint.
   */
  const response = await loadJobsDiscoveryPage(filtersKey);
  const relatedSlugs = FALLBACK_RELATED_SLUGS.map((s) =>
    normalizeRelatedSlugPath(s).replace(/^\/jobs\/?/, ""),
  ).filter(Boolean);

  const total = resolveListingJobCount(response.meta?.total, response.data.length);
  const policy = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters,
    searchParamKeys: Object.keys(sp).filter(Boolean).sort(),
    canonicalPath,
    validCanonicalSlugPath: parsed.validCanonical,
  });
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  const indexable = forceNoindexAll ? false : disableAllNoindex ? true : policy.index;
  const minIndex = getSeoMinJobsIndex();
  const dominantCategory = response.data[0]?.category ?? undefined;
  const relatedSearchLinks = buildCuratedRelatedSearchLinks(filters, canonicalSlugPath, { dominantCategory });

  const listingTop = (
    <>
      <SeoBreadcrumbs items={buildJobDiscoveryCrumbItems(filters)} />
      <JsonLdScript data={buildBreadcrumbListJsonLd(jobDiscoveryBreadcrumbJsonLdPaths(filters))} />
      {indexable ? (
        <JsonLdScript data={buildJobListingItemListJsonLd(response.data.slice(0, 10), total)} />
      ) : null}
      <section className="mt-3 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-xs leading-snug text-ink/75 sm:mt-4 sm:px-4 sm:py-3 sm:text-sm sm:leading-normal">
        <p>{buildDynamicIntro(filters, { total, jobs: response.data })}</p>
      </section>
      <section className="mt-3 rounded-xl border border-ink/10 bg-surface px-3 py-3 sm:mt-4 sm:px-4 sm:py-4">
        <h3 className="text-xs font-semibold text-ink sm:text-sm">Explore related searches</h3>
        <div className="mt-1.5 flex flex-wrap gap-1.5 sm:mt-2 sm:gap-2">
          {relatedSearchLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </>
  );

  const faqJsonLd = indexable ? buildFaqJsonLd(filters, total) : null;
  const listingFaq =
    total >= minIndex && total >= 8 ? (
      <>
        {faqJsonLd ? <JsonLdScript data={faqJsonLd} /> : null}
        <JobsListingFaq filters={filters} total={total} />
      </>
    ) : null;

  return (
    <JobsSearchPage
      jobs={response.data}
      meta={response.meta}
      relatedSlugs={relatedSlugs}
      listingTop={listingTop}
      listingFaq={listingFaq}
    />
  );
}

const ALLOWED_CATEGORY = new Set<string>(JOB_CATEGORIES);

function toTitle(s: string): string {
  return s
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

const CATEGORY_REPRESENTATIVE_ROLES: Partial<Record<string, string[]>> = {
  engineering: ["backend-developer", "frontend-engineer", "full-stack-engineer", "devops-engineer"],
  product: ["product-manager", "product-designer", "product-analyst"],
  data: ["data-engineer", "data-scientist", "data-analyst", "machine-learning-engineer"],
  management: ["engineering-manager", "project-manager", "program-manager"],
  security: ["security-engineer", "security-analyst"],
  infrastructure: ["site-reliability-engineer", "cloud-engineer", "devops-engineer"],
  design: ["product-designer", "ux-designer", "ui-designer"],
  marketing: ["marketing-manager", "growth-marketer", "content-marketer"],
  sales: ["account-executive", "sales-engineer", "business-development-representative"],
  finance: ["financial-analyst", "accountant", "controller"],
};

const LOCATION_HUB_LINKS: ReadonlyArray<{ token: string; label: string }> = [
  { token: "remote", label: "Remote" },
  { token: "us", label: "US" },
  { token: "in", label: "India" },
  { token: "gb", label: "UK" },
  { token: "de", label: "Germany" },
  { token: "ca", label: "Canada" },
];

/**
 * Hierarchy-aware related search links. Adapts link targets based on the
 * page's position in the category > role > location taxonomy. Uses only
 * client-side taxonomy data — no additional fetches.
 */
function buildCuratedRelatedSearchLinks(
  filters: JobFilters,
  currentCanonicalPath: string,
  context?: { dominantCategory?: string },
): Array<{ href: string; label: string }> {
  const norm = (p: string) => (p.split("?")[0] ?? "").replace(/\/$/, "") || "/jobs";
  const current = norm(currentCanonicalPath);
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];
  const MAX_LINKS = 10;

  const push = (href: string, label: string) => {
    if (out.length >= MAX_LINKS) return;
    const path = norm(href);
    if (path === current || seen.has(path)) return;
    seen.add(path);
    out.push({ href, label });
  };

  const role = filters.role?.trim();
  const category = filters.category?.trim();
  const isRemote =
    filters.workType === "remote" || filters.isRemote === true;
  const hasLocation = Boolean(filters.country?.trim()) || isRemote;
  const inferredCategory = category || context?.dominantCategory;

  if (role) {
    // Role page: link to parent category hub, then role+location variants, then sibling roles
    if (inferredCategory && ALLOWED_CATEGORY.has(inferredCategory)) {
      push(`/jobs/category/${inferredCategory}`, `All ${toTitle(inferredCategory)} jobs`);
    }
    if (!isRemote) push(`/jobs/role/${role}/location/remote`, `Remote ${toTitle(role)} jobs`);
    for (const loc of LOCATION_HUB_LINKS) {
      if (out.length >= MAX_LINKS) break;
      push(`/jobs/role/${role}/location/${loc.token}`, `${toTitle(role)} jobs in ${loc.label}`);
    }
  } else if (category && ALLOWED_CATEGORY.has(category)) {
    // Category page: link to representative roles within category, then category+location
    const reps = CATEGORY_REPRESENTATIVE_ROLES[category] ?? [];
    for (const r of reps) {
      if (out.length >= MAX_LINKS - 3) break;
      push(`/jobs/role/${r}`, `${toTitle(r)} jobs`);
    }
    if (!isRemote) push(`/jobs/category/${category}/location/remote`, `Remote ${toTitle(category)} jobs`);
    push(`/jobs/category/${category}/location/us`, `${toTitle(category)} jobs in the US`);
    push(`/jobs/category/${category}/location/in`, `${toTitle(category)} jobs in India`);
  } else if (hasLocation) {
    // Location page: link to top categories and roles in this location
    const locToken = isRemote ? "remote" : (filters.country?.trim()?.toLowerCase() ?? "");
    const locLabel = isRemote ? "remote" : (filters.country?.trim()?.toUpperCase() ?? "");
    for (const cat of ["engineering", "data", "product", "design"]) {
      if (out.length >= MAX_LINKS - 2) break;
      push(`/jobs/category/${cat}`, `${toTitle(cat)} jobs`);
    }
    for (const r of ["backend-developer", "frontend-engineer", "data-engineer"]) {
      if (out.length >= MAX_LINKS) break;
      if (locToken) {
        push(`/jobs/role/${r}/location/${locToken}`, `${toTitle(r)} jobs${locLabel ? ` in ${locLabel}` : ""}`);
      } else {
        push(`/jobs/role/${r}`, `${toTitle(r)} jobs`);
      }
    }
  }

  // Fallbacks for any remaining slots
  const fallbacks: Array<{ href: string; label: string }> = [
    { href: "/jobs/category/engineering", label: "Engineering jobs" },
    { href: "/jobs/category/data", label: "Data jobs" },
    { href: "/jobs/role/data-engineer/location/remote", label: "Remote data engineer jobs" },
    { href: "/jobs/role/product-manager/location/us", label: "Product manager jobs in the US" },
    { href: "/jobs/location/remote", label: "Remote jobs" },
  ];
  for (const f of fallbacks) {
    if (out.length >= MAX_LINKS) break;
    push(f.href, f.label);
  }
  return out.slice(0, MAX_LINKS);
}
