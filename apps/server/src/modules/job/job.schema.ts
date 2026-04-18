import type { FastifySchema } from "fastify";

/** Filter-only job listing (taxonomy + ISO country); no free-text `q`. */
export const getJobsQuerySchema: FastifySchema = {
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      offset: { type: "integer", minimum: 0 },
      role: { type: "string" },
      roles: { type: "string" },
      skills: { type: "string" },
      country: { type: "string" },
      locations: { type: "string" },
      category: { type: "string" },
      categories: { type: "string" },
      surface: { type: "string", enum: ["browse", "seo"] },
      remote: { type: "boolean" },
      workType: { type: "string", enum: ["remote", "onsite", "hybrid"] },
      types: { type: "string" },
      experience: { type: "string", enum: ["junior", "mid", "senior"] },
      posted: { type: "string", enum: ["24h", "3d", "1w", "1m"] },
      minSalary: { type: "integer", minimum: 0 },
      companyId: { type: "string" },
      location: { type: "string" },
      sort: { type: "string", enum: ["latest", "salary", "salary_desc"] },
    },
    additionalProperties: false,
  },
};

export const getLocationsSchema: FastifySchema = {
  response: {
    200: {
      type: "object",
      required: ["regions", "countries"],
      properties: {
        regions: { type: "array", items: { type: "string" } },
        countries: {
          type: "array",
          items: {
            type: "object",
            required: ["code", "name", "region"],
            properties: {
              code: { type: "string" },
              name: { type: "string" },
              region: { type: "string" },
            },
          },
        },
      },
    },
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

export const getCountriesQuerySchema: FastifySchema = {
  querystring: {
    type: "object",
    properties: {
      q: { type: "string" },
    },
    additionalProperties: false,
  },
};

export const getCitiesQuerySchema: FastifySchema = {
  querystring: {
    type: "object",
    properties: {
      q: { type: "string" },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        required: ["city", "country", "region", "count"],
        properties: {
          city: { type: "string" },
          country: { type: "string" },
          region: { type: "string" },
          count: { type: "integer", minimum: 0 },
        },
      },
    },
  },
};
