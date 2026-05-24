import type { PrismaClient } from "@prisma/client";
import { buildDiscoveryWhereSql, type JobDiscoveryFilters } from "../job/job.repository.js";
import { readCachedAggregations, writeCachedAggregations } from "./seoAggregationCache.js";
import { withAggregationTimeout } from "./seoAggregationTimeout.js";

export interface SeoAggregations {
  topSkills: Array<{ skill: string; count: number }>;
  topCompanies: Array<{ companyId: string; name: string; slug: string | null; count: number }>;
  salary: { avg: number | null; min: number | null; max: number | null };
  hiringTrend: Array<{ day: string; count: number }>;
}

/** Cap jobs scanned per aggregation query — sidebar signal, not analytics-grade totals. */
const AGGREGATION_JOB_SCAN_CAP = 8000;

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
  function isSkillOnlyHub(filters: JobDiscoveryFilters): boolean {
    return (
      (filters.skills?.length ?? 0) === 1 &&
      !filters.role?.trim() &&
      !filters.category?.trim() &&
      !filters.country?.trim() &&
      !filters.location?.trim() &&
      filters.isRemote !== true &&
      filters.workType !== "remote" &&
      !filters.experienceLevel
    );
  }

  async function fetchAggregations(filters: JobDiscoveryFilters): Promise<SeoAggregations> {
    const whereSql = buildDiscoveryWhereSql(filters);
    const skillOnly = isSkillOnlyHub(filters);

    type AggRow = {
      top_skills: Array<{ skill: string; count: number }> | null;
      top_companies: Array<{ companyId: string; name: string; slug: string | null; count: number }> | null;
      salary: { avg: number | null; min: number | null; max: number | null } | null;
      hiring_trend: Array<{ day: string; count: number }> | null;
    };

    const [row] = skillOnly
      ? await prisma.$queryRaw<AggRow[]>`
          WITH sampled AS (
            SELECT
              j."companyId" AS "companyId",
              c.name AS name,
              c.slug AS slug,
              j."salaryMin" AS "salaryMin",
              j."postedAt" AS "postedAt"
            FROM "Job" j
            JOIN "Company" c ON c.id = j."companyId"
            WHERE ${whereSql}
            LIMIT ${AGGREGATION_JOB_SCAN_CAP}
          ),
          top_companies AS (
            SELECT "companyId", name, slug, COUNT(*)::int AS count
            FROM sampled
            GROUP BY "companyId", name, slug
            ORDER BY count DESC
            LIMIT 10
          ),
          salary_stats AS (
            SELECT
              AVG("salaryMin")::float8 AS avg,
              MIN("salaryMin")::int AS min,
              MAX("salaryMin")::int AS max
            FROM sampled
            WHERE "salaryMin" IS NOT NULL AND "salaryMin" > 0
          ),
          hiring_trend AS (
            SELECT TO_CHAR(DATE_TRUNC('day', "postedAt"), 'YYYY-MM-DD') AS day,
                   COUNT(*)::int AS count
            FROM sampled
            WHERE "postedAt" IS NOT NULL
              AND "postedAt" >= NOW() - INTERVAL '14 days'
            GROUP BY DATE_TRUNC('day', "postedAt")
            ORDER BY day DESC
            LIMIT 14
          )
          SELECT
            '[]'::json AS top_skills,
            (SELECT COALESCE(json_agg(tc.*), '[]'::json) FROM top_companies tc) AS top_companies,
            (SELECT row_to_json(s) FROM salary_stats s) AS salary,
            (SELECT COALESCE(json_agg(ht.*), '[]'::json) FROM hiring_trend ht) AS hiring_trend
        `
      : await prisma.$queryRaw<AggRow[]>`
          WITH sampled AS (
            SELECT
              j."companyId" AS "companyId",
              c.name AS name,
              c.slug AS slug,
              j."salaryMin" AS "salaryMin",
              j."postedAt" AS "postedAt",
              j.skills AS skills
            FROM "Job" j
            JOIN "Company" c ON c.id = j."companyId"
            WHERE ${whereSql}
            ORDER BY j."listingFreshnessAt" DESC NULLS LAST
            LIMIT ${AGGREGATION_JOB_SCAN_CAP}
          ),
          top_companies AS (
            SELECT "companyId", name, slug, COUNT(*)::int AS count
            FROM sampled
            GROUP BY "companyId", name, slug
            ORDER BY count DESC
            LIMIT 10
          ),
          salary_stats AS (
            SELECT
              AVG("salaryMin")::float8 AS avg,
              MIN("salaryMin")::int AS min,
              MAX("salaryMin")::int AS max
            FROM sampled
            WHERE "salaryMin" IS NOT NULL AND "salaryMin" > 0
          ),
          hiring_trend AS (
            SELECT TO_CHAR(DATE_TRUNC('day', "postedAt"), 'YYYY-MM-DD') AS day,
                   COUNT(*)::int AS count
            FROM sampled
            WHERE "postedAt" IS NOT NULL
              AND "postedAt" >= NOW() - INTERVAL '14 days'
            GROUP BY DATE_TRUNC('day', "postedAt")
            ORDER BY day DESC
            LIMIT 14
          ),
          top_skills AS (
            SELECT LOWER(TRIM(s.skill)) AS skill, COUNT(*)::int AS count
            FROM sampled
            CROSS JOIN LATERAL unnest(sampled.skills) AS s(skill)
            WHERE LENGTH(TRIM(s.skill)) > 1
            GROUP BY LOWER(TRIM(s.skill))
            ORDER BY count DESC
            LIMIT 10
          )
          SELECT
            (SELECT COALESCE(json_agg(tc.*), '[]'::json) FROM top_skills tc) AS top_skills,
            (SELECT COALESCE(json_agg(tc.*), '[]'::json) FROM top_companies tc) AS top_companies,
            (SELECT row_to_json(s) FROM salary_stats s) AS salary,
            (SELECT COALESCE(json_agg(ht.*), '[]'::json) FROM hiring_trend ht) AS hiring_trend
        `;

    const parsed = row ?? {
      top_skills: [],
      top_companies: [],
      salary: { avg: null, min: null, max: null },
      hiring_trend: [],
    };

    const salary = parsed.salary ?? { avg: null, min: null, max: null };
    return {
      topSkills: (parsed.top_skills ?? []).map((r) => ({
        skill: r.skill,
        count: Number(r.count),
      })),
      topCompanies: (parsed.top_companies ?? []).map((r) => ({
        companyId: r.companyId,
        name: r.name,
        slug: r.slug ?? null,
        count: Number(r.count),
      })),
      salary,
      hiringTrend: (parsed.hiring_trend ?? []).map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
    };
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
