import type { FastifyInstance } from "fastify";
import { createJobController } from "../../modules/job/job.controller.js";
import { createCompanyController } from "../../modules/company/company.controller.js";

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  server.get("/health", async (_request, reply) => {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  });

  createJobController(server);
  createCompanyController(server);
}
