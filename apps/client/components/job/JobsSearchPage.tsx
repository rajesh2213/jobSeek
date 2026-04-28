import type { ReactNode } from "react";
import { Suspense } from "react";
import type { JobItem, JobsApiResponse } from "../../lib/api";
import { JobsSearchClient } from "./JobsSearchClient";
import { JobsShellSkeleton } from "./JobsShellSkeleton";
import { EmailCaptureCard } from "../email/EmailCaptureCard";

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
  /** FAQ block rendered below job results (above related searches). */
  listingFaq?: ReactNode;
}

export function JobsSearchPage({
  jobs,
  meta,
  weeklyJobsPosted,
  relatedSlugs = FALLBACK_RELATED_SLUGS,
  listingTop,
  listingFaq,
}: Props) {
  return (
    <Suspense fallback={<JobsShellSkeleton />}>
      <div className="mx-auto mt-4 max-w-[1200px] px-4 sm:px-6">
        <EmailCaptureCard
          source="jobs_listing"
          title="Don't miss new jobs"
          subtitle="Get top roles daily in your inbox."
        />
      </div>
      <JobsSearchClient
        jobs={jobs}
        meta={meta}
        weeklyJobsPosted={weeklyJobsPosted}
        relatedSlugs={relatedSlugs}
        listingTop={listingTop}
        listingFaq={listingFaq}
      />
    </Suspense>
  );
}
