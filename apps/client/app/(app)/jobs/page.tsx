import type { Metadata } from "next";
import {
  loadJobsDiscoveryPage,
  loadJobsListingDeferred,
  loadWeeklyJobsPostedCount,
  stableJobFiltersKey,
} from "../../../lib/jobsPageData";
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
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters));
  return jobsRouteMetadata(filters, {
    canonicalPath: getCanonicalJobListingUrl(filters),
    total: response.meta?.total ?? undefined,
  });
}

export default async function JobsPage({ searchParams }: Props) {
  const pageStart = Date.now();
  console.log("SSR_START_jobs", pageStart);
  console.log("STEP_searchParams_start_jobs", Date.now() - pageStart);
  const sp = await searchParams;
  console.log("STEP_searchParams_end_jobs", Date.now() - pageStart);
  console.log("STEP_parseFilters_start_jobs", Date.now() - pageStart);
  const filters = parseJobFiltersFromSearch(sp);
  console.log("STEP_parseFilters_end_jobs", Date.now() - pageStart);
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

  const { jobsDataPromise } = loadJobsListingDeferred({
    filtersKey,
    currentSlug,
    fallbackRelatedSlugs: FALLBACK_RELATED_SLUGS,
  });
  const jobsStart = Date.now();
  const response = await jobsDataPromise;
  console.log("SSR_jobs_fetch_ms", Date.now() - jobsStart);
  const weeklyJobsPosted = await loadWeeklyJobsPostedCount();

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

  console.log("SSR_TOTAL_jobs_ms", Date.now() - pageStart);
  return (
    <JobsSearchPage
      jobs={response.data}
      meta={response.meta}
      weeklyJobsPosted={weeklyJobsPosted}
      relatedSlugs={FALLBACK_RELATED_SLUGS}
      listingTop={listingTop}
      listingFaq={listingFaq}
    />
  );
}
