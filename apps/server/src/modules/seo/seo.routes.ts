import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SeoService } from "./seo.service.js";
import type { JobDiscoveryFilters } from "../job/job.repository.js";
import type { SeoAggregationsService } from "./seoAggregations.service.js";
import { experienceSlugToLevel, locationTokenToFilter } from "./seoDimensions.js";

function parseIntSafe(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function parseBoundedEnvInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function registerSeoRoutes(server: FastifyInstance, seo: SeoService): void {
  function isInternalSeoAuthorized(request: FastifyRequest): boolean {
    const marker = request.headers["x-internal-seo"];
    const secret = request.headers["x-internal-seo-secret"];
    const expected = process.env.INTERNAL_SEO_SECRET?.trim();
    return (
      marker === "true" &&
      typeof secret === "string" &&
      Boolean(expected) &&
      secret === expected
    );
  }

  server.get(
    "/seo/landing-pages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ok = isInternalSeoAuthorized(request);
      if (!ok) {
        return reply.status(401).send({
          error: "Unauthorized",
          code: "SEO_LANDING_UNAUTHORIZED",
        });
      }

      const q = request.query as Record<string, unknown>;
      const minCount = Math.max(1, parseIntSafe(q.minCount, 5));
      const defaultMaxSlugs = parseBoundedEnvInt(
        process.env.SEO_LANDING_DEFAULT_MAX_SLUGS,
        1500,
        50,
        5000,
      );
      const absoluteMaxSlugs = parseBoundedEnvInt(
        process.env.SEO_LANDING_ABSOLUTE_MAX_SLUGS,
        3000,
        100,
        10000,
      );
      const maxSlugs = Math.min(absoluteMaxSlugs, Math.max(10, parseIntSafe(q.maxSlugs, defaultMaxSlugs)));

      const { entries, stats } = await seo.listSeoLandingEntries({ minCount, maxSlugs });
      return reply.send({
        data: entries,
        meta: {
          minCount,
          maxSlugs,
          count: entries.length,
          rolesConsidered: stats.rolesConsidered,
          locationsConsidered: stats.locationsConsidered,
          experiencesConsidered: stats.experiencesConsidered,
          estimatedCountQueries: stats.estimatedCountQueries,
          estimatedTotalQueries: stats.estimatedTotalQueries,
        },
      });
    },
  );
}

function parseFiltersSlug(raw: string): JobDiscoveryFilters {
  const parts = raw
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: JobDiscoveryFilters = {};
  if (parts.length % 2 !== 0) return out;
  for (let i = 0; i < parts.length; i += 2) {
    const key = (parts[i] ?? "").toLowerCase();
    const value = (parts[i + 1] ?? "").toLowerCase();
    if (!key || !value) continue;
    if (key === "role") out.role = value;
    if (key === "category") out.category = value;
    if (key === "skill") out.skills = [value];
    if (key === "location") {
      const loc = locationTokenToFilter(value);
      if (loc.country) out.country = loc.country;
      else if (loc.workType) out.workType = loc.workType;
      else if (loc.location) out.location = loc.location;
    }
    if (key === "experience") {
      const exp = experienceSlugToLevel(value);
      if (exp) out.experienceLevel = exp;
    }
  }
  return out;
}

export function registerSeoAggregationRoutes(
  server: FastifyInstance,
  aggregations: SeoAggregationsService,
): void {
  function isInternalSeoAuthorized(request: FastifyRequest): boolean {
    const marker = request.headers["x-internal-seo"];
    const secret = request.headers["x-internal-seo-secret"];
    const expected = process.env.INTERNAL_SEO_SECRET?.trim();
    return (
      marker === "true" &&
      typeof secret === "string" &&
      Boolean(expected) &&
      secret === expected
    );
  }

  server.get("/seo/aggregations", async (request, reply) => {
    if (!isInternalSeoAuthorized(request)) {
      return reply.status(401).send({ error: "Unauthorized", code: "SEO_AGG_UNAUTHORIZED" });
    }
    const q = request.query as Record<string, unknown>;
    const raw = typeof q.filters === "string" ? q.filters : "";
    const filters = parseFiltersSlug(raw);
    const data = await aggregations.safeFetchAggregations(filters);
    return reply.send({ data });
  });
}
