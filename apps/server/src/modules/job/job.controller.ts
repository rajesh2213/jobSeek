import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createJobRepository } from "./job.repository.js";
import { JobService } from "./job.service.js";
import { getJobsQuerySchema, getJobParamsSchema } from "./job.schema.js";
import type { ApiError } from "../../types/api.js";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";
import { toJobPublicJson, type JobWithCompanyRow } from "./job.mapper.js";
import { getIoredis } from "../../queues/job.queue.js";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import {
  getJobViewCapState,
  checkAndIncrementViewCap,
  FREE_DAILY_JOB_VIEWS,
} from "../viewCap/viewCap.service.js";

interface GetJobParams {
  id: string;
}

function clientIp(request: FastifyRequest): string {
  const xff = request.headers["x-forwarded-for"];
  const raw =
    typeof xff === "string"
      ? xff.split(",")[0]?.trim()
      : Array.isArray(xff)
        ? xff[0]
        : undefined;
  return raw || request.socket.remoteAddress || "unknown";
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

      const bypassToken = process.env.JOB_LIST_VIEW_CAP_BYPASS_TOKEN?.trim();
      const bypassHeader = request.headers["x-jobseek-view-cap-bypass"];
      const bypassCap =
        Boolean(bypassToken) &&
        typeof bypassHeader === "string" &&
        bypassHeader === bypassToken;

      const redis = getIoredis();
      const clerk = await resolveClerkUser(server.prisma, request.headers.authorization);
      const ip = clientIp(request);
      const capCtx = {
        internalUserId: clerk?.internalUserId ?? null,
        ip,
        userEmail: clerk?.email ?? null,
      };

      if (bypassCap) {
        const result = await jobService.list({
          page,
          limit,
          offset,
          filters,
          sort,
        });
        const skip =
          typeof offset === "number"
            ? offset
            : (result.page - 1) * result.limit;
        const hasMore = result.hasMore ?? skip + result.items.length < result.total;
        return reply.send({
          data: result.items.map((j) =>
            toJobPublicJson(j as unknown as JobWithCompanyRow),
          ),
          meta: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalCount: result.total,
            totalPages: result.totalPages,
            offset: skip,
            hasMore,
            capReached: false,
            remaining: null,
            resetAt: new Date().toISOString(),
            viewCapUnlimited: true,
          },
        });
      }

      const capState = await getJobViewCapState(server.prisma, redis, capCtx);

      if (!capState.unlimited && capState.remaining <= 0) {
        /** Preview rows for the current query (no extra cap consumption). */
        const previewLimit = Math.min(limit, FREE_DAILY_JOB_VIEWS);
        const result = await jobService.list({
          page,
          limit: previewLimit,
          offset,
          filters,
          sort,
        });
        const totalMatching = result.total;
        const skip =
          typeof offset === "number"
            ? offset
            : (result.page - 1) * result.limit;
        const totalPages = Math.ceil(totalMatching / limit) || 1;
        const hasMore = false;
        return reply.send({
          data: result.items.map((j) =>
            toJobPublicJson(j as unknown as JobWithCompanyRow),
          ),
          meta: {
            page: result.page,
            limit: result.limit,
            total: totalMatching,
            totalCount: totalMatching,
            totalPages,
            offset: skip,
            hasMore,
            capReached: true,
            remaining: 0,
            resetAt: capState.resetAt.toISOString(),
            totalHidden: Math.max(0, totalMatching - FREE_DAILY_JOB_VIEWS),
            viewCapUnlimited: false,
          },
        });
      }

      const effectiveLimit = capState.unlimited
        ? limit
        : Math.min(limit, capState.remaining);

      const result = await jobService.list({
        page,
        limit: effectiveLimit,
        offset,
        filters,
        sort,
      });

      const afterCap = await checkAndIncrementViewCap(
        server.prisma,
        redis,
        capCtx,
        result.items.length,
      );

      const skip =
        typeof offset === "number"
          ? offset
          : (result.page - 1) * result.limit;
      const hasMore = result.hasMore ?? skip + result.items.length < result.total;

      return reply.send({
        data: result.items.map((j) =>
          toJobPublicJson(j as unknown as JobWithCompanyRow),
        ),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalCount: result.total,
          totalPages: result.totalPages,
          offset: skip,
          hasMore,
          capReached: false,
          remaining: afterCap.unlimited ? null : afterCap.remaining,
          resetAt: afterCap.resetAt.toISOString(),
          viewCapUnlimited: Boolean(afterCap.unlimited),
        },
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
      const job = await jobService.getById(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "Job not found",
          code: "JOB_NOT_FOUND",
        } satisfies ApiError);
      }
      return reply.send({
        data: toJobPublicJson(job as unknown as JobWithCompanyRow),
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
