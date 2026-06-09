import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { toJobListJson, type JobWithCompanyRow } from "../job/job.mapper.js";
import { CompanyService } from "./company.service.js";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";
import type { ApiError } from "../../types/api.js";
import { getIoredis } from "../../queues/job.queue.js";
import { companyDisplayName } from "../../utils/companyDisplayName.js";
import {
  runMeteredJobsList,
  clientIp,
  isViewCapBypassRequest,
  buildCapContextFromRequest,
} from "../viewCap/jobListCap.js";
import { assertJobReadRateLimit } from "../viewCap/rateLimitRedis.js";
import {
  createCompanyBodySchema,
  getCompaniesQuerySchema,
  getCompanyJobsQuerySchema,
} from "./company.schema.js";
import type { CompaniesListingSort, CompanyListingRow } from "./companyListing.types.js";
import { isListingDegradedDbError } from "../../infrastructure/db/listingDegradedResponse.js";
import { readListingStale } from "../../infrastructure/cache/listingRedisCache.js";

const COMPANY_AGG_CACHE_ENABLED = process.env.COMPANY_AGG_CACHE_ENABLED !== "0";
const COMPANY_AGG_CACHE_TTL_SECONDS = Math.max(
  60,
  Number(process.env.COMPANY_AGG_CACHE_TTL_SECONDS ?? "120") || 120,
);
const DEBUG_COMPANY_CONCURRENCY = process.env.DEBUG_COMPANY_CONCURRENCY === "1";

type CompaniesAggResponseBody = {
  data: ReturnType<typeof toCompanyListingPublicJson>[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
    stats: {
      totalTracked: number;
      hiringThisWeek: number;
      activeHiringCompanies: number;
    };
  };
};

/** Coalesce concurrent anonymous cache misses for the same query (sitemap bursts, double-fetch). */
const inflightAnonymousCompanyAgg = new Map<string, Promise<CompaniesAggResponseBody>>();

function parseCompaniesSort(raw: unknown): CompaniesListingSort {
  const s = typeof raw === "string" ? raw : "jobs";
  if (s === "recent" || s === "name") return s;
  return "jobs";
}

function parseQueryBool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "1";
}

function setApiCacheHeader(
  reply: FastifyReply,
  request: FastifyRequest,
  input: { route: string; cacheable: boolean; reason: string },
): void {
  const value = input.cacheable
    ? "public, max-age=30, s-maxage=30"
    : "private, no-store";
  reply.header("Cache-Control", value);
  request.log.info(
    {
      event: "api_cache_status",
      route: input.route,
      method: request.method,
      cacheStatus: input.cacheable ? "HIT_ELIGIBLE" : "BYPASS",
      cacheControl: value,
      reason: input.reason,
    },
    "api_cache_status",
  );
}

function toCompanyListingPublicJson(row: CompanyListingRow) {
  return {
    id: row.id,
    name: companyDisplayName(row.name, row.domain),
    slug: row.slug,
    domain: row.domain,
    logoUrl: row.logoUrl,
    careersUrl: row.careersUrl,
    createdAt: row.createdAt.toISOString(),
    lastCrawledAt: row.lastCrawledAt?.toISOString() ?? null,
    jobCount: row.jobCount,
    hasRemoteJobs: row.hasRemoteJobs,
  };
}

interface CompanySlugParams {
  slug: string;
}

