import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createJobRepository } from "./job.repository.js";
import { JobService } from "./job.service.js";
import { getJobsQuerySchema, getJobParamsSchema } from "./job.schema.js";
import type { ApiError } from "../../types/api.js";
import {
  hasDiscoveryMeteringFilters,
  hasDiscoveryQueryIntent,
  parseJobDiscoveryQuery,
} from "../../utils/taxonomyQuery.js";
import {
  toJobPublicJson,
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

interface GetJobParams {
  id: string;
}

function parseQueryBool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "1";
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
      const surfaceRaw = String(q.surface ?? "browse").toLowerCase();
      const bonusSurface = surfaceRaw === "seo" ? "seo" : "browse";
      const discoveryDebit =
        hasDiscoveryMeteringFilters(filters) || hasDiscoveryQueryIntent(q);
      const sortRaw = String(q.sort ?? "latest");
      const sort: "latest" | "salary_desc" =
        sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";
      const includeProcessing = parseQueryBool(q.includeProcessing);

      const bypassCap = isViewCapBypassRequest(request);
      const capCtx = await buildCapContextFromRequest(server.prisma, request);

      const out = await runMeteredJobsList(
        server.prisma,
        redis,
        capCtx,
        bypassCap,
        {
          page,
          limit,
          offset,
          discoveryDebit,
          bonusSurface,
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
          toJobPublicJson(j as unknown as JobWithCompanyRow),
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
        return reply.send({
          data: toJobPublicJson(job as unknown as JobWithCompanyRow),
          meta: {
            capReached: false,
            resetAt: capState.resetAt.toISOString(),
            viewCapUnlimited: true,
          },
        });
      }

      if (capState.remaining <= 0) {
        return reply.send({
          data: toJobPublicJsonOverDailyCap(job as unknown as JobWithCompanyRow),
          meta: {
            capReached: true,
            remaining: 0,
            resetAt: capState.resetAt.toISOString(),
            viewCapUnlimited: false,
          },
        });
      }

      const afterCap = await checkAndIncrementViewCap(
        server.prisma,
        redis,
        capCtx,
        1,
      );

      return reply.send({
        data: toJobPublicJson(job as unknown as JobWithCompanyRow),
        meta: {
          capReached: false,
          remaining: afterCap.unlimited ? null : afterCap.remaining,
          resetAt: afterCap.resetAt.toISOString(),
          viewCapUnlimited: Boolean(afterCap.unlimited),
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
