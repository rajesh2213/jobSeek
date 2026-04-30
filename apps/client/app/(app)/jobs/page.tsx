import type { Metadata } from "next";
import {
  loadJobsDiscoveryPage,
  loadJobsListingPageBundle,
  stableJobFiltersKey,
} from "../../../lib/jobsPageData";
import { fetchJobsRelatedSlugs } from "../../../lib/jobsRelatedSlugs";
import {
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
} from "../../../lib/seo";
import { JobsSearchPage } from "../../../components/job/JobsSearchPage";
import {
  getCanonicalJobListingUrl,
  parseJobFiltersFromSearch,
  filtersToSlug,
} from "../../../lib/slug-parser";
import { JsonLdScript } from "../../../components/seo/JsonLdScript";
import { JobsListingFaq } from "../../../components/seo/JobsListingFaq";

const FALLBACK_RELATED_SLUGS = [
  "role/react-developer/location/remote",
  "role/salesforce-specialist/location/us",
  "role/marketing-manager/location/remote",
];

export const revalidate = 300;

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters)).catch(() => ({
    data: [],
    meta: undefined,
  }));
  return jobsRouteMetadata(filters, {
    canonicalPath: getCanonicalJobListingUrl(filters),
    total: response.meta?.total,
  });
}

export default async function JobsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const filtersKey = stableJobFiltersKey(filters);
  const currentSlug = filtersToSlug({
    category: filters.category,
    role: filters.role,
    skills: filters.skills,
    country: filters.country,
    location: filters.location,
    isRemote: filters.isRemote,
    workType: filters.workType,
  });

  const [bundleResult, relatedResult] = await Promise.allSettled([
    loadJobsListingPageBundle(filtersKey),
    fetchJobsRelatedSlugs({ currentSlug, fallback: FALLBACK_RELATED_SLUGS }),
  ]);
  const response =
    bundleResult.status === "fulfilled"
      ? bundleResult.value.discovery
      : { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1, hasMore: false } };
  const weeklyJobsPosted =
    bundleResult.status === "fulfilled" ? bundleResult.value.weeklyJobsPosted : 0;
  const relatedSlugs =
    relatedResult.status === "fulfilled" ? relatedResult.value : FALLBACK_RELATED_SLUGS;

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
      weeklyJobsPosted={weeklyJobsPosted}
      relatedSlugs={relatedSlugs}
      listingTop={listingTop}
      listingFaq={listingFaq}
    />
  );
}
