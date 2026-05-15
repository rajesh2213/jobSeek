import type { PrismaClient } from "@prisma/client";
import { buildDiscoveryWhereSql, type JobDiscoveryFilters } from "../job/job.repository.js";
import { readCachedAggregations, writeCachedAggregations } from "./seoAggregationCache.js";

export interface SeoAggregations {
  topSkills: Array<{ skill: string; count: number }>;
  topCompanies: Array<{ companyId: string; name: string; count: number }>;
  salary: { avg: number | null; min: number | null; max: number | null };
  hiringTrend: Array<{ day: string; count: number }>;
}

export function createSeoAggregationsService(prisma: PrismaClient) {
  async function fetchAggregations(filters: JobDiscoveryFilters): Promise<SeoAggregations> {
    const whereSql = buildDiscoveryWhereSql(filters);

    const topSkillsRows = await prisma.$queryRaw<Array<{ skill: string; count: bigint }>>`
      SELECT LOWER(TRIM(s.skill)) AS skill, COUNT(*)::bigint AS count
      FROM "Job" j
      CROSS JOIN LATERAL unnest(j.skills) AS s(skill)
      WHERE ${whereSql}
        AND LENGTH(TRIM(s.skill)) > 1
      GROUP BY LOWER(TRIM(s.skill))
      ORDER BY count DESC
      LIMIT 10
    `;

    const topCompaniesRows = await prisma.$queryRaw<
      Array<{ companyId: string; name: string; count: bigint }>
    >`
      SELECT j."companyId" AS "companyId", c.name AS name, COUNT(*)::bigint AS count
      FROM "Job" j
      JOIN "Company" c ON c.id = j."companyId"
      WHERE ${whereSql}
      GROUP BY j."companyId", c.name
      ORDER BY count DESC
      LIMIT 10
    `;

    const salaryRows = await prisma.$queryRaw<
      Array<{ avg: number | null; min: number | null; max: number | null }>
    >`
      SELECT
        AVG(j."salaryMin")::float8 AS avg,
        MIN(j."salaryMin")::int AS min,
        MAX(j."salaryMin")::int AS max
      FROM "Job" j
      WHERE ${whereSql}
        AND j."salaryMin" IS NOT NULL
        AND j."salaryMin" > 0
    `;

    /**
     * Strategy A (freshness-overhaul Phase 6): hiring-trend buckets are
     * supposed to mean "jobs posted per day". Mixing in crawl timestamps as
     * "posted on the crawl date" inflated the chart for sources that don't
     * supply postedAt (wellfound, careers_page) — visible on SEO landing
     * pages as a flat plateau coinciding with our crawl cadence.
     *
     * Bucket strictly by `postedAt`. Rows without a real publish date are
     * excluded — they don't represent dated hiring activity. Sources where
     * coverage is poor will show empty plateaus until adapter improvements
     * (Phase 6 follow-up: careers_page JSON-LD datePosted extraction).
     */
    const trendRows = await prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT TO_CHAR(DATE_TRUNC('day', j."postedAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::bigint AS count
      FROM "Job" j
      WHERE ${whereSql}
        AND j."postedAt" IS NOT NULL
        AND j."postedAt" >= NOW() - INTERVAL '14 days'
      GROUP BY DATE_TRUNC('day', j."postedAt")
      ORDER BY DATE_TRUNC('day', j."postedAt") DESC
      LIMIT 14
    `;

    const salary = salaryRows[0] ?? { avg: null, min: null, max: null };
    return {
      topSkills: topSkillsRows.map((r) => ({ skill: r.skill, count: Number(r.count) })),
      topCompanies: topCompaniesRows.map((r) => ({
        companyId: r.companyId,
        name: r.name,
        count: Number(r.count),
      })),
      salary,
      hiringTrend: trendRows.map((r) => ({ day: r.day, count: Number(r.count) })),
    };
  }

  async function safeFetchAggregations(filters: JobDiscoveryFilters): Promise<SeoAggregations> {
    const cached = await readCachedAggregations(filters);
    if (cached) return cached;

    try {
      const data = await fetchAggregations(filters);
      await writeCachedAggregations(filters, data);
      return data;
    } catch (_err) {
      return {
        topSkills: [],
        topCompanies: [],
        salary: { avg: null, min: null, max: null },
        hiringTrend: [],
      };
    }
  }

  return { fetchAggregations, safeFetchAggregations };
}

export type SeoAggregationsService = ReturnType<typeof createSeoAggregationsService>;
