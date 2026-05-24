import type { ReactNode } from "react";
import { Suspense } from "react";
import type { JobItem, JobsApiResponse } from "../../lib/api";
import { JobsSearchClient } from "./JobsSearchClient";
import { JobsShellSkeleton } from "./JobsShellSkeleton";

const FALLBACK_RELATED_SLUGS = [
  "role/react-developer/location/remote",
  "role/salesforce-specialist/location/us",
  "role/marketing-manager/location/remote",
];

interface Props {
  jobs: JobItem[];
  meta?: JobsApiResponse["meta"];
  weeklyJobsPosted?: number;
  relatedSlugs?: string[];
  listingTop?: ReactNode;
  /** Market insights sidebar (SEO landing pages, desktop beside results). */
  listingSidebar?: ReactNode;
  /** Slug path for client-side sidebar hydration when SSR omitted the sidebar. */
  seoAggregationFiltersSlug?: string;
  /** FAQ block rendered below job results (above related searches). */
  listingFaq?: ReactNode;
  /** SEO enrichment below job list + load more (e.g. top companies, trending skills). */
  listingAfterResults?: ReactNode;
}

export function JobsSearchPage({
  jobs,
  meta,
  weeklyJobsPosted,
  relatedSlugs = FALLBACK_RELATED_SLUGS,
  listingTop,
  listingSidebar,
  seoAggregationFiltersSlug,
  listingFaq,
  listingAfterResults,
}: Props) {
  /* B1: Suspense wraps client subtree for progressive hydration; listing rows remain in SSR props. */
  return (
    <Suspense fallback={<JobsShellSkeleton />}>
      <JobsSearchClient
        jobs={jobs}
        meta={meta}
        weeklyJobsPosted={weeklyJobsPosted}
        relatedSlugs={relatedSlugs}
        listingTop={listingTop}
        listingSidebar={listingSidebar}
        seoAggregationFiltersSlug={seoAggregationFiltersSlug}
        listingFaq={listingFaq}
        listingAfterResults={listingAfterResults}
      />
    </Suspense>
  );
}
