import "server-only";

import type { JobFilters } from "./slug-parser";
import type {
  JobsApiResponse,
  JobDetailFetchResult,
  CompanyDetail,
} from "./api";
import {
  fetchJobs,
  fetchJobById,
  fetchCompanyJobs,
  fetchCompanyBySlug,
} from "./api";

function logSsrDataSource(route: string, source: "http_api"): void {
  if (process.env.DEBUG_SSR_DATA_SOURCE !== "1") return;
  console.info(JSON.stringify({ event: "ssr_data_source", route, source }));
}

/** Unified path for SSR + browser: always go through HTTP API. */
export async function listJobsUnified(
  filters: JobFilters = {},
  opts?: {
    token?: string | null;
    internalSeoSecret?: string | null;
    forwardedFor?: string | null;
    ssrPage?: string;
  },
): Promise<JobsApiResponse> {
  if (typeof window === "undefined") {
    logSsrDataSource("/jobs", "http_api");
  }
  return fetchJobs(filters, opts);
}

/** Unified path for SSR + browser: always go through HTTP API. */
export async function getJobByIdUnified(
  id: string,
  opts?: { token?: string | null; forwardedFor?: string | null },
): Promise<JobDetailFetchResult | null> {
  if (typeof window === "undefined") {
    logSsrDataSource("/jobs/:id", "http_api");
  }
  return fetchJobById(id, opts);
}

/** Unified path for SSR + browser: always go through HTTP API. */
export async function getCompanyBySlugUnified(slug: string): Promise<CompanyDetail | null> {
  if (typeof window === "undefined") {
    logSsrDataSource("/company/:slug", "http_api");
  }
  return fetchCompanyBySlug(slug);
}

/** Unified path for SSR + browser: always go through HTTP API. */
export async function getCompanyJobsUnified(
  slug: string,
  options: {
    page?: number;
    limit?: number;
    filters?: Omit<JobFilters, "companyId">;
    token?: string | null;
    forwardedFor?: string | null;
    ssrPage?: string;
  } = {},
): Promise<JobsApiResponse> {
  if (typeof window === "undefined") {
    logSsrDataSource("/company/:slug/jobs", "http_api");
  }
  return fetchCompanyJobs(slug, options);
}