interface CreateCompanyBody {
  name: string;
  domain?: string;
  careersUrl?: string;
  atsBoardToken?: string;
  atsType?: string;
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

export function registerCompanyRoutes(
  server: FastifyInstance,
  companyService: CompanyService,
): void {
  server.get(
    "/companies",
    { schema: getCompaniesQuerySchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasAuthHeader = typeof request.headers.authorization === "string";
      const redis = getIoredis();
      setApiCacheHeader(reply, request, {
        route: "/companies",
        cacheable: !hasAuthHeader,
        reason: hasAuthHeader ? "authenticated_request" : "anonymous_public_listing",
      });
      const q = request.query as Record<string, unknown>;
      const { page, limit } = parsePageLimit(q, { defaultLimit: 20, maxLimit: 100 });
      const search = typeof q.q === "string" ? q.q : "";
      const sort = parseCompaniesSort(q.sort);
      const hiring = parseQueryBool(q.hiring);
      const remote = parseQueryBool(q.remote);
      const cacheKey = [
        "companies:agg:v2",
        page,
        limit,
        search.trim().toLowerCase(),
        sort,
        hiring ? "1" : "0",
        remote ? "1" : "0",
      ].join(":");
      try {
      const callerType =
        typeof request.headers["x-ssr-origin"] === "string"
          ? "internal_ssr"
          : "unknown";
      const ssrPage =
        typeof request.headers["x-ssr-page"] === "string"
          ? request.headers["x-ssr-page"]
          : null;
      if (!hasAuthHeader && COMPANY_AGG_CACHE_ENABLED) {
        const hit = await redis.get(cacheKey);
        if (hit) {
          const parsed = JSON.parse(hit) as CompaniesAggResponseBody;
          return reply.send(parsed);
        }

        let inflight = inflightAnonymousCompanyAgg.get(cacheKey);
        if (!inflight) {
          inflight = (async (): Promise<CompaniesAggResponseBody> => {
            try {
              const stats = await companyService.getListingStatsCached(redis);
              const result = await companyService.listCompaniesDiscovery(
                {
                  q: search,
                  sort,
                  hiring,
                  remote,
                  page,
                  limit,
                },
                { stats },
              );
              const body: CompaniesAggResponseBody = {
                data: result.items.map(toCompanyListingPublicJson),
                meta: {
                  page: result.page,
                  limit: result.limit,
                  total: result.total,
                  totalPages: result.totalPages,
                  hasMore: result.hasMore,
                  stats: result.stats,
                },
              };
              await redis
                .multi()
                .set(cacheKey, JSON.stringify(body), "EX", COMPANY_AGG_CACHE_TTL_SECONDS)
                .set(`${cacheKey}:stale`, JSON.stringify(body), "EX", 3600)
                .exec();
              return body;
            } finally {
              inflightAnonymousCompanyAgg.delete(cacheKey);
            }
          })();
          inflightAnonymousCompanyAgg.set(cacheKey, inflight);
        } else if (DEBUG_COMPANY_CONCURRENCY) {
          request.log.info(
            {
              event: "COMPANY_AGG_INFLIGHT_JOIN",
              route: "/companies",
              cacheKey,
              callerType,
              ssrPage,
              sitemap: ssrPage === "sitemap",
            },
            "COMPANY_AGG_INFLIGHT_JOIN",
          );
        }

        const responsePayload = await inflight;
        return reply.send(responsePayload);
      }

      const stats = await companyService.getListingStatsCached(redis);
      const result = await companyService.listCompaniesDiscovery(
        {
          q: search,
          sort,
          hiring,
          remote,
          page,
          limit,
        },
        { stats },
      );
      const responsePayload: CompaniesAggResponseBody = {
        data: result.items.map(toCompanyListingPublicJson),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
          hasMore: result.hasMore,
          stats: result.stats,
        },
      };
      return reply.send(responsePayload);
      } catch (err) {
        if (isListingDegradedDbError(err)) {
          const stale = await readListingStale<CompaniesAggResponseBody>(redis, cacheKey);
          if (stale?.data?.length) {
            request.log.warn(
              { event: "listing_stale_fallback", route: "/companies" },
              "listing_stale_fallback",
            );
            return reply.header("X-Listing-Cache", "stale").send(stale);
          }
        }
        throw err;
      }
    },
  );

