import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { LISTING_EXCLUDED_ROLE_SLUGS } from "../job/jobListing.constants.js";
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
  estimatedCountQueries: number;
  estimatedTotalQueries: number;
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

  async function countByDimensions(input: {
    role: string;
    location?: string;
    experience?: string;
  }): Promise<number> {
    const role = normalizeRoleSlug(input.role);
    const location = input.location?.trim().toLowerCase();
    const experience = input.experience?.trim().toLowerCase();
    const expLevel = experience ? experienceSlugToLevel(experience) : undefined;
    const locFilter = location ? locationTokenToFilter(location) : {};

    const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND j."isActive" = true
        AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role NOT IN (${excludedSql})
        AND j.role = ${role}
        AND (${locFilter.country ? Prisma.sql`(j."locationCountry" = ${locFilter.country} OR (j."locationCountry" = 'UNKNOWN' AND j.country = ${locFilter.country}))` : Prisma.sql`TRUE`})
        AND (${locFilter.workType ? Prisma.sql`j."workType" = ${locFilter.workType}` : Prisma.sql`TRUE`})
        AND (${locFilter.location ? Prisma.sql`(j."locationRegion" ILIKE ${`%${locFilter.location}%`} OR j."locationCity" ILIKE ${`%${locFilter.location}%`} OR j.country ILIKE ${`%${locFilter.location}%`})` : Prisma.sql`TRUE`})
        AND (${expLevel ? Prisma.sql`j."experienceLevel" = ${expLevel}` : Prisma.sql`TRUE`})
    `;
    return Number(rows[0]?.c ?? 0);
  }

  async function listSeoLandingEntries(input: {
    minCount: number;
    maxSlugs: number;
  }): Promise<{ entries: SeoLandingEntry[]; stats: SeoLandingGenerationStats }> {
    const { minCount, maxSlugs } = input;
    const seen = new Set<string>();
    const out: SeoLandingEntry[] = [];
    const roleLimit = parsePositiveIntEnv(process.env.SEO_LANDING_MAX_ROLE_SLUGS, 20, 5, 100);
    const locationLimit = parsePositiveIntEnv(
      process.env.SEO_LANDING_MAX_LOCATION_DIMENSIONS,
      8,
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

    const roles = await topRoleSlugs(Math.min(roleLimit, maxSlugs));
    for (const r of roles) {
      if (out.length >= maxSlugs) break;
      // role only
      if (r.count >= minCount) {
        push(filtersToJobListingSlug({ role: r.role }), r.count);
      }

      for (const loc of selectedLocations) {
        if (out.length >= maxSlugs) break;
        const c = await countByDimensions({ role: r.role, location: loc });
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
        const c = await countByDimensions({ role: r.role, experience: exp });
        if (c >= minCount) {
          push(`role/${r.role}/experience/${exp}`, c);
        }
      }

      for (const loc of selectedLocations) {
        if (out.length >= maxSlugs) break;
        for (const exp of selectedExperiences) {
          if (out.length >= maxSlugs) break;
          const c = await countByDimensions({ role: r.role, location: loc, experience: exp });
          if (c >= minCount) {
            push(`role/${r.role}/location/${loc}/experience/${exp}`, c);
          }
        }
      }
    }

    const rolesConsidered = roles.length;
    const locationsConsidered = selectedLocations.length;
    const experiencesConsidered = selectedExperiences.length;
    const estimatedCountQueries =
      rolesConsidered * (locationsConsidered + experiencesConsidered + locationsConsidered * experiencesConsidered);
    return {
      entries: out.slice(0, maxSlugs),
      stats: {
        rolesConsidered,
        locationsConsidered,
        experiencesConsidered,
        estimatedCountQueries,
        estimatedTotalQueries: estimatedCountQueries + 1, // +1 for topRoleSlugs()
      },
    };
  }

  return { listSeoLandingEntries, topRoleSlugs };
}

export type SeoService = ReturnType<typeof createSeoService>;
