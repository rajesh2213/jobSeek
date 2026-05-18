import type { PrismaClient } from "@prisma/client";
import { buildDiscoveryWhereSql, type JobDiscoveryFilters } from "../job/job.repository.js";
import { readCachedAggregations, writeCachedAggregations } from "./seoAggregationCache.js";
import { aggregationQueryTimeoutMs, withAggregationTimeout } from "./seoAggregationTimeout.js";

export interface SeoAggregations {
  topSkills: Array<{ skill: string; count: number }>;
  topCompanies: Array<{ companyId: string; name: string; count: number }>;
  salary: { avg: number | null; min: number | null; max: number | null };
  hiringTrend: Array<{ day: string; count: number }>;
}

/** Cap rows scanned for skill unnest — sidebar signal, not analytics-grade totals. */
const SKILL_AGGREGATION_JOB_CAP = 4000;

function hasAggregationContent(data: SeoAggregations): boolean {
  if (data.topSkills.length > 0 || data.topCompanies.length > 0) return true;
  if (data.hiringTrend.some((d) => d.count > 0)) return true;
  const { min, max, avg } = data.salary;
  return (
    (typeof min === "number" && min > 0) ||
    (typeof max === "number" && max > 0) ||
    (typeof avg === "number" && avg > 0)
  );
}

export function createSeoAggregationsService(prisma: PrismaClient) {
  async function fetchAggregations(filters: JobDiscoveryFilters): Promise<SeoAggregations> {
    const whereSql = buildDiscoveryWhereSql(filters);
    const txTimeout = aggregationQueryTimeoutMs();

    return prisma.$transaction(
      async (tx) => {
        const topCompaniesRows = await tx.$queryRaw<
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

        const salaryRows = await tx.$queryRaw<
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

        const trendRows = await tx.$queryRaw<Array<{ day: string; count: bigint }>>`
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

        const topSkillsRows = await tx.$queryRaw<Array<{ skill: string; count: bigint }>>`
          WITH recent_jobs AS (
            SELECT j.skills
            FROM "Job" j
            WHERE ${whereSql}
            LIMIT ${SKILL_AGGREGATION_JOB_CAP}
          )
          SELECT LOWER(TRIM(s.skill)) AS skill, COUNT(*)::bigint AS count
          FROM recent_jobs rj
          CROSS JOIN LATERAL unnest(rj.skills) AS s(skill)
          WHERE LENGTH(TRIM(s.skill)) > 1
          GROUP BY LOWER(TRIM(s.skill))
          ORDER BY count DESC
          LIMIT 10
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
      },
      { timeout: txTimeout },
    );
  }

  async function safeFetchAggregations(filters: JobDiscoveryFilters): Promise<SeoAggregations> {
    const cached = await readCachedAggregations(filters);
    if (cached) return cached;

    try {
      const data = await withAggregationTimeout(fetchAggregations(filters));
      if (hasAggregationContent(data)) {
        await writeCachedAggregations(filters, data);
      }
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
