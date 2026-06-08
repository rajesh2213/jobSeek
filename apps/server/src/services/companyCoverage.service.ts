import type { PrismaClient } from "@prisma/client";
import { CompanyStatus } from "@prisma/client";

export type CompanyCoverageStats = {
  totalCompanies: number;
  companiesWithEndpoints: number;
  crawlableCompanies: number;
  companiesChecked7d: number;
  companiesChecked30d: number;
  activeHiringCompanies: number;
  endpointCoveragePct: number;
  crawlableCoveragePct: number;
  checked7dPct: number;
  activeHiringPct: number;
};

export type DiscoveryFunnelStage = {
  stage: string;
  count: number;
  conversionFromPreviousPct: number | null;
};

export type DiscoveryFunnelStats = {
  stages: DiscoveryFunnelStage[];
};

export type AtsRediscoveryBacklog = {
  candidateCount: number;
  sample: Array<{ companyId: string; name: string; domain: string | null }>;
};

export type AtsEndpointCoverageMetrics = {
  activeEndpoints: number;
  endpointsCrawled24h: number;
  endpointsCrawled7d: number;
  endpointsCrawled30d: number;
  endpointsNeverCrawled: number;
  successRatePct: number | null;
  failureRatePct: number | null;
  avgSuccessCount: number;
  avgFailureCount: number;
};

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(2));
}

export async function buildCompanyCoverageStats(
  prisma: PrismaClient,
): Promise<CompanyCoverageStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalCompanies,
    companiesWithEndpointsRows,
    crawlableCompanies,
    companiesChecked7d,
    companiesChecked30d,
    activeHiringRows,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(DISTINCT cid)::bigint AS c FROM (
        SELECT "companyId" AS cid FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
        UNION
        SELECT "companyId" AS cid FROM "CompanyAtsEndpoint"
      ) x
    `,
    prisma.company.count({
      where: { status: CompanyStatus.ready, atsBoardToken: { not: null } },
    }),
    prisma.company.count({ where: { lastAttemptAt: { gte: weekAgo } } }),
    prisma.company.count({ where: { lastAttemptAt: { gte: monthAgo } } }),
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(DISTINCT "companyId")::bigint AS c
      FROM "Job"
      WHERE "canonicalJobId" IS NULL
        AND "status" = 'ready'
        AND "isActive" = true
        AND description IS NOT NULL
        AND description <> ''
    `,
  ]);

  const companiesWithEndpoints = Number(companiesWithEndpointsRows[0]?.c ?? 0);
  const activeHiringCompanies = Number(activeHiringRows[0]?.c ?? 0);

  return {
    totalCompanies,
    companiesWithEndpoints,
    crawlableCompanies,
    companiesChecked7d,
    companiesChecked30d,
    activeHiringCompanies,
    endpointCoveragePct: pct(companiesWithEndpoints, totalCompanies),
    crawlableCoveragePct: pct(crawlableCompanies, totalCompanies),
    checked7dPct: pct(companiesChecked7d, totalCompanies),
    activeHiringPct: pct(activeHiringCompanies, totalCompanies),
  };
}

