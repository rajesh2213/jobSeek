import type { FastifyInstance } from "fastify";
import { registerAccountRoutes } from "../../modules/account/account.routes.js";
import { createJobController } from "../../modules/job/job.controller.js";
import { createCompanyController } from "../../modules/company/company.controller.js";
import { registerDebugRoutes } from "../../modules/debug/debug.controller.js";
import { registerLocationRoutes } from "../../modules/locations/locations.controller.js";
import { registerInternalMetricsRoutes } from "../../modules/internal/internal.metrics.routes.js";
import { registerInternalIngestionRoutes } from "../../modules/internal/internal.ingestion.routes.js";
import { registerInternalDbDiagRoutes } from "../../modules/internal/internal.dbDiag.routes.js";
import { registerJobListShadowRoutes } from "../../modules/job/internal.jobListShadow.routes.js";
import { registerBillingRoutes } from "../../modules/billing/billing.controller.js";
import { registerDodoBillingRoutes } from "../../modules/billing/dodo.controller.js";
import { registerSavedSearchRoutes } from "../../modules/saved-search/savedSearch.routes.js";
import { registerApplicationsRoutes } from "../../modules/applications/applications.routes.js";
import { registerGrowthEmailRoutes } from "../../modules/growthEmail/growthEmail.routes.js";
import { createJobRepository } from "../../modules/job/job.repository.js";
import { createSeoService } from "../../modules/seo/seo.service.js";
import { registerSeoAggregationRoutes, registerSeoRoutes } from "../../modules/seo/seo.routes.js";
import { createSeoAggregationsService } from "../../modules/seo/seoAggregations.service.js";
import { getIoredis } from "../../queues/job.queue.js";
import { LIMITS } from "../../config/limits.js";

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  server.get("/health", async (_request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      /** Effective discovery cap mode for this process (`LIMITS.MODE`). */
      capMode: LIMITS.MODE,
      capModeEnv: process.env.CAP_MODE?.trim() || null,
    });
  });

  if (process.env.ENABLE_READINESS_PROBE?.trim() === "true") {
    server.get("/health/ready", async (_request, reply) => {
      try {
        await server.prisma.$queryRaw`SELECT 1`;
        const redis = getIoredis();
        const pong = await redis.ping();
        if (pong !== "PONG") {
          return reply.status(503).send({ status: "not_ready", reason: "redis_ping" });
        }
        return reply.send({
          status: "ready",
          timestamp: new Date().toISOString(),
        });
      } catch {
        return reply.status(503).send({ status: "not_ready" });
      }
    });
  }

  // Locations: GET /locations, GET /locations/cities?q= (min 2 chars), GET /locations/countries?q=
  // No global prefix — full paths are as listed (same port as `PORT`, default 3000).
  registerLocationRoutes(server);
  registerAccountRoutes(server);
  registerSavedSearchRoutes(server);
  registerGrowthEmailRoutes(server);
  registerApplicationsRoutes(server);
  registerBillingRoutes(server);
  registerDodoBillingRoutes(server);
  createJobController(server);
  createCompanyController(server);
  const seoService = createSeoService(server.prisma);
  const seoAggregations = createSeoAggregationsService(server.prisma);
  const jobRepository = createJobRepository(server.prisma);
  registerSeoRoutes(server, seoService, jobRepository);
  registerSeoAggregationRoutes(server, seoAggregations);
  registerInternalMetricsRoutes(server);
  registerInternalIngestionRoutes(server);
  registerInternalDbDiagRoutes(server);
  registerJobListShadowRoutes(server);

  const debugJobEndpointEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEBUG_JOB_ENDPOINT === "true";
  if (debugJobEndpointEnabled) {
    registerDebugRoutes(server);
  }
}
