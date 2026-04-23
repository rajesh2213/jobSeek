import type { FastifySchema } from "fastify";

export const getCompaniesQuerySchema: FastifySchema = {
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      q: { type: "string" },
      sort: { type: "string", enum: ["jobs", "recent", "name"], default: "jobs" },
      hiring: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
    },
    additionalProperties: false,
  },
};

/** Same filter surface as GET /jobs (companyId is forced from route). */
export const getCompanyJobsQuerySchema: FastifySchema = {
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      role: { type: "string" },
      skills: { type: "string" },
      country: { type: "string" },
      locations: { type: "string" },
      location: { type: "string" },
      category: { type: "string" },
      remote: { type: "boolean" },
      workType: { type: "string", enum: ["remote", "onsite", "hybrid"] },
      experience: { type: "string", enum: ["junior", "mid", "senior"] },
      posted: { type: "string", enum: ["24h", "3d", "1w", "1m"] },
      minSalary: { type: "integer", minimum: 0 },
      sort: { type: "string", enum: ["latest", "salary", "salary_desc"] },
      includeProcessing: { type: "boolean" },
    },
    additionalProperties: false,
  },
};

export const createCompanyBodySchema: FastifySchema = {
  body: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      domain: { type: "string" },
      careersUrl: { type: "string" },
      atsBoardToken: { type: "string" },
      atsType: { type: "string" },
    },
    additionalProperties: false,
  },
};
