import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import countries from "i18n-iso-countries";
import { COUNTRY_LIST, searchCountries } from "../../config/countries.js";
import {
  CITY_TO_COUNTRY,
  getRegions,
  GLOBAL_REGION_LABEL,
  isCountryLevelLocation,
  REGION_MAP,
} from "../../utils/locationResolver.js";
import {
  getCitiesQuerySchema,
  getCountriesQuerySchema,
  getLocationsSchema,
} from "../job/job.schema.js";

const CITIES_SUGGEST_LIMIT = 10;
/** Fetch extra rows from DB so filtering country-level junk still fills the limit. */
const CITIES_SUGGEST_FETCH = 50;

type CitySuggestionRow = {
  city: string;
  country: string;
  region: string;
  count: number;
};

function citySuggestionKey(row: Pick<CitySuggestionRow, "city" | "country">): string {
  if (isCountryLevelLocation(row.city)) {
    return `country:${row.country.toUpperCase()}`;
  }
  return `${row.city.toLowerCase().replace(/\s+/g, " ").trim()}|${row.country.toUpperCase()}`;
}

/** Drop country-only junk, merge casing variants, keep highest job count per place. */
function mergeCitySuggestions(rows: CitySuggestionRow[]): CitySuggestionRow[] {
  const map = new Map<string, CitySuggestionRow>();
  for (const row of rows) {
    if (isCountryLevelLocation(row.city)) continue;
    const key = citySuggestionKey(row);
    const existing = map.get(key);
    if (!existing || row.count > existing.count) {
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function appendUniqueSuggestions(
  out: CitySuggestionRow[],
  seen: Set<string>,
  extra: CitySuggestionRow[],
  limit: number,
): void {
  for (const row of extra) {
    if (out.length >= limit) break;
    const key = citySuggestionKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
}

/**
 * Full ISO country list grouped by resolver region (not only countries that
 * already have jobs), so region → country pickers stay usable on sparse data.
 */
function buildCountriesCatalogForFilters(): Array<{
  code: string;
  name: string;
  region: string;
}> {
  const out: Array<{ code: string; name: string; region: string }> = [];
  for (const { code, name } of COUNTRY_LIST) {
    const region = REGION_MAP[code];
    if (!region) continue;
    out.push({ code, name, region });
  }
  out.push({
    code: "GLOBAL",
    name: GLOBAL_REGION_LABEL,
    region: GLOBAL_REGION_LABEL,
  });
  out.sort((a, b) => {
    const rg = a.region.localeCompare(b.region);
    if (rg !== 0) return rg;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * When `locationCity` is mostly empty in the DB, still return useful matches by
 * ISO country (English name or alpha-2 contains `q`), sorted by job count.
 */
function countryNameSuggestions(
  rows: Array<{ locationCountry: string; _count: { id: number } }>,
  q: string,
  take: number,
): CitySuggestionRow[] {
  if (take <= 0) return [];
  const qLower = q.toLowerCase();
  const matches: CitySuggestionRow[] = [];
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
): CitySuggestionRow[] {
  if (take <= 0) return [];
  const qLower = q.toLowerCase();
  const hits: CitySuggestionRow[] = [];
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
      const countryObjs = buildCountriesCatalogForFilters();

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

      const rows = (await server.prisma.job.groupBy({
        by: ["locationCity", "locationCountry", "locationRegion"],
        where: {
          canonicalJobId: null,
          status: "ready",
          locationCity: {
            not: null,
            contains: q,
            mode: "insensitive",
          },
          NOT: { locationCity: "" },
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: CITIES_SUGGEST_FETCH,
      } as never)) as Array<{
        locationCity: string | null;
        locationCountry: string | null;
        locationRegion: string | null;
        _count: { id: number };
      }>;

      const mapped: CitySuggestionRow[] = rows.map((r) => {
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
      });

      const out = mergeCitySuggestions(mapped).slice(0, CITIES_SUGGEST_LIMIT);
      const seen = new Set(out.map((o) => citySuggestionKey(o)));

      if (out.length < CITIES_SUGGEST_LIMIT) {
        const byCountry = (await server.prisma.job.groupBy({
          by: ["locationCountry"],
          where: {
            canonicalJobId: null,
            locationCountry: { not: "UNKNOWN" },
            status: "ready",
          },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 200,
        } as never)) as Array<{ locationCountry: string; _count: { id: number } }>;
        const codeToCount = new Map(
          byCountry.map((r) => [r.locationCountry, r._count.id] as const),
        );

        appendUniqueSuggestions(
          out,
          seen,
          countryNameSuggestions(byCountry, q, CITIES_SUGGEST_LIMIT - out.length),
          CITIES_SUGGEST_LIMIT,
        );

        if (out.length < CITIES_SUGGEST_LIMIT) {
          appendUniqueSuggestions(
            out,
            seen,
            cityAliasPlaceSuggestions(
              codeToCount,
              q,
              CITIES_SUGGEST_LIMIT - out.length,
            ),
            CITIES_SUGGEST_LIMIT,
          );
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
