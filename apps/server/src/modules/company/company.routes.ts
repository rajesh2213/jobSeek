import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { toJobPublicJson, type JobWithCompanyRow } from "../job/job.mapper.js";
import { CompanyService } from "./company.service.js";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";
import type { ApiError } from "../../types/api.js";
import {
  createCompanyBodySchema,
  getCompaniesQuerySchema,
  getCompanyJobsQuerySchema,
} from "./company.schema.js";
import type { CompaniesListingSort, CompanyListingRow } from "./companyListing.types.js";

function parseCompaniesSort(raw: unknown): CompaniesListingSort {
  const s = typeof raw === "string" ? raw : "jobs";
  if (s === "recent" || s === "name") return s;
  return "jobs";
}

function parseQueryBool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "1";
}

function toCompanyListingPublicJson(row: CompanyListingRow) {
  return {
    id: row.id,
    name: row.name,
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
      const q = request.query as Record<string, unknown>;
      const { page, limit } = parsePageLimit(q, { defaultLimit: 20, maxLimit: 100 });
      const search = typeof q.q === "string" ? q.q : "";
      const sort = parseCompaniesSort(q.sort);
      const hiring = parseQueryBool(q.hiring);
      const remote = parseQueryBool(q.remote);

      const result = await companyService.listCompaniesDiscovery({
        q: search,
        sort,
        hiring,
        remote,
        page,
        limit,
      });

      return reply.send({
        data: result.items.map(toCompanyListingPublicJson),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
          hasMore: result.hasMore,
          stats: result.stats,
        },
      });
    },
  );

  server.get<{ Params: CompanySlugParams }>(
    "/company/:slug/jobs",
    { schema: getCompanyJobsQuerySchema },
    async (
      request: FastifyRequest<{ Params: CompanySlugParams }>,
      reply: FastifyReply,
    ) => {
      const q = request.query as Record<string, unknown>;
      const { page, limit } = parsePageLimit(q, { defaultLimit: 50, maxLimit: 100 });
      const filterQuery = { ...q, page: undefined, limit: undefined };
      const parsed = parseJobDiscoveryQuery(filterQuery);
      delete parsed.companyId;

      const sortRaw = String(q.sort ?? "latest");
      const sort: "latest" | "salary_desc" =
        sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";

      const bundle = await companyService.getCompanyJobs(request.params.slug, {
        page,
        limit,
        filters: parsed,
        sort,
      });

      if (!bundle) {
        return reply.status(404).send({
          error: "Company not found",
          code: "COMPANY_NOT_FOUND",
        } satisfies ApiError);
      }

      return reply.send({
        data: bundle.jobs.items.map((j) =>
          toJobPublicJson(j as unknown as JobWithCompanyRow),
        ),
        meta: {
          page: bundle.jobs.page,
          limit: bundle.jobs.limit,
          total: bundle.jobs.total,
          totalPages: bundle.jobs.totalPages,
          hasMore: bundle.jobs.hasMore,
          company: {
            id: bundle.company.id,
            name: bundle.company.name,
            slug: bundle.company.slug,
            domain: bundle.company.domain,
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
      const company = await companyService.getCompanyBySlug(request.params.slug);
      if (!company) {
        return reply.status(404).send({
          error: "Company not found",
          code: "COMPANY_NOT_FOUND",
        } satisfies ApiError);
      }
      return reply.send({ data: company });
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
