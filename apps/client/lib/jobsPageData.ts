import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { fetchJobById, fetchJobs, type JobDetailFetchResult, type JobsApiResponse } from "./api";
import {
  type JobFilters,
  MAX_JOB_FILTER_QUERY_TOKENS,
} from "./slug-parser";

/** Sync read for SSR hero strip — avoids API when ops pins `JOBS_WEEKLY_POSTED_OVERRIDE`. */
export function weeklyJobsPostedEnvOverride(): number | null {
  const raw = process.env.JOBS_WEEKLY_POSTED_OVERRIDE?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

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
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
    return fetchJobs(
      {
        ...filters,
        page: filters.page ?? 1,
        limit: filters.limit ?? 20,
      },
      {
        token,
        forwardedFor,
        // Do not send internal SEO bypass: user-facing discovery must mirror browser `fetchJobs`
        // (metering + `viewCapUnlimited`). Bypass here hid the quota strip on first paint and let
        // cached “unlimited” meta diverge from the first real client request (e.g. load more → 0/75
        // when the IP bucket was already exhausted). Keep bypass for non-listing SSR (e.g. weekly count).
      },
    );
  },
);

/** Real weekly posted jobs count used by jobs hero stats strip. */
export const loadWeeklyJobsPostedCount = cache(async (): Promise<number> => {
  const override = weeklyJobsPostedEnvOverride();
  if (override !== null) return override;

  const { getToken } = await auth();
  const token = await getToken();
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  const response = await fetchJobs(
    {
      posted: "1w",
      page: 1,
      limit: 1,
      sort: "latest",
    },
    {
      token,
      forwardedFor,
      internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
    },
  );
  const total = Number(response.meta?.total ?? 0);
  return Number.isFinite(total) && total >= 0 ? Math.round(total) : 0;
});

/** Starts listing fetch only. Related SEO slugs come from client `JobsSearchClient` (fetchSeoLandingPages). */
export function loadJobsListingDeferred(input: {
  filtersKey: string;
}): {
  jobsDataPromise: Promise<JobsApiResponse>;
} {
  const jobsDataPromise = loadJobsDiscoveryPage(input.filtersKey);
  return { jobsDataPromise };
}

/**
 * One fetch per request for a given job ID (shared by `generateMetadata` and page RSC).
 *
 * Mirrors the `loadJobsDiscoveryPage` deduplication pattern.  Without this wrapper both
 * `generateMetadata` and the page component independently call `auth()` + `fetchJobById`,
 * doubling the Clerk session resolution AND the upstream Fastify round-trip on every SSR.
 * React `cache()` deduplicates by argument identity within a single server render so the
 * second call is a no-op lookup.
 *
 * `fetchJobById` itself applies two-tier caching internally: ISR (5 min) for anonymous
 * traffic, `no-store` for authenticated requests — so metering is preserved.
 */
export const loadJobDetailPage = cache(
  async (id: string): Promise<JobDetailFetchResult | null> => {
    const { getToken } = await auth();
    const token = await getToken();
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
    return fetchJobById(id, { token, forwardedFor });
  },
);
