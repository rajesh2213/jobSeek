import { Suspense } from "react";
import type { JobItem, JobsApiResponse } from "../../lib/api";
import { JobsSearchClient } from "./JobsSearchClient";
import { JobsShellSkeleton } from "./JobsShellSkeleton";

const RELATED_SLUGS = [
  "engineering-react-nodejs-us-remote",
  "sales-salesforce-us",
  "marketing-remote",
];

interface Props {
  jobs: JobItem[];
  meta?: JobsApiResponse["meta"];
}

export function JobsSearchPage({ jobs, meta }: Props) {
  return (
    <Suspense fallback={<JobsShellSkeleton />}>
      <JobsSearchClient jobs={jobs} meta={meta} relatedSlugs={RELATED_SLUGS} />
    </Suspense>
  );
}
