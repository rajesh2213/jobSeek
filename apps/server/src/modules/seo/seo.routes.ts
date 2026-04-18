import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SeoService } from "./seo.service.js";

function parseIntSafe(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

export function registerSeoRoutes(server: FastifyInstance, seo: SeoService): void {
  server.get(
    "/seo/landing-pages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bypassToken = process.env.JOB_LIST_VIEW_CAP_BYPASS_TOKEN?.trim();
      const header = request.headers["x-jobseek-view-cap-bypass"];
      const ok =
        Boolean(bypassToken) &&
        typeof header === "string" &&
        header === bypassToken;
      if (!ok) {
        return reply.status(401).send({
          error: "Unauthorized",
          code: "SEO_LANDING_UNAUTHORIZED",
        });
      }

      const q = request.query as Record<string, unknown>;
      const minCount = Math.max(1, parseIntSafe(q.minCount, 5));
      const maxSlugs = Math.min(5000, Math.max(10, parseIntSafe(q.maxSlugs, 1500)));

      const entries = await seo.listSeoLandingEntries({ minCount, maxSlugs });
      return reply.send({
        data: entries,
        meta: { minCount, maxSlugs, count: entries.length },
      });
    },
  );
}
