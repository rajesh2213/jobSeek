import type { Company } from "@prisma/client";
import type { CompanyService } from "../modules/company/company.service.js";
import type { JobWithCompany } from "../modules/job/job.repository.js";
import type { JobWithCompanyRow } from "../modules/job/job.mapper.js";
import { toJobListJson } from "../modules/job/job.mapper.js";
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

function parsePageLimit(
  raw: Record<string, unknown>,
  defaults: { defaultLimit: number; maxLimit: number },
): { page: number; limit: number } {
  const pageRaw = raw.page;
  const limitRaw = raw.limit;
  const page =
    typeof pageRaw === "string" || typeof pageRaw === "number"
      ? Math.max(1, parseInt(String(pageRaw), 10) || 1)
      : 1;
  const limit =
    typeof limitRaw === "string" || typeof limitRaw === "number"
      ? Math.min(
          defaults.maxLimit,
          Math.max(1, parseInt(String(limitRaw), 10) || defaults.defaultLimit),
        )
      : defaults.defaultLimit;
  return { page, limit };
}

export type CompanyJobsHttpParityResult =
  | { status: 429; body: ApiError }
  | {
      status: 200;
      payload: {
        data: ReturnType<typeof toJobListJson>[];
        meta: MeteredJobsListMeta & {
          company: {
            id: string;
            name: string;
            slug: string;
            domain: string | null;
          };
        };
      };
    };

/**
 * Same logic as GET /company/:slug/jobs — shared by Fastify route and SSR unified callers.
 */
export async function executeMeteredCompanyJobsHttpParity(args: {
  companyService: CompanyService;
  company: Company;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}): Promise<CompanyJobsHttpParityResult> {
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
  const { page, limit } = parsePageLimit(q, { defaultLimit: 50, maxLimit: 100 });
  const filterQuery = { ...q, page: undefined, limit: undefined };
  const parsed = parseJobDiscoveryQuery(filterQuery);
  delete parsed.companyId;

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

  const exists = args.company;

  const out = await runMeteredJobsList<JobWithCompany>(
    prisma,
    redis,
    capCtx,
    bypassCap,
    {
      page,
      limit,
      fetchList: async (effectiveLimit) => {
        const bundle = await args.companyService.getCompanyJobsForCompany(exists, {
          page,
          limit: effectiveLimit,
          filters: parsed,
          sort,
          includeProcessing,
        });
        return bundle.jobs;
      },
    },
  );

  return {
    status: 200,
    payload: {
      data: out.items.map((j) =>
        toJobListJson(j as unknown as JobWithCompanyRow),
      ),
      meta: {
        ...out.meta,
        company: {
          id: exists.id,
          name: exists.name,
          slug: exists.slug,
          domain: exists.domain,
        },
      },
    },
  };
}

export async function getCompanyBySlugShared(
  companyService: CompanyService,
  slug: string,
): Promise<Company | null> {
  return companyService.getCompanyBySlug(slug);
}

export { getSharedCompanyService } from "./serverServices.shared.js";
