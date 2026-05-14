import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { LISTING_EXCLUDED_ROLE_SLUGS } from "../job/jobListing.constants.js";
import { JOB_CATEGORIES } from "../../config/taxonomy.js";
import { filtersToJobListingSlug } from "../../utils/jobListingSlug.js";
import {
  SEO_DIMENSIONS,
  experienceSlugToLevel,
  locationTokenToFilter,
} from "./seoDimensions.js";

function normalizeRoleSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface SeoLandingEntry {
  slug: string;
  count: number;
}

export interface SeoLandingGenerationStats {
  rolesConsidered: number;
  locationsConsidered: number;
  experiencesConsidered: number;
  categoriesEmitted: number;
  locationHubsEmitted: number;
  estimatedCountQueries: number;
  estimatedTotalQueries: number;
  batchDurationMs?: number;
}

function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Builds slugs that match client `parseSlug` / `filtersToSlug`: category must lead the path
 * (see `apps/client/lib/slug-parser.ts`). Bare skill-only URLs are not supported by the parser.
 */
export function createSeoService(prisma: PrismaClient) {
  const excludedSql = Prisma.join(
    LISTING_EXCLUDED_ROLE_SLUGS.map((e) => Prisma.sql`${e}`),
  );

  async function topRoleSlugs(limit = 100): Promise<Array<{ role: string; count: number }>> {
    const rows = await prisma.$queryRaw<Array<{ role: string; count: bigint }>>`
      SELECT j.role, COUNT(*)::bigint AS count
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND j."isActive" = true
        AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role NOT IN (${excludedSql})
        AND LENGTH(TRIM(j.role)) > 1
      GROUP BY j.role
      ORDER BY count DESC
      LIMIT ${Math.min(200, Math.max(10, limit))}
    `;
    return rows
      .map((r) => ({ role: normalizeRoleSlug(r.role), count: Number(r.count) }))
      .filter((r) => r.role.length > 0);
  }

  // ── Batched dimension counting ──────────────────────────────────────
  // Replaces N×M sequential countByDimensions() calls with 2–3 bulk queries.

  interface DimCountRow {
    role: string;
    location_country: string;
    work_type: string;
    experience_level: string | null;
    c: bigint;
  }

  interface EuropeCountRow {
    role: string;
    experience_level: string | null;
    c: bigint;
  }

  /**
   * Single GROUP BY covering all role×country×workType×experience combos
   * for the supplied role names.  Returns ~300 rows for 22 roles (~0.5s).
   */
  async function batchCountsByDimensions(
    roleNames: string[],
  ): Promise<DimCountRow[]> {
    if (roleNames.length === 0) return [];
    const rolesSql = Prisma.join(roleNames.map((r) => Prisma.sql`${r}`));
    return prisma.$queryRaw<DimCountRow[]>`
      SELECT j.role,
             j."locationCountry" AS location_country,
             j."workType"        AS work_type,
             j."experienceLevel" AS experience_level,
             COUNT(*)::bigint    AS c
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND j."isActive" = true
        AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role IN (${rolesSql})
      GROUP BY j.role, j."locationCountry", j."workType", j."experienceLevel"
    `;
  }

  /**
   * Supplemental batch for the "europe" ILIKE dimension which can't be
   * resolved from locationCountry alone.  Returns ~40 rows (~0.3s).
   */
  async function batchEuropeCounts(
    roleNames: string[],
  ): Promise<EuropeCountRow[]> {
    if (roleNames.length === 0) return [];
    const rolesSql = Prisma.join(roleNames.map((r) => Prisma.sql`${r}`));
    return prisma.$queryRaw<EuropeCountRow[]>`
      SELECT j.role,
             j."experienceLevel" AS experience_level,
             COUNT(*)::bigint    AS c
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND j."isActive" = true
        AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role IN (${rolesSql})
        AND (j."locationRegion" ILIKE '%europe%'
             OR j."locationCity" ILIKE '%europe%'
             OR j.country ILIKE '%europe%')
      GROUP BY j.role, j."experienceLevel"
    `;
  }

  type CountLookup = Map<string, number>;

  /**
   * Build an in-memory lookup keyed as "role|locToken|expSlug" from the
   * batch query results, using the same locationTokenToFilter mapping the
   * old per-query path used.
   */
  function buildCountLookup(
    dimRows: DimCountRow[],
    europeRows: EuropeCountRow[],
    locations: readonly string[],
    experiences: readonly string[],
  ): CountLookup {
    const lookup: CountLookup = new Map();

    const inc = (key: string, n: number) =>
      lookup.set(key, (lookup.get(key) ?? 0) + n);

    const countryToTokens = new Map<string, string[]>();
    const workTypeToTokens = new Map<string, string[]>();
    const ilikeLocs: string[] = [];
    for (const loc of locations) {
      const f = locationTokenToFilter(loc);
      if (f.country) {
        const arr = countryToTokens.get(f.country) ?? [];
        arr.push(loc);
        countryToTokens.set(f.country, arr);
      } else if (f.workType) {
        const arr = workTypeToTokens.get(f.workType) ?? [];
        arr.push(loc);
        workTypeToTokens.set(f.workType, arr);
      } else if (f.location) {
        ilikeLocs.push(loc);
      }
    }

    const expSlugToLevel = new Map<string, string>();
    for (const exp of experiences) {
      const lvl = experienceSlugToLevel(exp);
      if (lvl) expSlugToLevel.set(exp, lvl);
    }
    const levelToExpSlugs = new Map<string, string[]>();
    for (const [slug, lvl] of expSlugToLevel) {
      const arr = levelToExpSlugs.get(lvl) ?? [];
      arr.push(slug);
      levelToExpSlugs.set(lvl, arr);
    }

    for (const row of dimRows) {
      const n = Number(row.c);
      const role = normalizeRoleSlug(row.role);
      const country = row.location_country;
      const wt = row.work_type;
      const rawExp = row.experience_level ?? "";

      const matchedLocTokens: string[] = [];
      if (country && countryToTokens.has(country)) {
        matchedLocTokens.push(...countryToTokens.get(country)!);
      }
      if (wt && workTypeToTokens.has(wt)) {
        matchedLocTokens.push(...workTypeToTokens.get(wt)!);
      }

      const matchedExpSlugs: string[] = [];
      if (rawExp && levelToExpSlugs.has(rawExp)) {
        matchedExpSlugs.push(...levelToExpSlugs.get(rawExp)!);
      }

      for (const locToken of matchedLocTokens) {
        inc(`${role}|${locToken}|`, n);
        for (const expSlug of matchedExpSlugs) {
          inc(`${role}|${locToken}|${expSlug}`, n);
        }
      }

      for (const expSlug of matchedExpSlugs) {
        inc(`${role}||${expSlug}`, n);
      }
    }

    for (const row of europeRows) {
      const n = Number(row.c);
      const role = normalizeRoleSlug(row.role);
      const rawExp = row.experience_level ?? "";
      for (const loc of ilikeLocs) {
        inc(`${role}|${loc}|`, n);
        if (rawExp) {
          const matchedExpSlugs = levelToExpSlugs.get(rawExp) ?? [];
          for (const expSlug of matchedExpSlugs) {
            inc(`${role}|${loc}|${expSlug}`, n);
          }
        }
      }
    }

    return lookup;
  }

  async function listSeoLandingEntries(input: {
    minCount: number;
    maxSlugs: number;
  }): Promise<{ entries: SeoLandingEntry[]; stats: SeoLandingGenerationStats }> {
    const { minCount, maxSlugs } = input;
    const seen = new Set<string>();
    const out: SeoLandingEntry[] = [];
    const roleLimit = parsePositiveIntEnv(process.env.SEO_LANDING_MAX_ROLE_SLUGS, 22, 5, 100);
    const locationLimit = parsePositiveIntEnv(
      process.env.SEO_LANDING_MAX_LOCATION_DIMENSIONS,
      9,
      1,
      SEO_DIMENSIONS.locations.length,
    );
    const experienceLimit = parsePositiveIntEnv(
      process.env.SEO_LANDING_MAX_EXPERIENCE_DIMENSIONS,
      2,
      1,
      SEO_DIMENSIONS.experience.length,
    );
    const selectedLocations = SEO_DIMENSIONS.locations.slice(0, locationLimit);
    const selectedExperiences = SEO_DIMENSIONS.experience.slice(0, experienceLimit);

    const push = (slug: string, count: number) => {
      if (!slug || seen.has(slug) || out.length >= maxSlugs) return;
      seen.add(slug);
      out.push({ slug, count });
    };

    const batchStart = Date.now();

    const roles = await topRoleSlugs(Math.min(roleLimit, maxSlugs));
    const roleNames = roles.map((r) => r.role);

    const needsEurope = selectedLocations.some(
      (l) => locationTokenToFilter(l).location != null,
    );
    const [dimRows, europeRows] = await Promise.all([
      batchCountsByDimensions(roleNames),
      needsEurope ? batchEuropeCounts(roleNames) : Promise.resolve([]),
    ]);

    const counts = buildCountLookup(
      dimRows,
      europeRows,
      selectedLocations,
      selectedExperiences,
    );
    const batchDurationMs = Date.now() - batchStart;

    // ── Category hub pages ─────────────────────────────────────────────
    // Derived from taxonomy constants. Uses aggregate role counts from the
    // batch data to estimate per-category totals (no additional DB query).
    // Categories with zero matched roles are still emitted when the overall
    // job corpus clearly exceeds minCount (defensive: the rendered page will
    // show the real count via the listing endpoint at SSR time).
    let categoriesEmitted = 0;
    const totalJobCount = roles.reduce((sum, r) => sum + r.count, 0);
    for (const cat of JOB_CATEGORIES) {
      if (cat === "other") continue;
      if (out.length >= maxSlugs) break;
      const estimatedCount = Math.max(minCount, Math.floor(totalJobCount / JOB_CATEGORIES.length));
      push(`category/${cat}`, estimatedCount);
      categoriesEmitted++;
    }

    // ── Location hub pages ─────────────────────────────────────────────
    // Derived from SEO_DIMENSIONS.locations. Sums batch dimension rows across
    // all roles for each location token to approximate per-location totals.
    let locationHubsEmitted = 0;
    for (const loc of selectedLocations) {
      if (out.length >= maxSlugs) break;
      let locTotal = 0;
      for (const r of roles) {
        locTotal += counts.get(`${r.role}|${loc}|`) ?? 0;
      }
      if (locTotal >= minCount) {
        const locFilter = locationTokenToFilter(loc);
        const slug = filtersToJobListingSlug({
          country: locFilter.country,
          isRemote: locFilter.isRemote,
          workType: locFilter.workType,
        }) || `location/${loc}`;
        push(slug, locTotal);
        locationHubsEmitted++;
      }
    }

    // ── Role-based pages (existing) ────────────────────────────────────
    for (const r of roles) {
      if (out.length >= maxSlugs) break;
      if (r.count >= minCount) {
        push(filtersToJobListingSlug({ role: r.role }), r.count);
      }

      for (const loc of selectedLocations) {
        if (out.length >= maxSlugs) break;
        const c = counts.get(`${r.role}|${loc}|`) ?? 0;
        if (c >= minCount) {
          const locFilter = locationTokenToFilter(loc);
          push(
            filtersToJobListingSlug({
              role: r.role,
              country: locFilter.country,
              isRemote: locFilter.isRemote,
              workType: locFilter.workType,
            }) || `role/${r.role}/location/${loc}`,
            c,
          );
        }
      }

      for (const exp of selectedExperiences) {
        if (out.length >= maxSlugs) break;
        const c = counts.get(`${r.role}||${exp}`) ?? 0;
        if (c >= minCount) {
          push(`role/${r.role}/experience/${exp}`, c);
        }
      }

      for (const loc of selectedLocations) {
        if (out.length >= maxSlugs) break;
        for (const exp of selectedExperiences) {
          if (out.length >= maxSlugs) break;
          const c = counts.get(`${r.role}|${loc}|${exp}`) ?? 0;
          if (c >= minCount) {
            push(`role/${r.role}/location/${loc}/experience/${exp}`, c);
          }
        }
      }
    }

    const rolesConsidered = roles.length;
    const locationsConsidered = selectedLocations.length;
    const experiencesConsidered = selectedExperiences.length;
    return {
      entries: out.slice(0, maxSlugs),
      stats: {
        rolesConsidered,
        locationsConsidered,
        experiencesConsidered,
        categoriesEmitted,
        locationHubsEmitted,
        estimatedCountQueries: 3,
        estimatedTotalQueries: 3,
        batchDurationMs,
      },
    };
  }

  return { listSeoLandingEntries, topRoleSlugs };
}

export type SeoService = ReturnType<typeof createSeoService>;
