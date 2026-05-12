import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getIoredis } from "../../queues/job.queue.js";
import { buildIngestionObservabilitySnapshot } from "../../services/ingestionObservability.service.js";

/**
 * Same auth model as `/internal/metrics` (Bearer INTERNAL_METRICS_TOKEN; non-prod open if unset).
 */
function isAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = process.env.INTERNAL_METRICS_TOKEN?.trim();
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      void reply.status(503).send({
        error: "Internal ingestion metrics require INTERNAL_METRICS_TOKEN in production",
        code: "INGESTION_METRICS_NOT_CONFIGURED",
      });
      return false;
    }
    return true;
  }
  const auth = request.headers.authorization ?? "";
  if (auth !== `Bearer ${token}`) {
    void reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return false;
  }
  return true;
}

/**
 * GET /internal/ingestion/health — queue depths, endpoint staleness slice, primary-job lifecycle, 1h throughput.
 * Designed for low overhead scraping (30–60s interval): sequential bounded Prisma queries + capped queue probes.
 */
export function registerInternalIngestionRoutes(server: FastifyInstance): void {
  server.get(
    "/internal/ingestion/health",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isAuthorized(request, reply)) {
        return;
      }
      const redis = getIoredis();
      const snapshot = await buildIngestionObservabilitySnapshot(server.prisma, redis);
      return reply.send(snapshot);
    },
  );
}
