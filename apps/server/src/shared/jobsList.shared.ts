import type { JobService } from "../modules/job/job.service.js";
import type { JobWithCompany } from "../modules/job/job.repository.js";
import {
  toJobListJson,
  type JobWithCompanyRow,
} from "../modules/job/job.mapper.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { getIoredis } from "../queues/job.queue.js";
import { parseJobDiscoveryQuery } from "../utils/taxonomyQuery.js";
import {
  runMeteredJobsList,
  buildCapContextFromAuthorizationForwarded,
  isViewCapBypassFromParts,
  type MeteredJobsListMeta,
} from "../modules/viewCap/jobListCap.js";
import { assertJobReadRateLimit } from "../modules/viewCap/rateLimitRedis.js";
import type { ApiError } from "../types/api.js";

function parseQueryBool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "1";
}

function headerFirst(
  v: string | string[] | undefined,
): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function clientIpFromForwardedHeaders(forwardedFor: string | null | undefined): string {
  const raw =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : undefined;
  return raw ?? "unknown";
}

export type MeteredJobsListReplyHints = {
  isSafeToCache: boolean;
  meteredLimit: number;
  page: number;
  bypassCap: boolean;
  capApplied: boolean;
  hasAuthHeader: boolean;
  cacheBypassReason: string;
};

export type MeteredJobsListHttpParityResult =
  | { status: 429; body: ApiError }
  | {
      status: 200;
      payload: {
        data: ReturnType<typeof toJobListJson>[];
        meta: MeteredJobsListMeta;
      };
      replyHints: MeteredJobsListReplyHints;
    };

/**
 * Same logic as GET /jobs — shared by Fastify route and Next.js SSR unified callers.
 */
export async function executeMeteredJobsListHttpParity(args: {
  jobService: JobService;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}): Promise<MeteredJobsListHttpParityResult> {
  const redis = getIoredis();
  const forwardedRaw = headerFirst(args.headers["x-forwarded-for"]);
  const ip = clientIpFromForwardedHeaders(forwardedRaw ?? null);
  const rl = await assertJobReadRateLimit(redis, ip);
  if (!rl.ok) {
    return {
      status: 429,
      body: {
        error: "Too many requests",
        code: "RATE_LIMIT",
      } satisfies ApiError,
    };
  }

  const q = args.query;
  const pageRaw = q.page;
  const limitRaw = q.limit;
  const offsetRaw = q.offset;
  const page =
    typeof pageRaw === "string" || typeof pageRaw === "number"
      ? Math.max(1, parseInt(String(pageRaw), 10) || 1)
      : 1;
  const limit =
    typeof limitRaw === "string" || typeof limitRaw === "number"
      ? Math.min(100, Math.max(1, parseInt(String(limitRaw), 10) || 20))
      : 20;
  const offset =
    typeof offsetRaw === "string" || typeof offsetRaw === "number"
      ? Math.max(0, parseInt(String(offsetRaw), 10) || 0)
      : undefined;

  const filters = parseJobDiscoveryQuery(q);
  const sortRaw = String(q.sort ?? "latest");
  const sort: "latest" | "salary_desc" =
    sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";
  const includeProcessing = parseQueryBool(q.includeProcessing);

  const bypassCap = isViewCapBypassFromParts(args.headers, q);
  const authorization = headerFirst(args.headers.authorization);
  const capCtx = await buildCapContextFromAuthorizationForwarded(
    prisma,
    authorization,
    forwardedRaw ?? null,
    undefined,
  );

  const hasAuthHeader = typeof authorization === "string";
  const isAnonymous = capCtx.internalUserId == null && !hasAuthHeader;

  const isCommonFilterQuery = Boolean(
    filters.category ||
      (filters.skills && filters.skills.length > 0) ||
      filters.role,
  );

  const isHeavyQuery = Boolean(
    filters.companyId ||
      filters.minSalary !== undefined ||
      filters.experienceLevel ||
      filters.postedWithin ||
      sortRaw !== "latest",
  );

  const isDeepPagination = page > 5;

  const isSafeToCache =
    isAnonymous &&
    isCommonFilterQuery &&
    !isHeavyQuery &&
    !isDeepPagination;

  const meteredLimit = isSafeToCache ? Math.min(limit, 50) : limit;

  const out = await runMeteredJobsList<JobWithCompany>(
    prisma,
    redis,
    capCtx,
    bypassCap,
    {
      page,
      limit: meteredLimit,
      offset,
      fetchList: (effectiveLimit) =>
        args.jobService.list({
          page,
          limit: effectiveLimit,
          offset,
          filters,
          sort,
          includeProcessing,
        }),
    },
  );

  const cacheableJobsList = false;
  const cacheBypassReason = cacheableJobsList
    ? "anonymous_public_listing"
    : capCtx.internalUserId != null || hasAuthHeader
      ? "authenticated_request"
      : "metered_or_personalized";

  const capApplied = Boolean(!bypassCap && !out.meta.viewCapUnlimited);

  return {
    status: 200,
    payload: {
      data: out.items.map((j) =>
        toJobListJson(j as unknown as JobWithCompanyRow),
      ),
      meta: out.meta,
    },
    replyHints: {
      isSafeToCache,
      meteredLimit,
      page,
      bypassCap,
      capApplied,
      hasAuthHeader,
      cacheBypassReason,
    },
  };
}
