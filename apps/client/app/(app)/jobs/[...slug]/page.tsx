import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadJobsDiscoveryPage, stableJobFiltersKey } from "../../../../lib/jobsPageData";
import { fetchJobsRelatedSlugs } from "../../../../lib/jobsRelatedSlugs";
import {
  buildJobDiscoveryCrumbItems,
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
} from "../../../../lib/seo";
import { JobsSearchPage } from "../../../../components/job/JobsSearchPage";
import {
  getCanonicalJobListingUrl,
  normalizeRelatedSlugPath,
  parseJobFiltersFromSearch,
  parseSlugWithMeta,
  filtersToSlug,
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
  const currentSlug = filtersToSlug({
    category: filters.category,
    role: filters.role,
    skills: filters.skills,
    country: filters.country,
    location: filters.location,
    isRemote: filters.isRemote,
    workType: filters.workType,
    experience: filters.experience,
  });

  const [response, relatedSlugsRaw] = await Promise.all([
    loadJobsDiscoveryPage(filtersKey),
    fetchJobsRelatedSlugs({ currentSlug, fallback: FALLBACK_RELATED_SLUGS }),
  ]);
  const relatedSlugs = relatedSlugsRaw
    .map((s) => normalizeRelatedSlugPath(s).replace(/^\/jobs\/?/, ""))
    .filter(Boolean);

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
  const role = typeof filters.role === "string" && filters.role ? filters.role : "frontend-engineer";
  const relatedSearchLinks = [
    { href: `/jobs/role/${role}/location/remote`, label: `Explore remote ${toTitle(role)} jobs` },
    { href: "/jobs/category/engineering/location/remote", label: "Explore remote engineering jobs" },
    { href: "/jobs/role/backend-developer/location/us", label: "See backend jobs in US" },
    { href: "/jobs/role/frontend-engineer/location/remote", label: "See remote frontend jobs" },
  ];

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

function toTitle(s: string): string {
  return s
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}
