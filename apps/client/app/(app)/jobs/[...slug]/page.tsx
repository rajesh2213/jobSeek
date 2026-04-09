import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { fetchJobs } from "../../../../lib/api";
import { JobsSearchPage } from "../../../../components/job/JobsSearchPage";
import { parseSlug, parseJobFiltersFromSearch } from "../../../../lib/slug-parser";
import { jobsMetadata } from "../../../../lib/seo";

interface Props {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  return jobsMetadata({ ...parseSlug(slug), ...parseJobFiltersFromSearch(sp) });
}

export default async function JobsSeoPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const filters = { ...parseSlug(slug), ...parseJobFiltersFromSearch(sp) };
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
