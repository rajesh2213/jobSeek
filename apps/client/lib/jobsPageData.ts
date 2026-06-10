import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import {
  fetchCompanies,
  fetchCompanyBySlug,
  fetchCompanyJobs,
  fetchJobById,
  fetchJobs,
  type CompanyDetail,
  type CompanyListItem,
  type JobDetailFetchResult,
  type JobItem,
  type JobsApiResponse,
} from "./api";
import {
  hasClerkSessionCookie,
  ssrCompanyJobsEnabled,
  usePublicSeoLoaders,
} from "./ssrAuthMode";
import {
  type JobFilters,
  MAX_JOB_FILTER_QUERY_TOKENS,
} from "./slug-parser";

export const EMPTY_JOBS_RESPONSE: JobsApiResponse = { data: [] };

/** Stay under Vercel/nginx ~10s SSR budget so we degrade instead of throwing. */
function ssrUpstreamTimeoutMs(): number {
  const raw = process.env.SSR_UPSTREAM_TIMEOUT_MS?.trim();
  if (!raw) return 8500;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 8500;
  return Math.max(3000, Math.min(parsed, 9000));
}

async function withSsrUpstreamTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ssrUpstreamTimeoutMs());
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

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

const loadJobsDiscoveryPageAuthenticated = cache(
  async (filtersKey: string): Promise<JobsApiResponse> => {
    try {
      const filters = JSON.parse(filtersKey) as JobFilters;
      const { getToken } = await auth();
      const token = await getToken();
      const h = await headers();
      const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
      return await withSsrUpstreamTimeout((signal) =>
        fetchJobs(
          {
            ...filters,
            page: filters.page ?? 1,
            limit: filters.limit ?? 20,
          },
          {
            token,
            forwardedFor,
            signal,
            ssrPage: "jobs",
          },
        ),
      );
    } catch {
      return EMPTY_JOBS_RESPONSE;
    }
  },
);

/** SEO / crawler listing SSR — internal bypass, no per-visitor IP (ISR-safe shared cache). */
const loadJobsDiscoveryPagePublic = cache(
  async (filtersKey: string): Promise<JobsApiResponse> => {
    try {
      const filters = JSON.parse(filtersKey) as JobFilters;
      return await withSsrUpstreamTimeout((signal) =>
        fetchJobs(
          {
            ...filters,
            page: filters.page ?? 1,
            limit: filters.limit ?? 20,
          },
          {
            internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
            signal,
            ssrPage: "jobs-seo",
          },
        ),
      );
    } catch {
      return EMPTY_JOBS_RESPONSE;
    }
  },
);

/**
 * One `GET /jobs` per request for a given filter set (shared by `generateMetadata` and page RSC).
 */
