import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { performance } from "node:perf_hooks";
import { createJobRepository } from "./job.repository.js";
import type { JobWithCompany } from "./job.repository.js";
import { JobService } from "./job.service.js";
import { getJobsQuerySchema, getJobParamsSchema } from "./job.schema.js";
import type { ApiError } from "../../types/api.js";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";
import {
  toJobDetailJson,
  toJobListJson,
  toJobPublicJsonOverDailyCap,
  type JobWithCompanyRow,
} from "./job.mapper.js";
import { getIoredis } from "../../queues/job.queue.js";
import {
  runMeteredJobsList,
  clientIp,
  isViewCapBypassRequest,
  buildCapContextFromRequest,
} from "../viewCap/jobListCap.js";
import {
  getJobViewCapState,
  checkAndIncrementViewCap,
} from "../viewCap/viewCap.service.js";
import { assertJobReadRateLimit } from "../viewCap/rateLimitRedis.js";
import { recordJobBlockedNotReady } from "../../services/jobStatusMetrics.service.js";
import { LIMITS } from "../../config/limits.js";
import { enqueueGrowthEmailEvent } from "../growthEmail/growthEmail.service.js";
import { isLikelyPrefetchRequest } from "../../utils/clientNavigationHints.js";
import { jobListRequestDiag } from "./jobListRequestContext.js";
import {
  createEventLoopUtilizationOrigin,
  eventLoopUtilizationSince,
  getJobListMeteredSlowThresholdMs,
  logJobListMeteredSlow,
  summarizeJobDiscoveryFilters,
} from "./jobListMeteredDiag.js";
import { stableServerJobFiltersKey } from "../../infrastructure/cache/listingFiltersKey.js";
import {
  fetchJobsListingWithCache,
  isJobsListingCacheEligible,
} from "./jobsListingFetch.js";
import {
  getStaleJobsListingRaw,
  jobsListingRawCacheKey,
} from "./jobsListingCache.js";
import { isListingDegradedDbError } from "../../infrastructure/db/listingDegradedResponse.js";
import { getCachedJobDetailJson, setCachedJobDetailJson } from "./jobDetailCache.js";

interface GetJobParams {
  id: string;
}

function parseQueryBool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "1";
}

function setApiCacheHeader(
  reply: FastifyReply,
  _request: FastifyRequest,
  input: { route: string; cacheable: boolean; reason: string },
): void {
  const { cacheable } = input;
  const value = cacheable
    ? "public, max-age=30, s-maxage=30"
    : "private, no-store";
  reply.header("Cache-Control", value);
}

