import { Suspense } from "react";
import type { CompanyDetail, CompanyListItem, JobItem, JobsApiResponse } from "../../lib/api";
import { CompanyHubClient } from "./CompanyHubClient";
import { CompanyHubSkeleton } from "./CompanyHubSkeleton";

interface Props {
  company: CompanyDetail;
  slug: string;
  initialJobs: JobItem[];
  initialMeta: NonNullable<JobsApiResponse["meta"]>;
  relatedCompanies: CompanyListItem[];
}

export function CompanyHubPage(props: Props) {
  return (
    <Suspense fallback={<CompanyHubSkeleton />}>
      <CompanyHubClient {...props} />
    </Suspense>
  );
}