export const loadJobsDiscoveryPage = cache(
  async (filtersKey: string): Promise<JobsApiResponse> => {
    if (usePublicSeoLoaders() && !(await hasClerkSessionCookie())) {
      return loadJobsDiscoveryPagePublic(filtersKey);
    }
    return loadJobsDiscoveryPageAuthenticated(filtersKey);
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

const loadJobDetailPageAuthenticated = cache(
  async (id: string): Promise<JobDetailFetchResult | null> => {
    const { getToken } = await auth();
    const token = await getToken();
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
    return await withSsrUpstreamTimeout((signal) =>
      fetchJobById(id, { token, forwardedFor, signal }),
    );
  },
);

/** Anon job detail — no `x-forwarded-for` so Next Data Cache shares one entry per job id. */
const loadJobDetailPagePublic = cache(
  async (id: string): Promise<JobDetailFetchResult | null> => {
    return await withSsrUpstreamTimeout((signal) =>
      fetchJobById(id, {
        signal,
        internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
      }),
    );
  },
);

/**
 * One fetch per request for a given job ID (shared by `generateMetadata` and page RSC).
 */
export const loadJobDetailPage = cache(
  async (id: string): Promise<JobDetailFetchResult | null> => {
    const hasSession = await hasClerkSessionCookie();
    if (usePublicSeoLoaders() && !hasSession) {
      try {
        return await loadJobDetailPagePublic(id);
      } catch {
        return null;
      }
    }
    try {
      return await loadJobDetailPageAuthenticated(id);
    } catch {
      try {
        return await loadJobDetailPagePublic(id);
      } catch {
        return null;
      }
    }
  },
);

/** Company hub SSR: never throw on upstream timeout/500. */
export const loadCompanyBySlug = cache(async (slug: string): Promise<CompanyDetail | null> => {
  try {
    return await withSsrUpstreamTimeout((signal) => fetchCompanyBySlug(slug, { signal }));
  } catch {
    return null;
  }
});

/** Related employers for company hub SSR (excludes current slug, requires open roles). */
export const loadRelatedCompanies = cache(
  async (slug: string): Promise<CompanyListItem[]> => {
    try {
      const res = await withSsrUpstreamTimeout((signal) =>
        fetchCompanies({
          limit: 12,
          sort: "jobs",
          hiring: true,
          ssrPage: "company-related",
          signal,
        }),
      );
      return res.data
        .filter((c) => c.slug !== slug && (c.jobCount ?? 0) > 0)
        .slice(0, 6);
    } catch {
      return [];
    }
  },
);

export interface CompanyHubInitialListing {
  jobs: JobItem[];
  meta: NonNullable<JobsApiResponse["meta"]>;
}

const emptyHubMeta = (limit: number): NonNullable<JobsApiResponse["meta"]> => ({
  page: 1,
  pageSize: limit,
  total: 0,
  totalPages: 1,
  hasMore: false,
});

const loadCompanyHubInitialJobsPublic = cache(
  async (
    slug: string,
    hubFiltersKey: string,
    limit: number,
  ): Promise<CompanyHubInitialListing> => {
    try {
      const filters = JSON.parse(hubFiltersKey) as Omit<JobFilters, "companyId">;
      const res = await withSsrUpstreamTimeout((signal) =>
        fetchCompanyJobs(slug, {
          page: 1,
          limit,
          filters: {
            ...filters,
            page: undefined,
            limit: undefined,
            offset: undefined,
          },
          internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
          signal,
          ssrPage: "company-seo",
        }),
      );
      const meta = res.meta ?? emptyHubMeta(limit);
      return { jobs: res.data, meta };
    } catch {
      return { jobs: [], meta: emptyHubMeta(limit) };
    }
  },
);

const loadCompanyHubInitialJobsAuthenticated = cache(
  async (
    slug: string,
    hubFiltersKey: string,
    limit: number,
  ): Promise<CompanyHubInitialListing> => {
    try {
      const filters = JSON.parse(hubFiltersKey) as Omit<JobFilters, "companyId">;
      const { getToken } = await auth();
      const token = await getToken();
      const h = await headers();
      const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
      const res = await withSsrUpstreamTimeout((signal) =>
        fetchCompanyJobs(slug, {
          page: 1,
          limit,
          filters: {
            ...filters,
            page: undefined,
            limit: undefined,
            offset: undefined,
          },
          token,
          forwardedFor,
          signal,
          ssrPage: "company",
        }),
      );
      const meta = res.meta ?? emptyHubMeta(limit);
      return { jobs: res.data, meta };
    } catch {
      return { jobs: [], meta: emptyHubMeta(limit) };
    }
  },
);

/** First page of company jobs for SSR (crawlers + first paint). */
export const loadCompanyHubInitialJobs = cache(
  async (
    slug: string,
    hubFiltersKey: string,
    limit: number,
  ): Promise<CompanyHubInitialListing> => {
    if (!ssrCompanyJobsEnabled()) {
      return { jobs: [], meta: emptyHubMeta(limit) };
    }
    if (usePublicSeoLoaders() && !(await hasClerkSessionCookie())) {
      return loadCompanyHubInitialJobsPublic(slug, hubFiltersKey, limit);
    }
    return loadCompanyHubInitialJobsAuthenticated(slug, hubFiltersKey, limit);
  },
);