  server.get<{ Params: CompanySlugParams }>(
    "/company/:slug/jobs",
    { schema: getCompanyJobsQuerySchema },
    async (
      request: FastifyRequest<{ Params: CompanySlugParams }>,
      reply: FastifyReply,
    ) => {
      const redis = getIoredis();
      const ip = clientIp(request);
      const rl = await assertJobReadRateLimit(redis, ip);
      if (!rl.ok) {
        return reply.status(429).send({
          error: "Too many requests",
          code: "RATE_LIMIT",
        } satisfies ApiError);
      }

      const q = request.query as Record<string, unknown>;
      const { page, limit } = parsePageLimit(q, { defaultLimit: 50, maxLimit: 100 });
      const filterQuery = { ...q, page: undefined, limit: undefined };
      const parsed = parseJobDiscoveryQuery(filterQuery);
      delete parsed.companyId;

      const sortRaw = String(q.sort ?? "latest");
      const sort: "latest" | "salary_desc" =
        sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";
      const includeProcessing = parseQueryBool(q.includeProcessing);
      const includeExactTotal = parseQueryBool(q.includeTotal);

      const slug = request.params.slug;
      const exists = await companyService.getCompanyBySlug(slug);
      if (!exists) {
        return reply.status(404).send({
          error: "Company not found",
          code: "COMPANY_NOT_FOUND",
        } satisfies ApiError);
      }

      const bypassCap = isViewCapBypassRequest(request);
      const capCtx = await buildCapContextFromRequest(server.prisma, request);
      setApiCacheHeader(reply, request, {
        route: "/company/:slug/jobs",
        cacheable: false,
        reason: "metered_company_listing",
      });

      const out = await runMeteredJobsList(server.prisma, redis, capCtx, bypassCap, {
        page,
        limit,
        fetchList: async (effectiveLimit) => {
          const bundle = await companyService.getCompanyJobs(slug, {
            page,
            limit: effectiveLimit,
            paginationStride: limit,
            filters: parsed,
            sort,
            includeProcessing,
            includeExactTotal: includeExactTotal || page > 1,
          });
          if (!bundle) {
            throw new Error("getCompanyJobs: company missing after existence check");
          }
          return bundle.jobs;
        },
      });

      return reply.send({
        data: out.items.map((j) =>
          toJobListJson(j as unknown as JobWithCompanyRow),
        ),
        meta: {
          ...out.meta,
          company: {
            id: exists.id,
            name: companyDisplayName(exists.name, exists.domain),
            slug: exists.slug,
            domain: exists.domain,
          },
        },
      });
    },
  );

  server.get<{ Params: CompanySlugParams }>(
    "/company/:slug",
    async (
      request: FastifyRequest<{ Params: CompanySlugParams }>,
      reply: FastifyReply,
    ) => {
      const company = await companyService.getCompanyPublicDetail(request.params.slug);
      if (!company) {
        return reply.status(404).send({
          error: "Company not found",
          code: "COMPANY_NOT_FOUND",
        } satisfies ApiError);
      }
      return reply.send({
        data: {
          ...company,
          name: companyDisplayName(company.name, company.domain),
          createdAt: company.createdAt.toISOString(),
          updatedAt: company.updatedAt.toISOString(),
          lastCrawledAt: company.lastCrawledAt?.toISOString() ?? null,
        },
      });
    },
  );

  server.post<{ Body: CreateCompanyBody }>(
    "/companies",
    { schema: createCompanyBodySchema },
    async (
      request: FastifyRequest<{ Body: CreateCompanyBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const company = await companyService.create({
          name: request.body.name,
          ...(request.body.domain !== undefined && { domain: request.body.domain }),
          ...(request.body.careersUrl !== undefined && {
            careersUrl: request.body.careersUrl,
          }),
          ...(request.body.atsBoardToken !== undefined && {
            atsBoardToken: request.body.atsBoardToken,
          }),
          ...(request.body.atsType !== undefined && { atsType: request.body.atsType }),
        });
        return reply.status(201).send({ data: company });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Create failed";
        return reply.status(400).send({
          error: message,
          code: "COMPANY_CREATE_FAILED",
        } satisfies ApiError);
      }
    },
  );
}
