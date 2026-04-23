import { CompanyStatus, type PrismaClient } from "@prisma/client";
import {
  getJobsBlockedNotReadyTotal,
  getStatusTransitionTotals,
} from "./jobStatusMetrics.service.js";

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

export async function buildMetricsSnapshot(prisma: PrismaClient): Promise<MetricsSnapshot> {
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
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { domain: { not: null } } }),
    prisma.company.count({ where: { atsType: { not: null } } }),
    prisma.company.count({ where: { status: CompanyStatus.ready } }),
    prisma.company.count({ where: { status: CompanyStatus.enriching } }),
    prisma.company.count({ where: { status: CompanyStatus.raw } }),
    prisma.company.count({ where: { discoverySource: { contains: "enrich_exhausted" } } }),
    prisma.company.count({ where: { discoverySource: "job_ingestion" } }),
    prisma.job.count(),
    prisma.job.count({ where: { canonicalJobId: null } }),
    prisma.job.count({ where: { canonicalJobId: { not: null } } }),
    prisma.job.count({ where: { status: "ready" } }),
    prisma.job.count({ where: { status: "processing" } }),
    prisma.job.count({ where: { status: "failed" } }),
    prisma.job.groupBy({
      by: ["companyId"],
      _count: { companyId: true },
      orderBy: { _count: { companyId: "desc" } },
      take: 10,
    }),
    prisma.job.groupBy({
      by: ["companyId"],
      _count: { companyId: true },
      orderBy: { _count: { companyId: "asc" } },
      take: 10,
    }),
    prisma.job.groupBy({
      by: ["companyId"],
      _count: { companyId: true },
      orderBy: { _count: { companyId: "asc" } },
    }),
  ]);

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
  };
}
