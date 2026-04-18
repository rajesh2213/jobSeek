import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchJobs, type JobsApiResponse } from "./api";
import {
  type JobFilters,
  MAX_JOB_FILTER_QUERY_TOKENS,
} from "./slug-parser";

/** Deterministic key so React `cache()` dedupes metadata + page in one navigation. */
export function stableJobFiltersKey(filters: JobFilters): string {
  const keys = Object.keys(filters).sort() as (keyof JobFilters)[];
  const sorted: Record<string, unknown> = {};
  for (const k of keys) {
    const v = filters[k];
    if (k === "skills" && Array.isArray(v)) {
      sorted[k] = v.slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
    } else if (k === "locations" && Array.isArray(v)) {
      sorted[k] = v.slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
    } else if (k === "roles" && Array.isArray(v)) {
      sorted[k] = v.slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
    } else if (k === "categories" && Array.isArray(v)) {
      sorted[k] = v.slice(0, MAX_JOB_FILTER_QUERY_TOKENS);
    } else {
      sorted[k as string] = v;
    }
  }
  return JSON.stringify(sorted);
}

/**
 * One `GET /jobs` per request for a given filter set (shared by `generateMetadata` and page RSC).
 */
export const loadJobsDiscoveryPage = cache(
  async (filtersKey: string): Promise<JobsApiResponse> => {
    const filters = JSON.parse(filtersKey) as JobFilters;
    const { getToken } = await auth();
    const token = await getToken();
    return fetchJobs(
      {
        ...filters,
        page: filters.page ?? 1,
        limit: filters.limit ?? 20,
      },
      { token },
    );
  },
);
