import type { Metadata } from "next";
import { loadJobsDiscoveryPage, stableJobFiltersKey } from "../../../../lib/jobsPageData";
import { fetchJobsRelatedSlugs } from "../../../../lib/jobsRelatedSlugs";
import {
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
} from "../../../../lib/seo";
import { JobsSearchPage } from "../../../../components/job/JobsSearchPage";
import {
  getCanonicalJobListingUrl,
  parseJobFiltersFromSearch,
  parseSlug,
  filtersToSlug,
} from "../../../../lib/slug-parser";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { JobsListingFaq } from "../../../../components/seo/JobsListingFaq";

const FALLBACK_RELATED_SLUGS = [
  "engineering-data-remote",
  "product-management-us",
  "design-remote",
];

interface Props {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const filters = {
    ...parseSlug(slug),
    ...parseJobFiltersFromSearch(sp),
    surface: "seo" as const,
  };
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters));
  return jobsRouteMetadata(filters, {
    canonicalPath: getCanonicalJobListingUrl(filters),
    total: response.meta?.total,
  });
}

export default async function JobsSeoPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const filters = {
    ...parseSlug(slug),
    ...parseJobFiltersFromSearch(sp),
    surface: "seo" as const,
  };
  const filtersKey = stableJobFiltersKey(filters);
  const currentSlug = filtersToSlug({
    category: filters.category,
    role: filters.role,
    skills: filters.skills,
    country: filters.country,
    isRemote: filters.isRemote,
    workType: filters.workType,
  });

  const [response, relatedSlugs] = await Promise.all([
    loadJobsDiscoveryPage(filtersKey),
    fetchJobsRelatedSlugs({ currentSlug, fallback: FALLBACK_RELATED_SLUGS }),
  ]);

  const total = response.meta?.total ?? 0;
  const minIndex = getSeoMinJobsIndex();
  const indexable = total >= minIndex;

  const listingTop = (
    <>
      <JsonLdScript data={buildBreadcrumbListJsonLd(jobDiscoveryBreadcrumbJsonLdPaths(filters))} />
      {indexable ? (
        <JsonLdScript data={buildJobListingItemListJsonLd(response.data.slice(0, 10), total)} />
      ) : null}
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
