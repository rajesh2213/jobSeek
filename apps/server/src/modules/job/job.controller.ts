import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createJobRepository } from "./job.repository.js";
import { JobService } from "./job.service.js";
import { getJobsQuerySchema, getJobParamsSchema } from "./job.schema.js";
import type { ApiError } from "../../types/api.js";

interface GetJobsQuery {
  page?: number;
  limit?: number;
  location?: string;
  isRemote?: boolean;
  companyId?: string;
}

interface GetJobParams {
  id: string;
}

export function registerJobRoutes(
  server: FastifyInstance,
  jobService: JobService
) {
  server.get<{ Querystring: GetJobsQuery }>(
    "/jobs",
    { schema: getJobsQuerySchema },
    async (
      request: FastifyRequest<{ Querystring: GetJobsQuery }>,
      reply: FastifyReply
    ) => {
      const { page = 1, limit = 20, location, isRemote: isRemoteRaw, companyId } = request.query;
      const isRemote =
        isRemoteRaw === true || String(isRemoteRaw) === "true"
          ? true
          : isRemoteRaw === false || String(isRemoteRaw) === "false"
            ? false
            : undefined;
      const filters =
        location !== undefined || isRemote !== undefined || companyId !== undefined
          ? { location, isRemote, companyId }
          : undefined;
      const result = await jobService.list({ page, limit, filters });
      return reply.send({
        data: result.items,
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      });
    }
  );

  server.get<{ Params: GetJobParams }>(
    "/jobs/:id",
    { schema: getJobParamsSchema },
    async (
      request: FastifyRequest<{ Params: GetJobParams }>,
      reply: FastifyReply
    ) => {
      const job = await jobService.getById(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "Job not found",
          code: "JOB_NOT_FOUND",
        } satisfies ApiError);
      }
      return reply.send({ data: job });
    }
  );
}

export function createJobController(server: FastifyInstance): JobService {
  const repository = createJobRepository(server.prisma);
  const service = new JobService(repository);
  registerJobRoutes(server, service);
  return service;
}
