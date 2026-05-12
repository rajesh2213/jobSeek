import { CompanyStatus, type PrismaClient } from "@prisma/client";
import {
  getJobsBlockedNotReadyTotal,
  getStatusTransitionTotals,
} from "./jobStatusMetrics.service.js";
import { getOpenClawMetricsForInternalSnapshot } from "../modules/providers/provider.registry.js";

export interface CompanyDensityRow {
  companyId: string;
  companyName: string;
  jobCount: number;
}

export interface MetricsSnapshot {
  companies: {
    totalCompanies: number;
    companiesWithDomain: number;
    companiesWithATS: number;
    companiesReady: number;
    companiesEnriching: number;
    companiesRaw: number;
    companiesExhausted: number;
    companiesCreatedFromJobs: number;
    companiesCreatedFromDataset: number;
  };
  jobs: {
    totalJobs: number;
    totalCanonicalJobs: number;
    totalDuplicateJobs: number;
    ready_jobs_count: number;
    processing_jobs_count: number;
    failed_jobs_count: number;
    status_transition_total: Record<string, number>;
    jobs_blocked_not_ready_total: number;
    public_visibility_guard: {
      bad_workday_url: number;
      empty_description: number;
      empty_parsed: number;
      by_source: Array<{
        source: string;
        bad_workday_url: number;
        empty_description: number;
        empty_parsed: number;
      }>;
      top_companies_bad_workday_url: Array<{
        companyId: string;
        companyName: string;
        bad_workday_url: number;
      }>;
    };
    quality_flags_shadow: {
      compared_rows: number;
      publishable_runtime_true: number;
      publishable_flag_true: number;
      mismatches_total: number;
      false_positive_flag: number;
      false_negative_flag: number;
      by_source: Array<{
        source: string;
        compared_rows: number;
        mismatches_total: number;
        false_positive_flag: number;
        false_negative_flag: number;
      }>;
    };
  };
  density: {
    avgJobsPerCompany: number;
    medianJobsPerCompany: number;
  };
  effectiveness: {
    pctCompaniesWithDomain: number;
    pctCompaniesWithATS: number;
    pctCompaniesReady: number;
  };
  topCompaniesByJobs: CompanyDensityRow[];
  bottomCompaniesByJobs: CompanyDensityRow[];
  generatedAt: string;
  /**
   * Present when `OPENCLAW_ENABLED=true` (may still be health-disabled at runtime).
   * `metricsToday` is Redis hash `openclaw:metrics:YYYY-MM-DD` (counters as strings). See runbook.
   */
  openclaw?: {
    capabilities: { id: string; label: string; defaultRateLimitRequestsPerDay: number };
    runtime: {
      health: string;
      lastSuccessAt: string | null;
      quotaRemainingEstimate: number | null;
      quotaUsedToday: number | null;
      circuitOpenUntil: number | null;
      disabledReason: string | null;
    } | null;
    metricsToday: Record<string, string>;
  };
}

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(2));
}

function toDensityRows(
  rows: Array<{ companyId: string; _count: { companyId: number } }>,
  namesById: Map<string, string>,
): CompanyDensityRow[] {
  return rows.map((row) => ({
    companyId: row.companyId,
    companyName: namesById.get(row.companyId) ?? row.companyId,
    jobCount: row._count.companyId,
  }));
}

function medianAcrossAllCompanies(sortedNonZeroCounts: number[], totalCompanies: number): number {
  if (!totalCompanies) return 0;
  const nonZero = sortedNonZeroCounts.length;
  const zeroCount = Math.max(0, totalCompanies - nonZero);

  const valueAt = (idx: number): number => {
    if (idx < zeroCount) return 0;
    return sortedNonZeroCounts[idx - zeroCount] ?? 0;
  };

  const mid = Math.floor(totalCompanies / 2);
  if (totalCompanies % 2 === 1) return valueAt(mid);
  return (valueAt(mid - 1) + valueAt(mid)) / 2;
}

async function runMetricThunksSequential<T>(thunks: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = [];
  for (const t of thunks) {
    out.push(await t());
  }
  return out;
}