export function registerJobRoutes(
  server: FastifyInstance,
  jobService: JobService,
) {
  server.get(
    "/jobs",
    { schema: getJobsQuerySchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tRouteStart = performance.now();
      const redis = getIoredis();
      const ip = clientIp(request);
      const bypassRateLimit = isViewCapBypassRequest(request);
      const rl = bypassRateLimit
        ? { ok: true as const }
        : await assertJobReadRateLimit(redis, ip);
      const tAfterRateLimit = performance.now();
      if (!rl.ok) {
        return reply.status(429).send({
          error: "Too many requests",
          code: "RATE_LIMIT",
        } satisfies ApiError);
      }

      const q = request.query as Record<string, unknown>;
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

      const bypassCap = isViewCapBypassRequest(request);
      const capCtx = await buildCapContextFromRequest(server.prisma, request);
      const tAfterCapCtx = performance.now();

      const hasAuthHeader = typeof request.headers.authorization === "string";
      const isAnonymous = capCtx.internalUserId == null && !hasAuthHeader;

      const isHeavyQuery = Boolean(
        filters.companyId ||
          filters.minSalary !== undefined ||
          filters.experienceLevel ||
          filters.postedWithin ||
          sortRaw !== "latest",
      );

      const isDeepPagination = page > 5;

      /** Default browse + light taxonomy filters — not company/salary/deep pages. */
      const isSafeToCache =
        isAnonymous && !isHeavyQuery && !isDeepPagination && page <= 5;

      const meteredLimit = isSafeToCache ? Math.min(limit, 50) : limit;

      const durMs = (a: number, b: number) => Math.max(0, Math.round((b - a) * 100) / 100);
      const eluOrigin = createEventLoopUtilizationOrigin();

      const filtersKey = stableServerJobFiltersKey(filters);
      const listingCacheEligible = isJobsListingCacheEligible({
        isAnonymous,
        isSafeToCache,
        page,
      });

      try {
      return await jobListRequestDiag.run(
        {
          sort,
          page,
          limit,
          meteredLimit,
          filterSummary: summarizeJobDiscoveryFilters(filters),
        },
        async () => {
          const out = await runMeteredJobsList<JobWithCompany>(
            server.prisma,
            redis,
            capCtx,
            bypassCap,
            {
              page,
              limit: meteredLimit,
              offset,
              fetchList: (effectiveLimit) => {
                const listInput = {
                  page,
                  limit: effectiveLimit,
                  paginationStride: meteredLimit,
                  offset,
                  filters,
                  sort,
                  includeProcessing,
                };
                if (!listingCacheEligible) {
                  return jobService.list(listInput);
                }
                return fetchJobsListingWithCache(
                  redis,
                  {
                    page,
                    limit: effectiveLimit,
                    sort,
                    filtersKey,
                  },
                  () => jobService.list(listInput),
                );
              },
            },
          );
          const tAfterList = performance.now();

          const meteredListMs = durMs(tAfterCapCtx, tAfterList);
          reply.header(
            "Server-Timing",
            [
              `rate_limit;dur=${durMs(tRouteStart, tAfterRateLimit)}`,
              `cap_ctx;dur=${durMs(tAfterRateLimit, tAfterCapCtx)}`,
              `metered_list;dur=${meteredListMs}`,
            ].join(", "),
          );

          const meteredSlowTh = getJobListMeteredSlowThresholdMs();
          if (meteredSlowTh > 0 && meteredListMs >= meteredSlowTh) {
            const elu = eventLoopUtilizationSince(eluOrigin);
            logJobListMeteredSlow({
              meteredListMs,
              rateLimitMs: durMs(tRouteStart, tAfterRateLimit),
              capCtxMs: durMs(tAfterRateLimit, tAfterCapCtx),
              sort,
              page,
              meteredLimit,
              clientLimit: limit,
              offset: offset ?? null,
              eventLoopIdleMs: elu.idleMs,
              eventLoopActiveMs: elu.activeMs,
              eventLoopUtilization: elu.utilization,
              filterSummary: summarizeJobDiscoveryFilters(filters),
            });
          }

          if (isSafeToCache) {
            reply.header("Cache-Control", "public, max-age=60, s-maxage=120");
          } else {
            const cacheableJobsList = false;
            const cacheBypassReason = cacheableJobsList
              ? "anonymous_public_listing"
              : capCtx.internalUserId != null || hasAuthHeader
                ? "authenticated_request"
                : "metered_or_personalized";

            setApiCacheHeader(reply, request, {
              route: "/jobs",
              cacheable: cacheableJobsList,
              reason: cacheBypassReason,
            });
          }

          return reply.send({
            data: out.items.map((j) =>
              toJobListJson(j as unknown as JobWithCompanyRow),
            ),
            meta: out.meta,
          });
        },
      );
      } catch (err) {
        if (listingCacheEligible && isListingDegradedDbError(err)) {
          const stale = await getStaleJobsListingRaw(
            redis,
            jobsListingRawCacheKey({
              page,
              limit: meteredLimit,
              sort,
              filtersKey,
            }),
          );
          if (stale?.items?.length) {
            request.log.warn(
              { event: "listing_stale_fallback", route: "/jobs" },
              "listing_stale_fallback",
            );
            return reply.header("X-Listing-Cache", "stale").send({
              data: stale.items.map((j) =>
                toJobListJson(j as unknown as JobWithCompanyRow),
              ),
              meta: {
                page,
                pageSize: meteredLimit,
                total: stale.total,
                totalCount: stale.total,
                hasMore: stale.hasMore ?? stale.items.length === meteredLimit,
                capReached: false,
                remaining: null,
                resetAt: new Date().toISOString(),
                viewCapUnlimited: true,
                limit: {
                  mode: LIMITS.MODE,
                  remaining: null,
                  resetAt: new Date().toISOString(),
                  warning: false,
                  isCapped: false,
                },
              },
            });
          }
        }
        throw err;
      }
    },
  );

  server.get("/jobs/roles", async (_request, reply) => {
    const roles = await jobService.listRoleSuggestions();
    return reply.send({ roles });
  });

  server.get("/jobs/categories", async (_request, reply) => {
    const categories = await jobService.listCategoryAggregates();
    return reply.send({ categories });
  });

  server.get("/jobs/skills", async (_request, reply) => {
    const skills = await jobService.listSkillAggregates();
    return reply.send({ skills });
  });

  server.get<{ Params: GetJobParams }>(
    "/jobs/:id",
    { schema: getJobParamsSchema },
    async (
      request: FastifyRequest<{ Params: GetJobParams }>,
      reply: FastifyReply,
    ) => {
      const redis = getIoredis();
      const ip = clientIp(request);
      const bypassRateLimit = isViewCapBypassRequest(request);
      const rl = bypassRateLimit
        ? { ok: true as const }
        : await assertJobReadRateLimit(redis, ip);
      if (!rl.ok) {
        return reply.status(429).send({
          error: "Too many requests",
          code: "RATE_LIMIT",
        } satisfies ApiError);
      }

      const q = request.query as Record<string, unknown>;
      const includeProcessing = parseQueryBool(q.includeProcessing);
      const jobId = request.params.id;
      const hasAuthHeader = typeof request.headers.authorization === "string";
      if (!includeProcessing && !hasAuthHeader) {
        const cachedDetail = await getCachedJobDetailJson<ReturnType<typeof toJobDetailJson>>(
          redis,
          jobId,
        );
        if (cachedDetail) {
          return reply.header("X-Job-Detail-Cache", "hit").send({ data: cachedDetail });
        }
      }
      const job = await jobService.getById(jobId, { includeProcessing });
      if (!job) {
        if (!includeProcessing) {
          const hidden = await jobService.getById(request.params.id, {
            includeProcessing: true,
          });
          if (hidden) {
            recordJobBlockedNotReady();
          }
        }
        return reply.status(404).send({
          error: "Job not found",
          code: "JOB_NOT_FOUND",
        } satisfies ApiError);
      }

      const capCtx = await buildCapContextFromRequest(server.prisma, request);
      const capState = await getJobViewCapState(server.prisma, redis, capCtx);

      if (capState.unlimited) {
        const resetAt = capState.resetAt.toISOString();
        const detailJson = toJobDetailJson(job as unknown as JobWithCompanyRow);
        if (!includeProcessing && !hasAuthHeader) {
          void setCachedJobDetailJson(redis, jobId, detailJson);
        }
        return reply.send({
          data: detailJson,
          meta: {
            capReached: false,
            remaining: null,
            resetAt,
            viewCapUnlimited: true,
            limit: {
              mode: LIMITS.MODE,
              remaining: null,
              resetAt,
              warning: false,
              isCapped: false,
            },
          },
        });
      }

      if (LIMITS.MODE === "hard" && capState.remaining <= 0) {
        const resetAt = capState.resetAt.toISOString();
        return reply.send({
          data: toJobPublicJsonOverDailyCap(job as unknown as JobWithCompanyRow),
          meta: {
            capReached: true,
            remaining: 0,
            resetAt,
            viewCapUnlimited: false,
            limit: {
              mode: LIMITS.MODE,
              remaining: 0,
              resetAt,
              warning: true,
              isCapped: true,
            },
          },
        });
      }

      const skipCapDebit = isLikelyPrefetchRequest(request);
      const afterCap = skipCapDebit
        ? {
            allowed: capState.remaining > 0 || capState.unlimited,
            remaining: capState.remaining,
            resetAt: capState.resetAt,
            unlimited: capState.unlimited,
          }
        : await checkAndIncrementViewCap(server.prisma, redis, capCtx, 1);

      const resetAt = afterCap.resetAt.toISOString();
      const remaining = afterCap.unlimited ? null : afterCap.remaining;
      if (!skipCapDebit && capCtx.internalUserId) {
        await enqueueGrowthEmailEvent({
          userId: capCtx.internalUserId,
          email: capCtx.userEmail ?? undefined,
          campaignType: "event_followup",
          jobId: job.id,
          source: "job_detail_view",
        });
      }
      return reply.send({
        data: toJobDetailJson(job as unknown as JobWithCompanyRow),
        meta: {
          capReached: false,
          remaining,
          resetAt,
          viewCapUnlimited: Boolean(afterCap.unlimited),
          limit: {
            mode: LIMITS.MODE,
            remaining,
            resetAt,
            warning: typeof remaining === "number" && remaining <= 10,
            isCapped: typeof remaining === "number" && remaining <= 0,
          },
        },
      });
    },
  );
}

export function createJobController(server: FastifyInstance): JobService {
  const repository = createJobRepository(server.prisma);
  const service = new JobService(repository);
  registerJobRoutes(server, service);
  return service;
}
