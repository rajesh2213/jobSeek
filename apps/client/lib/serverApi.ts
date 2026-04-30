import "server-only";

/**
 * SSR imports `@jobseek/server` and uses the same Prisma + Redis singletons as the Fastify API,
 * but inside the **Next.js server process**. Env must be present here — not only on `jobseek-api`:
 *
 * - `DATABASE_URL` — Prisma (missing → connection errors / crashes at import or query time)
 * - `REDIS_URL` — metering / rate limits (`getIoredis()` throws if absent)
 * - `INTERNAL_SEO_SECRET` — when discovery lists pass internal SEO bypass headers
 * - Clerk / JWT-related vars required by shared auth + view-cap code paths
 *
 * Validate on the host that runs `next start` (or equivalent), e.g. same checks as API:
 * `echo "$DATABASE_URL"`, `echo "$REDIS_URL"` — empty means latent prod failures with **no** HTTP edge.
 */

import type { JobFilters } from "./slug-parser";
import type {
  JobsApiResponse,
  JobDetailFetchResult,
  CompanyDetail,
  JobItem,
} from "./api";
import {
  fetchJobs,
  fetchJobById,
  fetchCompanyJobs,
  fetchCompanyBySlug,
  jobFiltersToDiscoveryQueryRecord,
  isJobReady,
} from "./api";

function logSsrDataSource(route: string, source: "direct_db" | "http_api"): void {
  if (process.env.DEBUG_SSR_DATA_SOURCE !== "1") return;
  console.info(JSON.stringify({ event: "ssr_data_source", route, source }));
}

/** Normalize unexpected DB/Redis/service failures so SSR resembles `fetch()` failures (`Failed to fetch …`). */
function rethrowDirectDbFailure(route: string, err: unknown): never {
  if (err instanceof Error && err.message.includes("429 Too Many Requests")) {
    throw err;
  }
  const detail = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(`Failed to fetch ${route}: ${detail}`);
  (wrapped as Error & { cause?: unknown }).cause = err;
  throw wrapped;
}

function buildUpstreamHeaders(opts: {
  token?: string | null;
  forwardedFor?: string | null;
  internalSeoSecret?: string | null;
}): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  const t = opts.token?.trim();
  if (t) headers.authorization = `Bearer ${t}`;
  const ff = opts.forwardedFor?.trim();
  if (ff) headers["x-forwarded-for"] = ff;
  const secret = opts.internalSeoSecret?.trim();
  if (secret) {
    headers["x-internal-seo"] = "true";
    headers["x-internal-seo-secret"] = secret;
  }
  return headers;
}

/** Same metering path as GET /jobs — SSR uses shared server executor; browser uses HTTP. */
export async function listJobsUnified(
  filters: JobFilters = {},
  opts?: {
    token?: string | null;
    internalSeoSecret?: string | null;
    forwardedFor?: string | null;
    ssrPage?: string;
  },
): Promise<JobsApiResponse> {
  if (typeof window !== "undefined") {
    logSsrDataSource("/jobs", "http_api");
    return fetchJobs(filters, opts);
  }

  logSsrDataSource("/jobs", "direct_db");
  try {
    const query = jobFiltersToDiscoveryQueryRecord(filters, { includeCompanyId: true });
    const jobShared = await import("@jobseek/server/shared/job.shared");
    const jobService = jobShared.getSharedJobService();
    const result = await jobShared.executeMeteredJobsListHttpParity({
      jobService,
      query,
      headers: buildUpstreamHeaders({
        token: opts?.token,
        forwardedFor: opts?.forwardedFor,
        internalSeoSecret: opts?.internalSeoSecret,
      }),
    });

    if (result.status === 429) {
      throw new Error("Failed to fetch jobs: 429 Too Many Requests");
    }

    const payload = result.payload;
    return {
      ...payload,
      data: ((payload.data ?? []) as unknown as JobItem[]).filter(isJobReady),
    } as JobsApiResponse;
  } catch (err) {
    // Regional DB/Redis issues in SSR should not blank discovery; fall back to API route.
    try {
      logSsrDataSource("/jobs", "http_api");
      return await fetchJobs(filters, opts);
    } catch {
      rethrowDirectDbFailure("/jobs", err);
    }
  }
}