export async function buildMetricsSnapshot(prisma: PrismaClient): Promise<MetricsSnapshot> {
  const useSequentialMetrics = process.env.METRICS_SNAPSHOT_SEQUENTIAL?.trim() === "true";
  const taskFactories: Array<() => Promise<unknown>> = [
    () => prisma.company.count(),
    () => prisma.company.count({ where: { domain: { not: null } } }),
    () => prisma.company.count({ where: { atsType: { not: null } } }),
    () => prisma.company.count({ where: { status: CompanyStatus.ready } }),
    () => prisma.company.count({ where: { status: CompanyStatus.enriching } }),
    () => prisma.company.count({ where: { status: CompanyStatus.raw } }),
    () => prisma.company.count({ where: { discoverySource: { contains: "enrich_exhausted" } } }),
    () => prisma.company.count({ where: { discoverySource: "job_ingestion" } }),
    () => prisma.job.count(),
    () => prisma.job.count({ where: { canonicalJobId: null } }),
    () => prisma.job.count({ where: { canonicalJobId: { not: null } } }),
    () => prisma.job.count({ where: { status: "ready" } }),
    () => prisma.job.count({ where: { status: "processing" } }),
    () => prisma.job.count({ where: { status: "failed" } }),
    () =>
      prisma.job.groupBy({
        by: ["companyId"],
        _count: { companyId: true },
        orderBy: { _count: { companyId: "desc" } },
        take: 10,
      }),
    () =>
      prisma.job.groupBy({
        by: ["companyId"],
        _count: { companyId: true },
        orderBy: { _count: { companyId: "asc" } },
        take: 10,
      }),
    () =>
      prisma.job.groupBy({
        by: ["companyId"],
        _count: { companyId: true },
        orderBy: { _count: { companyId: "asc" } },
      }),
    () =>
      prisma.$queryRaw<
        Array<{
          source: string;
          bad_workday_url: bigint;
          empty_description: bigint;
          empty_parsed: bigint;
        }>
      >`
      SELECT
        j.source,
        COUNT(*) FILTER (
          WHERE j.source = 'workday'
            AND LOWER(j."sourceUrl") LIKE '%myworkdayjobs.com/job/%'
        )::bigint AS bad_workday_url,
        COUNT(*) FILTER (
          WHERE j.description IS NULL OR BTRIM(j.description) = ''
        )::bigint AS empty_description,
        COUNT(*) FILTER (
          WHERE j."parsedDescription" IS NOT NULL
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'position'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'responsibility'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'requirement'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'experience'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'benefit'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'contact'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'other'), 0) = 0
        )::bigint AS empty_parsed
      FROM "Job" j
      GROUP BY j.source
      ORDER BY j.source ASC
    `,
    () =>
      prisma.$queryRaw<
        Array<{ companyId: string; companyName: string; bad_workday_url: bigint }>
      >`
      SELECT
        c.id AS "companyId",
        c.name AS "companyName",
        COUNT(*)::bigint AS bad_workday_url
      FROM "Job" j
      JOIN "Company" c ON c.id = j."companyId"
      WHERE j.source = 'workday'
        AND LOWER(j."sourceUrl") LIKE '%myworkdayjobs.com/job/%'
      GROUP BY c.id, c.name
      ORDER BY bad_workday_url DESC
      LIMIT 10
    `,
    () =>
      prisma.$queryRaw<
        Array<{ bad_workday_url: bigint; empty_description: bigint; empty_parsed: bigint }>
      >`
      SELECT
        COUNT(*) FILTER (
          WHERE j.source = 'workday'
            AND LOWER(j."sourceUrl") LIKE '%myworkdayjobs.com/job/%'
        )::bigint AS bad_workday_url,
        COUNT(*) FILTER (
          WHERE j.description IS NULL OR BTRIM(j.description) = ''
        )::bigint AS empty_description,
        COUNT(*) FILTER (
          WHERE j."parsedDescription" IS NOT NULL
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'position'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'responsibility'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'requirement'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'experience'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'benefit'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'contact'), 0) = 0
            AND COALESCE(jsonb_array_length(j."parsedDescription"->'other'), 0) = 0
        )::bigint AS empty_parsed
      FROM "Job" j
    `,
    () =>
      prisma.$queryRaw<
        Array<{
          compared_rows: bigint;
          publishable_runtime_true: bigint;
          publishable_flag_true: bigint;
          mismatches_total: bigint;
          false_positive_flag: bigint;
          false_negative_flag: bigint;
        }>
      >`
      WITH eval AS (
        SELECT
          j.source,
          j."isPublishable" AS flag_publishable,
          (
            j.description IS NOT NULL
            AND BTRIM(j.description) <> ''
            AND NOT (
              j.source = 'workday'
              AND LOWER(j."sourceUrl") LIKE '%myworkdayjobs.com/job/%'
            )
            AND (
              j."parsedDescription" IS NULL
              OR NOT (
                COALESCE(jsonb_array_length(j."parsedDescription"->'position'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'responsibility'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'requirement'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'experience'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'benefit'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'contact'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'other'), 0) = 0
              )
            )
          ) AS runtime_publishable
        FROM "Job" j
        WHERE j."isPublishable" IS NOT NULL
      )
      SELECT
        COUNT(*)::bigint AS compared_rows,
        COUNT(*) FILTER (WHERE runtime_publishable)::bigint AS publishable_runtime_true,
        COUNT(*) FILTER (WHERE flag_publishable = true)::bigint AS publishable_flag_true,
        COUNT(*) FILTER (WHERE flag_publishable IS DISTINCT FROM runtime_publishable)::bigint AS mismatches_total,
        COUNT(*) FILTER (WHERE flag_publishable = true AND runtime_publishable = false)::bigint AS false_positive_flag,
        COUNT(*) FILTER (WHERE flag_publishable = false AND runtime_publishable = true)::bigint AS false_negative_flag
      FROM eval
    `,
    () =>
      prisma.$queryRaw<
        Array<{
          source: string;
          compared_rows: bigint;
          mismatches_total: bigint;
          false_positive_flag: bigint;
          false_negative_flag: bigint;
        }>
      >`
      WITH eval AS (
        SELECT
          j.source,
          j."isPublishable" AS flag_publishable,
          (
            j.description IS NOT NULL
            AND BTRIM(j.description) <> ''
            AND NOT (
              j.source = 'workday'
              AND LOWER(j."sourceUrl") LIKE '%myworkdayjobs.com/job/%'
            )
            AND (
              j."parsedDescription" IS NULL
              OR NOT (
                COALESCE(jsonb_array_length(j."parsedDescription"->'position'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'responsibility'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'requirement'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'experience'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'benefit'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'contact'), 0) = 0
                AND COALESCE(jsonb_array_length(j."parsedDescription"->'other'), 0) = 0
              )
            )
          ) AS runtime_publishable
        FROM "Job" j
        WHERE j."isPublishable" IS NOT NULL
      )
      SELECT
        source,
        COUNT(*)::bigint AS compared_rows,
        COUNT(*) FILTER (WHERE flag_publishable IS DISTINCT FROM runtime_publishable)::bigint AS mismatches_total,
        COUNT(*) FILTER (WHERE flag_publishable = true AND runtime_publishable = false)::bigint AS false_positive_flag,
        COUNT(*) FILTER (WHERE flag_publishable = false AND runtime_publishable = true)::bigint AS false_negative_flag
      FROM eval
      GROUP BY source
      ORDER BY mismatches_total DESC, compared_rows DESC
    `,
  ];

  const allResults = useSequentialMetrics
    ? await runMetricThunksSequential(taskFactories)
    : await Promise.all(taskFactories.map((f) => f()));

  const [
    totalCompanies,
    companiesWithDomain,
    companiesWithATS,
    companiesReady,
    companiesEnriching,
    companiesRaw,
    companiesExhausted,
    companiesCreatedFromJobs,
    totalJobs,
    totalCanonicalJobs,
    totalDuplicateJobs,
    readyJobsCount,
    processingJobsCount,
    failedJobsCount,
    topCountRows,
    bottomCountRows,
    allCompanyJobCountRows,
    guardBySourceRows,
    guardTopBadWorkdayCompaniesRows,
    guardTotalsRows,
    qualityShadowTotalsRows,
    qualityShadowBySourceRows,
  ] = allResults as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    Array<{ companyId: string; _count: { companyId: number } }>,
    Array<{ companyId: string; _count: { companyId: number } }>,
    Array<{ companyId: string; _count: { companyId: number } }>,
    Array<{
      source: string;
      bad_workday_url: bigint;
      empty_description: bigint;
      empty_parsed: bigint;
    }>,
    Array<{ companyId: string; companyName: string; bad_workday_url: bigint }>,
    Array<{ bad_workday_url: bigint; empty_description: bigint; empty_parsed: bigint }>,
    Array<{
      compared_rows: bigint;
      publishable_runtime_true: bigint;
      publishable_flag_true: bigint;
      mismatches_total: bigint;
      false_positive_flag: bigint;
      false_negative_flag: bigint;
    }>,
    Array<{
      source: string;
      compared_rows: bigint;
      mismatches_total: bigint;
      false_positive_flag: bigint;
      false_negative_flag: bigint;
    }>,
  ];

  const guardTotals = guardTotalsRows[0] ?? {
    bad_workday_url: BigInt(0),
    empty_description: BigInt(0),
    empty_parsed: BigInt(0),
  };
  const qualityShadowTotals = qualityShadowTotalsRows[0] ?? {
    compared_rows: BigInt(0),
    publishable_runtime_true: BigInt(0),
    publishable_flag_true: BigInt(0),
    mismatches_total: BigInt(0),
    false_positive_flag: BigInt(0),
    false_negative_flag: BigInt(0),
  };

  const companiesCreatedFromDataset = totalCompanies - companiesCreatedFromJobs;
  const avgJobsPerCompany = totalCompanies ? Number((totalJobs / totalCompanies).toFixed(2)) : 0;
  const sortedCounts = allCompanyJobCountRows.map((r) => r._count.companyId);
  const medianJobsPerCompany = Number(
    medianAcrossAllCompanies(sortedCounts, totalCompanies).toFixed(2),
  );

  const ids = Array.from(
    new Set([...topCountRows.map((r) => r.companyId), ...bottomCountRows.map((r) => r.companyId)]),
  );
  const companies = ids.length
    ? await prisma.company.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const namesById = new Map(companies.map((c) => [c.id, c.name]));

  const openclaw = await getOpenClawMetricsForInternalSnapshot();

  return {
    companies: {
      totalCompanies,
      companiesWithDomain,
      companiesWithATS,
      companiesReady,
      companiesEnriching,
      companiesRaw,
      companiesExhausted,
      companiesCreatedFromJobs,
      companiesCreatedFromDataset,
    },
    jobs: {
      totalJobs,
      totalCanonicalJobs,
      totalDuplicateJobs,
      ready_jobs_count: readyJobsCount,
      processing_jobs_count: processingJobsCount,
      failed_jobs_count: failedJobsCount,
      status_transition_total: getStatusTransitionTotals(),
      jobs_blocked_not_ready_total: getJobsBlockedNotReadyTotal(),
      public_visibility_guard: {
        bad_workday_url: Number(guardTotals.bad_workday_url),
        empty_description: Number(guardTotals.empty_description),
        empty_parsed: Number(guardTotals.empty_parsed),
        by_source: guardBySourceRows.map((r) => ({
          source: r.source,
          bad_workday_url: Number(r.bad_workday_url),
          empty_description: Number(r.empty_description),
          empty_parsed: Number(r.empty_parsed),
        })),
        top_companies_bad_workday_url: guardTopBadWorkdayCompaniesRows.map((r) => ({
          companyId: r.companyId,
          companyName: r.companyName,
          bad_workday_url: Number(r.bad_workday_url),
        })),
      },
      quality_flags_shadow: {
        compared_rows: Number(qualityShadowTotals.compared_rows),
        publishable_runtime_true: Number(qualityShadowTotals.publishable_runtime_true),
        publishable_flag_true: Number(qualityShadowTotals.publishable_flag_true),
        mismatches_total: Number(qualityShadowTotals.mismatches_total),
        false_positive_flag: Number(qualityShadowTotals.false_positive_flag),
        false_negative_flag: Number(qualityShadowTotals.false_negative_flag),
        by_source: qualityShadowBySourceRows.map((r) => ({
          source: r.source,
          compared_rows: Number(r.compared_rows),
          mismatches_total: Number(r.mismatches_total),
          false_positive_flag: Number(r.false_positive_flag),
          false_negative_flag: Number(r.false_negative_flag),
        })),
      },
    },
    density: {
      avgJobsPerCompany,
      medianJobsPerCompany,
    },
    effectiveness: {
      pctCompaniesWithDomain: pct(companiesWithDomain, totalCompanies),
      pctCompaniesWithATS: pct(companiesWithATS, totalCompanies),
      pctCompaniesReady: pct(companiesReady, totalCompanies),
    },
    topCompaniesByJobs: toDensityRows(topCountRows, namesById),
    bottomCompaniesByJobs: toDensityRows(bottomCountRows, namesById),
    generatedAt: new Date().toISOString(),
    ...(openclaw
      ? {
          openclaw: {
            capabilities: {
              id: openclaw.capabilities.id,
              label: openclaw.capabilities.label,
              defaultRateLimitRequestsPerDay: openclaw.capabilities.defaultRateLimitRequestsPerDay,
            },
            runtime: openclaw.runtime
              ? {
                  health: openclaw.runtime.health,
                  lastSuccessAt: openclaw.runtime.lastSuccessAt,
                  quotaRemainingEstimate: openclaw.runtime.quotaRemainingEstimate,
                  quotaUsedToday: openclaw.runtime.quotaUsedToday,
                  circuitOpenUntil: openclaw.runtime.circuitOpenUntil,
                  disabledReason: openclaw.runtime.disabledReason,
                }
              : null,
            metricsToday: openclaw.metricsToday,
          },
        }
      : {}),
  };
}
