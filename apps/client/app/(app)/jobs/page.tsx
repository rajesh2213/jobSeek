import { auth } from "@clerk/nextjs/server";
import { fetchJobs } from "../../../lib/api";
import { jobsMetadata } from "../../../lib/seo";
import { JobsSearchPage } from "../../../components/job/JobsSearchPage";
import { parseJobFiltersFromSearch } from "../../../lib/slug-parser";

export const metadata = jobsMetadata({});

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JobsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const { getToken } = await auth();
  const token = await getToken();
  const response = await fetchJobs(
    {
      ...filters,
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
    },
    { token },
  );
  return <JobsSearchPage jobs={response.data} meta={response.meta} />;
}
