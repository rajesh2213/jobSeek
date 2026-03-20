import type { FastifySchema } from "fastify";

export const getJobsQuerySchema: FastifySchema = {
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      location: { type: "string" },
      isRemote: { type: "boolean" },
      companyId: { type: "string" },
    },
    additionalProperties: false,
  },
};

export const getJobParamsSchema: FastifySchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
    additionalProperties: false,
  },
};