export async function buildDiscoveryFunnelStats(
  prisma: PrismaClient,
): Promise<DiscoveryFunnelStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      discovered: bigint;
      enriched: bigint;
      ats_detected: bigint;
      endpoint_created: bigint;
      jobs_ingested: bigint;
      jobs_active: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::bigint FROM "Company") AS discovered,
      (SELECT COUNT(*)::bigint FROM "Company" WHERE status = 'ready') AS enriched,
      (SELECT COUNT(*)::bigint FROM "Company" WHERE "atsType" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = "Company".id
      )) AS ats_detected,
      (SELECT COUNT(DISTINCT cid)::bigint FROM (
        SELECT "companyId" AS cid FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
        UNION
        SELECT "companyId" AS cid FROM "CompanyAtsEndpoint"
      ) x) AS endpoint_created,
      (SELECT COUNT(DISTINCT "companyId")::bigint FROM "Job") AS jobs_ingested,
      (SELECT COUNT(DISTINCT "companyId")::bigint FROM "Job"
        WHERE "canonicalJobId" IS NULL
          AND "status" = 'ready'
          AND "isActive" = true
          AND description IS NOT NULL
          AND description <> ''
      ) AS jobs_active
  `;

  const r = rows[0] ?? {
    discovered: BigInt(0),
    enriched: BigInt(0),
    ats_detected: BigInt(0),
    endpoint_created: BigInt(0),
    jobs_ingested: BigInt(0),
    jobs_active: BigInt(0),
  };

  const counts = [
    Number(r.discovered),
    Number(r.enriched),
    Number(r.ats_detected),
    Number(r.endpoint_created),
    Number(r.jobs_ingested),
    Number(r.jobs_active),
  ];

  const labels = [
    "company_discovered",
    "company_enriched",
    "ats_detected",
    "endpoint_created",
    "jobs_ingested",
    "jobs_active",
  ];

  const stages: DiscoveryFunnelStage[] = labels.map((stage, i) => {
    const count = counts[i] ?? 0;
    const prev = i > 0 ? (counts[i - 1] ?? 0) : null;
    return {
      stage,
      count,
      conversionFromPreviousPct:
        prev != null && prev > 0 ? pct(count, prev) : i === 0 ? 100 : null,
    };
  });

  return { stages };
}

/** Companies with domain/careers URL but no ATS endpoint — rediscovery candidates only. */
export async function buildAtsRediscoveryBacklog(
  prisma: PrismaClient,
  sampleLimit = 25,
): Promise<AtsRediscoveryBacklog> {
  const [countRows, sampleRows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*)::bigint AS c
      FROM "Company" c
      WHERE (c.domain IS NOT NULL OR c."careersUrl" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
    `,
    prisma.$queryRaw<Array<{ companyId: string; name: string; domain: string | null }>>`
      SELECT c.id AS "companyId", c.name, c.domain
      FROM "Company" c
      WHERE (c.domain IS NOT NULL OR c."careersUrl" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
      ORDER BY c."updatedAt" ASC
      LIMIT ${sampleLimit}
    `,
  ]);

  return {
    candidateCount: Number(countRows[0]?.c ?? 0),
    sample: sampleRows,
  };
}

export async function buildAtsEndpointCoverageMetrics(
  prisma: PrismaClient,
): Promise<AtsEndpointCoverageMetrics> {
  const rows = await prisma.$queryRaw<
    Array<{
      active_endpoints: bigint;
      crawled_24h: bigint;
      crawled_7d: bigint;
      crawled_30d: bigint;
      never_crawled: bigint;
      total_success: bigint;
      total_failure: bigint;
      rows_with_outcome: bigint;
      avg_success: number | null;
      avg_failure: number | null;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "isActive")::bigint AS active_endpoints,
      COUNT(*) FILTER (WHERE "isActive" AND "lastCrawledAt" >= NOW() - INTERVAL '24 hours')::bigint AS crawled_24h,
      COUNT(*) FILTER (WHERE "isActive" AND "lastCrawledAt" >= NOW() - INTERVAL '7 days')::bigint AS crawled_7d,
      COUNT(*) FILTER (WHERE "isActive" AND "lastCrawledAt" >= NOW() - INTERVAL '30 days')::bigint AS crawled_30d,
      COUNT(*) FILTER (WHERE "isActive" AND "lastCrawledAt" IS NULL)::bigint AS never_crawled,
      SUM("successCount")::bigint AS total_success,
      SUM("failureCount")::bigint AS total_failure,
      COUNT(*) FILTER (WHERE "successCount" > 0 OR "failureCount" > 0)::bigint AS rows_with_outcome,
      AVG("successCount")::float AS avg_success,
      AVG("failureCount")::float AS avg_failure
    FROM "AtsEndpoint"
  `;

  const r = rows[0];
  const totalSuccess = Number(r?.total_success ?? 0);
  const totalFailure = Number(r?.total_failure ?? 0);
  const denom = totalSuccess + totalFailure;

  return {
    activeEndpoints: Number(r?.active_endpoints ?? 0),
    endpointsCrawled24h: Number(r?.crawled_24h ?? 0),
    endpointsCrawled7d: Number(r?.crawled_7d ?? 0),
    endpointsCrawled30d: Number(r?.crawled_30d ?? 0),
    endpointsNeverCrawled: Number(r?.never_crawled ?? 0),
    successRatePct: denom > 0 ? pct(totalSuccess, denom) : null,
    failureRatePct: denom > 0 ? pct(totalFailure, denom) : null,
    avgSuccessCount: Number((r?.avg_success ?? 0).toFixed(2)),
    avgFailureCount: Number((r?.avg_failure ?? 0).toFixed(2)),
  };
}