/** Same caps/rate-limit path as GET /jobs/:id — SSR uses shared executor; browser uses HTTP. */
export async function getJobByIdUnified(
  id: string,
  opts?: { token?: string | null; forwardedFor?: string | null },
): Promise<JobDetailFetchResult | null> {
  if (typeof window !== "undefined") {
    logSsrDataSource("/jobs/:id", "http_api");
    return fetchJobById(id, opts);
  }

  logSsrDataSource("/jobs/:id", "direct_db");
  try {
    const jobShared = await import("@jobseek/server/shared/job.shared");
    const jobService = jobShared.getSharedJobService();
    const result = await jobShared.executeJobDetailHttpParity({
      jobService,
      jobId: id,
      query: {},
      headers: buildUpstreamHeaders({
        token: opts?.token,
        forwardedFor: opts?.forwardedFor,
      }),
    });

    if (result.status === 429) {
      throw new Error(`Failed to fetch job ${id}: 429 Too Many Requests`);
    }
    if (result.status === 404) {
      return null;
    }

    const body = result.body as JobDetailFetchResult;
    return body;
  } catch (err) {
    rethrowDirectDbFailure(`/jobs/${id}`, err);
  }
}

/** GET /company/:slug — SSR reads DB via CompanyService; browser uses HTTP. */
export async function getCompanyBySlugUnified(slug: string): Promise<CompanyDetail | null> {
  if (typeof window !== "undefined") {
    logSsrDataSource("/company/:slug", "http_api");
    return fetchCompanyBySlug(slug);
  }

  logSsrDataSource("/company/:slug", "direct_db");
  try {
    const companyShared = await import("@jobseek/server/shared/company.shared");
    const companyService = companyShared.getSharedCompanyService();
    const row = await companyShared.getCompanyBySlugShared(companyService, slug);
    return row as unknown as CompanyDetail;
  } catch (err) {
    rethrowDirectDbFailure(`/company/${slug}`, err);
  }
}

/** GET /company/:slug/jobs — metered list parity; SSR uses shared executor. */
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
  if (typeof window !== "undefined") {
    logSsrDataSource("/company/:slug/jobs", "http_api");
    return fetchCompanyJobs(slug, options);
  }

  logSsrDataSource("/company/:slug/jobs", "direct_db");
  try {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const merged: JobFilters = {
      ...(options.filters ?? {}),
      page,
      limit,
      companyId: undefined,
    };
    const query = jobFiltersToDiscoveryQueryRecord(merged, { includeCompanyId: false });

    const companyShared = await import("@jobseek/server/shared/company.shared");
    const companyService = companyShared.getSharedCompanyService();
    const exists = await companyShared.getCompanyBySlugShared(companyService, slug);
    if (!exists) {
      return {
        data: [],
        meta: {
          page: 1,
          pageSize: limit,
          total: 0,
          totalPages: 1,
          hasMore: false,
        },
      };
    }

    const result = await companyShared.executeMeteredCompanyJobsHttpParity({
      companyService,
      company: exists,
      query,
      headers: buildUpstreamHeaders({
        token: options.token,
        forwardedFor: options.forwardedFor,
      }),
    });

    if (result.status === 429) {
      throw new Error("Failed to fetch company jobs: 429 Too Many Requests");
    }

    const payload = result.payload;
    return {
      ...payload,
      data: ((payload.data ?? []) as unknown as JobItem[]).filter(isJobReady),
    } as JobsApiResponse;
  } catch (err) {
    rethrowDirectDbFailure(`/company/${slug}/jobs`, err);
  }
}
