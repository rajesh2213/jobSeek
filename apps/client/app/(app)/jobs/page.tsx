import type { Metadata } from "next";
import {
  loadJobsDiscoveryPage,
  loadWeeklyJobsPostedCount,
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
  "engineering-react-nodejs-us-remote",
  "sales-salesforce-us",
  "marketing-remote",
];

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters));
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
    isRemote: filters.isRemote,
    workType: filters.workType,
  });

  const [response, relatedSlugs, weeklyJobsPosted] = await Promise.all([
    loadJobsDiscoveryPage(filtersKey),
    fetchJobsRelatedSlugs({ currentSlug, fallback: FALLBACK_RELATED_SLUGS }),
    loadWeeklyJobsPostedCount(),
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
      weeklyJobsPosted={weeklyJobsPosted}
      relatedSlugs={relatedSlugs}
      listingTop={listingTop}
      listingFaq={listingFaq}
    />
  );
}
