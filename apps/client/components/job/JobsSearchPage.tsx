import type { ReactNode } from "react";
import { Suspense } from "react";
import type { JobItem, JobsApiResponse } from "../../lib/api";
import { JobsSearchClient } from "./JobsSearchClient";
import { JobsShellSkeleton } from "./JobsShellSkeleton";

const FALLBACK_RELATED_SLUGS = [
  "engineering-react-nodejs-us-remote",
  "sales-salesforce-us",
  "marketing-remote",
];

interface Props {
  jobs: JobItem[];
  meta?: JobsApiResponse["meta"];
  relatedSlugs?: string[];
  listingTop?: ReactNode;
  /** FAQ block rendered below job results (above related searches). */
  listingFaq?: ReactNode;
}

export function JobsSearchPage({
  jobs,
  meta,
  relatedSlugs = FALLBACK_RELATED_SLUGS,
  listingTop,
  listingFaq,
}: Props) {
  return (
    <Suspense fallback={<JobsShellSkeleton />}>
      <JobsSearchClient
        jobs={jobs}
        meta={meta}
        relatedSlugs={relatedSlugs}
        listingTop={listingTop}
        listingFaq={listingFaq}
      />
    </Suspense>
  );
}
