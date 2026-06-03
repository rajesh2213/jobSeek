import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getIoredis } from "../../queues/job.queue.js";
import { buildMetricsSnapshot } from "../../services/metricsSnapshot.service.js";

/**
 * Production: set INTERNAL_METRICS_TOKEN and send `Authorization: Bearer <token>`.
 * Without token in production, route returns 503. In non-production, open if token unset (local DX).
 */
function isInternalMetricsAuthorized(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const token = process.env.INTERNAL_METRICS_TOKEN?.trim();
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      void reply.status(503).send({
        error: "Internal metrics require INTERNAL_METRICS_TOKEN in production",
        code: "METRICS_NOT_CONFIGURED",
      });
      return false;
    }
    return true;
  }
  const auth = request.headers.authorization ?? "";
  if (auth !== `Bearer ${token}`) {
    void reply.status(401).send({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    return false;
  }
  return true;
}

export function registerInternalMetricsRoutes(server: FastifyInstance): void {
  server.get(
    "/internal/metrics",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isInternalMetricsAuthorized(request, reply)) {
        return;
      }
      const redis = getIoredis();
      const snapshot = await buildMetricsSnapshot(server.prisma, redis);
      return reply.send(snapshot);
    },
  );
}
