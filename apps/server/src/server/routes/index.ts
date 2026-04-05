import type { FastifyInstance } from "fastify";
import { registerAccountRoutes } from "../../modules/account/account.routes.js";
import { createJobController } from "../../modules/job/job.controller.js";
import { createCompanyController } from "../../modules/company/company.controller.js";
import { registerDebugRoutes } from "../../modules/debug/debug.controller.js";
import { registerLocationRoutes } from "../../modules/locations/locations.controller.js";
import { registerInternalMetricsRoutes } from "../../modules/internal/internal.metrics.routes.js";
import { registerBillingRoutes } from "../../modules/billing/billing.controller.js";

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  server.get("/health", async (_request, reply) => {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Locations: GET /locations, GET /locations/cities?q= (min 2 chars), GET /locations/countries?q=
  // No global prefix — full paths are as listed (same port as `PORT`, default 3000).
  registerLocationRoutes(server);
  registerAccountRoutes(server);
  registerBillingRoutes(server);
  createJobController(server);
  createCompanyController(server);
  registerInternalMetricsRoutes(server);

  const debugJobEndpointEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEBUG_JOB_ENDPOINT === "true";
  if (debugJobEndpointEnabled) {
    registerDebugRoutes(server);
  }
}
