import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";
import { runJobListHydrateShadow } from "./jobListShadow.run.js";

function parseQueryBool(v: unknown): boolean {
  return v === true || v === "true" || v === "1";
}

function isLoopbackIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function assertJobListShadowAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const secret = process.env.JOB_LIST_SHADOW_SECRET?.trim();
  if (!secret) {
    void reply.status(503).send({
      error: "JOB_LIST_SHADOW_SECRET is not configured",
      code: "SHADOW_NOT_CONFIGURED",
    });
    return false;
  }
  if (process.env.NODE_ENV === "production" && !isLoopbackIp(request.ip)) {
    void reply.status(403).send({
      error: "Job list hydrate shadow is only allowed from loopback in production",
      code: "SHADOW_FORBIDDEN",
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
 * Internal-only: compare listing hydrate variants for the same id list (no public /jobs changes).
 * Register only when `JOB_LIST_SHADOW_SECRET` is set. Production: Bearer secret + loopback IP.
 */
export function registerJobListShadowRoutes(server: FastifyInstance): void {
  if (!process.env.JOB_LIST_SHADOW_SECRET?.trim()) {
    return;
  }

  server.get(
    "/internal/job-list/hydrate-shadow",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertJobListShadowAuthorized(request, reply)) {
        return;
      }

      const q = request.query as Record<string, unknown>;
      const pageRaw = q.page;
      const limitRaw = q.limit;
      const offsetRaw = q.offset;
      const page =
        typeof pageRaw === "string" || typeof pageRaw === "number"
          ? Math.max(1, parseInt(String(pageRaw), 10) || 1)
          : 1;
      const limit =
        typeof limitRaw === "string" || typeof limitRaw === "number"
          ? Math.min(100, Math.max(1, parseInt(String(limitRaw), 10) || 20))
          : 20;
      const offset =
        typeof offsetRaw === "string" || typeof offsetRaw === "number"
          ? Math.max(0, parseInt(String(offsetRaw), 10) || 0)
          : (page - 1) * limit;

      const filters = parseJobDiscoveryQuery(q);
      const sortRaw = String(q.sort ?? "latest");
      const sort: "latest" | "salary_desc" =
        sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";
      const includeProcessing = parseQueryBool(q.includeProcessing);

      const truncRaw = q.shadowDescChars ?? q.truncChars;
      let truncChars = 16_000;
      const envDefault = process.env.JOB_LIST_SHADOW_DESC_PREFIX?.trim();
      if (envDefault) {
        const n = Number(envDefault);
        if (Number.isFinite(n) && n > 0) {
          truncChars = Math.floor(n);
        }
      }
      if (typeof truncRaw === "string" || typeof truncRaw === "number") {
        const n = parseInt(String(truncRaw), 10);
        if (Number.isFinite(n) && n > 0) {
          truncChars = n;
        }
      }

      const payload = await runJobListHydrateShadow(server.prisma, {
        filters,
        sort,
        limit,
        offset,
        includeProcessing,
        truncChars,
      });

      return reply.send(payload);
    },
  );
}
