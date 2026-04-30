import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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

interface GetJobParams {
  id: string;
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

export function registerJobRoutes(
  server: FastifyInstance,
  jobService: JobService,
) {
  server.get(
    "/jobs",
    { schema: getJobsQuerySchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
      request.log.debug({ filters }, "jobs_query_filters");
      const sortRaw = String(q.sort ?? "latest");
      const sort: "latest" | "salary_desc" =
        sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";
      const includeProcessing = parseQueryBool(q.includeProcessing);

      const bypassCap = isViewCapBypassRequest(request);
      const capCtx = await buildCapContextFromRequest(server.prisma, request);

      const hasAuthHeader = typeof request.headers.authorization === "string";
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

      request.log.info(
        {
          event: "jobs_cache_strategy",
          isSafeToCache,
          isCommonFilterQuery,
          isHeavyQuery,
          isDeepPagination,
        },
        "jobs_cache_strategy",
      );

      const meteredLimit = isSafeToCache ? Math.min(limit, 50) : limit;

      const jobsTotalStart = Date.now();
      const out = await runMeteredJobsList<JobWithCompany>(
        server.prisma,
        redis,
        capCtx,
        bypassCap,
        {
          page,
          limit: meteredLimit,
          offset,
          fetchList: (effectiveLimit) =>
            jobService.list({
              page,
              limit: effectiveLimit,
              offset,
              filters,
              sort,
              includeProcessing,
            }),
        },
      );
      console.log("jobs_total_ms", Date.now() - jobsTotalStart);

      if (isSafeToCache) {
        reply.header("Cache-Control", "public, max-age=60, s-maxage=120");
        request.log.info(
          {
            event: "jobs_cache_status",
            status: "HIT_ELIGIBLE",
            safeToCache: true,
          },
          "jobs_cache_status",
        );
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

      request.log.info(
        {
          event: "jobs_metering_enforced",
          isSafeToCache,
          limit: meteredLimit,
          page,
          capApplied: Boolean(
            !bypassCap && !out.meta.viewCapUnlimited,
          ),
        },
        "jobs_metering_enforced",
      );

      const rowsReturned = out.items.length;
      const estBytes = rowsReturned * 1100;
      request.log.info(
        {
          event: "api_request_metrics",
          route: "/jobs",
          method: "GET",
          rowsReturned,
          estimatedKB: Number((estBytes / 1024).toFixed(2)),
        },
        "api_jobs_list_metrics",
      );

      return reply.send({
        data: out.items.map((j) =>
          toJobListJson(j as unknown as JobWithCompanyRow),
        ),
        meta: out.meta,
      });
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
      const rl = await assertJobReadRateLimit(redis, ip);
      if (!rl.ok) {
        return reply.status(429).send({
          error: "Too many requests",
          code: "RATE_LIMIT",
        } satisfies ApiError);
      }

      const q = request.query as Record<string, unknown>;
      const includeProcessing = parseQueryBool(q.includeProcessing);
      const job = await jobService.getById(request.params.id, { includeProcessing });
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
        return reply.send({
          data: toJobDetailJson(job as unknown as JobWithCompanyRow),
          meta: {
            capReached: false,
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

      const afterCap = await checkAndIncrementViewCap(
        server.prisma,
        redis,
        capCtx,
        1,
      );

      const resetAt = afterCap.resetAt.toISOString();
      const remaining = afterCap.unlimited ? null : afterCap.remaining;
      if (capCtx.internalUserId) {
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
