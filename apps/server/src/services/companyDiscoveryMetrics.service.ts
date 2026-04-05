import type { PrismaClient } from "@prisma/client";
import { CompanyStatus } from "@prisma/client";

/**
 * In-process metrics for company discovery / enrichment (scheduler-friendly).
 */

let companiesCreatedFromJobs = 0;
let enrichmentAttempts = 0;
let enrichmentSuccesses = 0;
let enrichmentFailures = 0;
let partialEnrichmentCount = 0;
let atsDetections = 0;
let jobsExpandedFromCompanyEvents = 0;

export function recordCompanyCreatedFromJob(): void {
  companiesCreatedFromJobs += 1;
}

export function recordEnrichmentAttempt(): void {
  enrichmentAttempts += 1;
}

export function recordEnrichmentSuccess(): void {
  enrichmentSuccesses += 1;
}

export function recordEnrichmentFailure(): void {
  enrichmentFailures += 1;
}

export function recordPartialEnrichment(): void {
  partialEnrichmentCount += 1;
}

export function recordAtsDetected(): void {
  atsDetections += 1;
}

export function recordJobsExpandedFromCompany(): void {
  jobsExpandedFromCompanyEvents += 1;
}

export function getCompanyDiscoveryMetrics(): {
  companiesCreatedFromJobs: number;
  enrichmentAttempts: number;
  enrichmentSuccesses: number;
  enrichmentFailures: number;
  enrichmentSuccessRate: number | null;
  partialEnrichmentCount: number;
  atsDetections: number;
  jobsExpandedFromCompanyEvents: number;
  totalCompanies?: number;
  jobsPerCompany?: number | null;
} {
  const denom = enrichmentSuccesses + enrichmentFailures;
  return {
    companiesCreatedFromJobs,
    enrichmentAttempts,
    enrichmentSuccesses,
    enrichmentFailures,
    enrichmentSuccessRate: denom > 0 ? enrichmentSuccesses / denom : null,
    partialEnrichmentCount,
    atsDetections,
    jobsExpandedFromCompanyEvents,
  };
}

export async function getCompanyDiscoveryMetricsWithDb(
  prisma: Pick<PrismaClient, "company" | "job">,
): Promise<ReturnType<typeof getCompanyDiscoveryMetrics> & {
  totalCompanies: number;
  readyCompanies: number;
  jobsPerCompany: number | null;
}> {
  const base = getCompanyDiscoveryMetrics();
  const [totalCompanies, readyCompanies, totalJobs] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({
      where: { status: CompanyStatus.ready },
    }),
    prisma.job.count(),
  ]);
  return {
    ...base,
    totalCompanies,
    readyCompanies,
    jobsPerCompany:
      totalCompanies > 0 ? totalJobs / totalCompanies : null,
  };
}
