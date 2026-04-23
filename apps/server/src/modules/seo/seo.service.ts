import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { LISTING_EXCLUDED_ROLE_SLUGS } from "../job/jobListing.constants.js";
import { filtersToJobListingSlug } from "../../utils/jobListingSlug.js";

/** ISO countries prioritized for programmatic landing URLs. */
const PRIORITY_COUNTRIES = [
  "US",
  "IN",
  "GB",
  "DE",
  "CA",
  "AU",
  "FR",
  "NL",
  "SG",
  "ES",
] as const;

export interface SeoLandingEntry {
  slug: string;
  count: number;
}

/**
 * Builds slugs that match client `parseSlug` / `filtersToSlug`: category must lead the path
 * (see `apps/client/lib/slug-parser.ts`). Bare skill-only URLs are not supported by the parser.
 */
export function createSeoService(prisma: PrismaClient) {
  const excludedSql = Prisma.join(
    LISTING_EXCLUDED_ROLE_SLUGS.map((e) => Prisma.sql`${e}`),
  );

  async function listSeoLandingEntries(input: {
    minCount: number;
    maxSlugs: number;
  }): Promise<SeoLandingEntry[]> {
    const { minCount, maxSlugs } = input;
    const seen = new Set<string>();
    const out: SeoLandingEntry[] = [];

    const push = (slug: string, count: number) => {
      if (!slug || seen.has(slug) || out.length >= maxSlugs) return;
      seen.add(slug);
      out.push({ slug, count });
    };

    const catRows = await prisma.$queryRaw<{ category: string; count: bigint }[]>`
      SELECT j.category, COUNT(*)::bigint AS count
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role NOT IN (${excludedSql})
        AND j.category <> 'other'
      GROUP BY j.category
      HAVING COUNT(*) >= ${minCount}
      ORDER BY count DESC
    `;
    for (const r of catRows) {
      push(filtersToJobListingSlug({ category: r.category }), Number(r.count));
    }

    const catRemote = await prisma.$queryRaw<{ category: string; count: bigint }[]>`
      SELECT j.category, COUNT(*)::bigint AS count
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role NOT IN (${excludedSql})
        AND j.category <> 'other'
        AND j."workType" = 'remote'
      GROUP BY j.category
      HAVING COUNT(*) >= ${minCount}
      ORDER BY count DESC
    `;
    for (const r of catRemote) {
      push(
        filtersToJobListingSlug({
          category: r.category,
          isRemote: true,
          workType: "remote",
        }),
        Number(r.count),
      );
    }

    for (const cc of PRIORITY_COUNTRIES) {
      const catCountry = await prisma.$queryRaw<{ category: string; count: bigint }[]>`
        SELECT j.category, COUNT(*)::bigint AS count
        FROM "Job" j
        WHERE j."canonicalJobId" IS NULL
          AND (j."status" = 'ready' OR j."status" IS NULL)
          AND j.role NOT IN (${excludedSql})
          AND j.category <> 'other'
          AND (
            j."locationCountry" = ${cc}
            OR (j."locationCountry" = 'UNKNOWN' AND j.country = ${cc})
          )
        GROUP BY j.category
        HAVING COUNT(*) >= ${minCount}
        ORDER BY count DESC
      `;
      for (const r of catCountry) {
        push(
          filtersToJobListingSlug({
            category: r.category,
            country: cc,
          }),
          Number(r.count),
        );
      }
    }

    const catSkill = await prisma.$queryRaw<
      { category: string; skill: string; count: bigint }[]
    >`
      SELECT j.category, LOWER(TRIM(s.skill)) AS skill, COUNT(*)::bigint AS count
      FROM "Job" j
      CROSS JOIN LATERAL unnest(j.skills) AS s(skill)
      WHERE j."canonicalJobId" IS NULL
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.role NOT IN (${excludedSql})
        AND j.category <> 'other'
        AND LENGTH(TRIM(s.skill)) > 1
      GROUP BY j.category, LOWER(TRIM(s.skill))
      HAVING COUNT(*) >= ${minCount}
      ORDER BY count DESC
      LIMIT 400
    `;
    for (const r of catSkill) {
      push(
        filtersToJobListingSlug({
          category: r.category,
          skills: [r.skill],
        }),
        Number(r.count),
      );
    }

    for (const cc of PRIORITY_COUNTRIES) {
      const catSkillCountry = await prisma.$queryRaw<
        { category: string; skill: string; count: bigint }[]
      >`
        SELECT j.category, LOWER(TRIM(s.skill)) AS skill, COUNT(*)::bigint AS count
        FROM "Job" j
        CROSS JOIN LATERAL unnest(j.skills) AS s(skill)
        WHERE j."canonicalJobId" IS NULL
          AND (j."status" = 'ready' OR j."status" IS NULL)
          AND j.role NOT IN (${excludedSql})
          AND j.category <> 'other'
          AND LENGTH(TRIM(s.skill)) > 1
          AND (
            j."locationCountry" = ${cc}
            OR (j."locationCountry" = 'UNKNOWN' AND j.country = ${cc})
          )
        GROUP BY j.category, LOWER(TRIM(s.skill))
        HAVING COUNT(*) >= ${minCount}
        ORDER BY count DESC
        LIMIT 200
      `;
      for (const r of catSkillCountry) {
        push(
          filtersToJobListingSlug({
            category: r.category,
            skills: [r.skill],
            country: cc,
          }),
          Number(r.count),
        );
      }
    }

    return out.slice(0, maxSlugs);
  }

  return { listSeoLandingEntries };
}

export type SeoService = ReturnType<typeof createSeoService>;
