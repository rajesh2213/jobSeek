import type { FastifySchema } from "fastify";

export const createCompanyBodySchema: FastifySchema = {
  body: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      careersUrl: { type: "string" },
      atsBoardToken: { type: "string" },
      atsType: { type: "string" },
    },
    additionalProperties: false,
  },
};
