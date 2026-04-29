import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createJobRepository } from "./job.repository.js";
import { JobService } from "./job.service.js";
import { getJobsQuerySchema, getJobParamsSchema } from "./job.schema.js";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";
import { buildCapContextFromRequest } from "../viewCap/jobListCap.js";
import { executeMeteredJobsListHttpParity } from "../../shared/jobsList.shared.js";
import { executeJobDetailHttpParity } from "../../shared/jobDetail.shared.js";

interface GetJobParams {
  id: string;
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
      const q = request.query as Record<string, unknown>;
      const filters = parseJobDiscoveryQuery(q);
      request.log.debug({ filters }, "jobs_query_filters");

      const sortRaw = String(q.sort ?? "latest");
      const pageRaw = q.page;
      const page =
        typeof pageRaw === "string" || typeof pageRaw === "number"
          ? Math.max(1, parseInt(String(pageRaw), 10) || 1)
          : 1;

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

      const result = await executeMeteredJobsListHttpParity({
        jobService,
        query: q,
        headers: request.headers as Record<string, string | string[] | undefined>,
      });

      if (result.status === 429) {
        return reply.status(429).send(result.body);
      }

      const { payload, replyHints } = result;

      if (replyHints.isSafeToCache) {
        reply.header("Cache-Control", "public, max-age=60, s-maxage=120");
        request.log.info(
          {
            event: "jobs_cache_status",
            status: "HIT_ELIGIBLE",
            safeToCache: true,
          },
          "api_cache_status",
        );
      } else {
        const cacheableJobsList = false;

        setApiCacheHeader(reply, request, {
          route: "/jobs",
          cacheable: cacheableJobsList,
          reason: replyHints.cacheBypassReason,
        });
      }

      request.log.info(
        {
          event: "jobs_metering_enforced",
          isSafeToCache,
          limit: replyHints.meteredLimit,
          page: replyHints.page,
          capApplied: replyHints.capApplied,
        },
        "jobs_metering_enforced",
      );

      const rowsReturned = payload.data.length;
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

      return reply.send(payload);
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
      const q = request.query as Record<string, unknown>;
      const result = await executeJobDetailHttpParity({
        jobService,
        jobId: request.params.id,
        query: q,
        headers: request.headers as Record<string, string | string[] | undefined>,
      });

      if (result.status === 429) {
        return reply.status(429).send(result.body);
      }
      if (result.status === 404) {
        return reply.status(404).send(result.body);
      }
      return reply.send(result.body);
    },
  );
}

export function createJobController(server: FastifyInstance): JobService {
  const repository = createJobRepository(server.prisma);
  const service = new JobService(repository);
  registerJobRoutes(server, service);
  return service;
}
