import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import countries from "i18n-iso-countries";
import { searchCountries } from "../../config/countries.js";
import { CITY_TO_COUNTRY, getRegions, REGION_MAP } from "../../utils/locationResolver.js";
import {
  getCitiesQuerySchema,
  getCountriesQuerySchema,
  getLocationsSchema,
} from "../job/job.schema.js";

const CITIES_SUGGEST_LIMIT = 10;

/**
 * When `locationCity` is mostly empty in the DB, still return useful matches by
 * ISO country (English name or alpha-2 contains `q`), sorted by job count.
 */
function countryNameSuggestions(
  rows: Array<{ locationCountry: string; _count: { id: number } }>,
  q: string,
  take: number,
): Array<{ city: string; country: string; region: string; count: number }> {
  if (take <= 0) return [];
  const qLower = q.toLowerCase();
  const matches: Array<{ city: string; country: string; region: string; count: number }> = [];
  for (const r of rows) {
    const code = r.locationCountry;
    if (!code || code === "UNKNOWN") continue;
    const name = countries.getName(code, "en") ?? code;
    if (!name.toLowerCase().includes(qLower) && !code.toLowerCase().includes(qLower)) continue;
    matches.push({
      city: name,
      country: code,
      region: REGION_MAP[code] ?? "Unknown",
      count: r._count.id,
    });
  }
  matches.sort((a, b) => b.count - a.count);
  return matches.slice(0, take);
}

function cityAliasPlaceSuggestions(
  codeToCount: Map<string, number>,
  q: string,
  take: number,
): Array<{ city: string; country: string; region: string; count: number }> {
  if (take <= 0) return [];
  const qLower = q.toLowerCase();
  const hits: Array<{ city: string; country: string; region: string; count: number }> = [];
  for (const [cityKey, code] of Object.entries(CITY_TO_COUNTRY)) {
    const parts = cityKey.split(/[\s-]+/);
    if (!parts.some((p) => p.startsWith(qLower))) continue;
    const count = codeToCount.get(code);
    if (count === undefined || count < 1) continue;
    const sep = cityKey.includes("-") ? "-" : cityKey.includes(" ") ? " " : "";
    const city =
      sep === ""
        ? cityKey.charAt(0).toUpperCase() + cityKey.slice(1)
        : cityKey
            .split(/[\s-]+/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(sep);
    hits.push({
      city,
      country: code,
      region: REGION_MAP[code] ?? "Unknown",
      count,
    });
  }
  hits.sort((a, b) => b.count - a.count);
  return hits.slice(0, take);
}

export function registerLocationRoutes(server: FastifyInstance): void {
  server.log.info(
    {
      event: "routes_registered",
      module: "locations",
      paths: ["GET /locations", "GET /locations/cities?q=", "GET /locations/countries?q="],
    },
    "Location routes registered (no /api prefix on Fastify server)",
  );
  server.get(
    "/locations",
    { schema: getLocationsSchema },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rows = await server.prisma.job.groupBy({
        by: ["locationCountry"],
        where: { canonicalJobId: null },
      });

      const codes = rows
        .map((r) => r.locationCountry)
        .filter((c): c is string => typeof c === "string" && c.length > 0 && c !== "UNKNOWN");

      const countryObjs = codes.map((code) => ({
        code,
        name: countries.getName(code, "en") ?? code,
        region: REGION_MAP[code] ?? "Unknown",
      }));

      countryObjs.sort((a, b) => {
        const rg = a.region.localeCompare(b.region);
        if (rg !== 0) return rg;
        return a.name.localeCompare(b.name);
      });

      const regions = [...getRegions()].sort((a, b) => a.localeCompare(b));

      return reply.send({
        regions,
        countries: countryObjs,
      });
    },
  );

  server.get(
    "/locations/cities",
    { schema: getCitiesQuerySchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = (request.query as { q?: string }).q?.trim() ?? "";
      if (q.length < 2) {
        return reply.send([]);
      }

      const rows = await server.prisma.job.groupBy({
        by: ["locationCity", "locationCountry", "locationRegion"],
        where: {
          canonicalJobId: null,
          locationCity: {
            not: null,
            contains: q,
            mode: "insensitive",
          },
          NOT: { locationCity: "" },
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: CITIES_SUGGEST_LIMIT,
      });

      const out: Array<{ city: string; country: string; region: string; count: number }> = rows.map(
        (r) => {
          const code = r.locationCountry ?? "";
          const region =
            r.locationRegion?.trim() ||
            (code ? (REGION_MAP[code] ?? "Unknown") : "Unknown");
          return {
            city: r.locationCity!,
            country: code.length > 0 ? code : "UNKNOWN",
            region,
            count: r._count.id,
          };
        },
      );

      if (out.length < CITIES_SUGGEST_LIMIT) {
        const byCountry = await server.prisma.job.groupBy({
          by: ["locationCountry"],
          where: { canonicalJobId: null, locationCountry: { not: "UNKNOWN" } },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 200,
        });
        const codeToCount = new Map(
          byCountry.map((r) => [r.locationCountry, r._count.id] as const),
        );
        const seen = new Set(out.map((o) => o.city.toLowerCase()));

        const countryExtra = countryNameSuggestions(
          byCountry,
          q,
          CITIES_SUGGEST_LIMIT - out.length,
        );
        for (const row of countryExtra) {
          if (out.length >= CITIES_SUGGEST_LIMIT) break;
          const k = row.city.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(row);
        }

        if (out.length < CITIES_SUGGEST_LIMIT) {
          const aliasExtra = cityAliasPlaceSuggestions(
            codeToCount,
            q,
            CITIES_SUGGEST_LIMIT - out.length,
          );
          for (const row of aliasExtra) {
            if (out.length >= CITIES_SUGGEST_LIMIT) break;
            const k = row.city.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(row);
          }
        }
      }

      return reply.send(out);
    },
  );

  server.get(
    "/locations/countries",
    { schema: getCountriesQuerySchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { q?: string };
      const query = typeof q.q === "string" ? q.q : "";
      const results = searchCountries(query, 15).map((c) => ({
        name: c.name,
        code: c.code,
        slug: c.slug,
      }));
      return reply.send(results);
    },
  );
}
