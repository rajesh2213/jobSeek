import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadJobsDiscoveryPage, stableJobFiltersKey } from "../../../../lib/jobsPageData";
import {
  buildJobDiscoveryCrumbItems,
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
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
import { JobsListingFaq } from "../../../../components/seo/JobsListingFaq";
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
    total: response.meta?.total ?? undefined,
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

  const total = response.meta?.total ?? 0;
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
  const relatedSearchLinks = buildCuratedRelatedSearchLinks(filters, canonicalSlugPath);

  const listingTop = (
    <>
      <SeoBreadcrumbs items={buildJobDiscoveryCrumbItems(filters)} />
      <JsonLdScript data={buildBreadcrumbListJsonLd(jobDiscoveryBreadcrumbJsonLdPaths(filters))} />
      {indexable ? (
        <JsonLdScript data={buildJobListingItemListJsonLd(response.data.slice(0, 10), total)} />
      ) : null}
      <section className="mt-3 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-xs leading-snug text-ink/75 sm:mt-4 sm:px-4 sm:py-3 sm:text-sm sm:leading-normal">
        <p>
          <Link href="/" className="font-semibold text-brand hover:underline">
            JobLoom
          </Link>{" "}
          helps you discover real-time jobs from company career sites in one place, then drill into focused listings like this page.
        </p>
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

  const listingFaq =
    total >= minIndex && total >= 8 ? <JobsListingFaq /> : null;

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

/** Phase B: small fixed set of canonical hubs; skips current path; caps at 6 links. */
function buildCuratedRelatedSearchLinks(
  filters: JobFilters,
  currentCanonicalPath: string,
): Array<{ href: string; label: string }> {
  const norm = (p: string) => (p.split("?")[0] ?? "").replace(/\/$/, "") || "/jobs";
  const current = norm(currentCanonicalPath);
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];

  const push = (href: string, label: string) => {
    const path = norm(href);
    if (path === current || seen.has(path)) return;
    seen.add(path);
    out.push({ href, label });
  };

  const role = filters.role?.trim();
  const category = filters.category?.trim();
  if (role) {
    push(`/jobs/role/${role}/location/remote`, `Remote ${toTitle(role)} jobs`);
    push(`/jobs/role/${role}/location/us`, `${toTitle(role)} jobs in the US`);
    push(`/jobs/role/${role}/location/in`, `${toTitle(role)} jobs in India`);
    push(`/jobs/role/${role}/location/gb`, `${toTitle(role)} jobs in the UK`);
  }
  if (category && ALLOWED_CATEGORY.has(category)) {
    push(`/jobs/category/${category}/location/remote`, `Remote ${toTitle(category)} jobs`);
    push(`/jobs/category/${category}/location/us`, `${toTitle(category)} jobs in the US`);
  }

  const fallbacks: Array<{ href: string; label: string }> = [
    { href: "/jobs/role/data-engineer/location/remote", label: "Remote data engineer jobs" },
    { href: "/jobs/role/product-manager/location/us", label: "Product manager jobs in the US" },
    { href: "/jobs/category/engineering/location/remote", label: "Remote engineering jobs" },
    { href: "/jobs/role/frontend-engineer/location/remote", label: "Remote frontend engineer jobs" },
  ];
  for (const f of fallbacks) {
    if (out.length >= 6) break;
    push(f.href, f.label);
  }
  return out.slice(0, 6);
}
