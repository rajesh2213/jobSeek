import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildDbActivitySnapshot } from "../../services/dbActivitySnapshot.service.js";

function isLoopbackIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * Bearer `INTERNAL_DB_DIAG_SECRET`, or falls back to `INTERNAL_METRICS_TOKEN`.
 * Production: loopback only (same posture as job-list shadow).
 */
function assertDbDiagAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const secret =
    process.env.INTERNAL_DB_DIAG_SECRET?.trim() || process.env.INTERNAL_METRICS_TOKEN?.trim();
  if (!secret) {
    void reply.status(503).send({
      error: "Set INTERNAL_DB_DIAG_SECRET or INTERNAL_METRICS_TOKEN",
      code: "DB_DIAG_NOT_CONFIGURED",
    });
    return false;
  }
  if (process.env.NODE_ENV === "production" && !isLoopbackIp(request.ip)) {
    void reply.status(403).send({
      error: "DB diagnostics only allowed from loopback in production",
      code: "FORBIDDEN",
    });
    return false;
  }
  const auth = request.headers.authorization ?? "";
  if (auth !== `Bearer ${secret}`) {
    void reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return false;
  }
  return true;
}

/**
 * GET /internal/db/pg-activity — pg_stat_activity snapshot (JSON).
 * Does not expose Prisma pool internals; pair with `PRISMA_QUERY_DIAG` for SQL text.
 */
export function registerInternalDbDiagRoutes(server: FastifyInstance): void {
  server.get(
    "/internal/db/pg-activity",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertDbDiagAuthorized(request, reply)) {
        return;
      }
      const snapshot = await buildDbActivitySnapshot(server.prisma);
      return reply.send({
        ok: true,
        note:
          "Through PgBouncer, stats may reflect pooler session or be partial. Use direct session DB URL for full fidelity when safe.",
        snapshot,
      });
    },
  );
}
