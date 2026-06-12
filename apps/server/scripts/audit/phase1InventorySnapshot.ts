/**
 * Phase 1 production inventory snapshot (read-only).
 * Run: npx tsx scripts/audit/phase1InventorySnapshot.ts
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";

loadRootEnv();

function ser(_: unknown, v: unknown): unknown {
  return typeof v === "bigint" ? Number(v) : v;
}

async function main() {
  const byType = await prisma.$queryRaw<
    { type: string; isActive: boolean; cnt: bigint }[]
  >`
    SELECT type, "isActive", COUNT(*)::bigint AS cnt
    FROM "AtsEndpoint"
    GROUP BY type, "isActive"
    ORDER BY type, "isActive" DESC
  `;

  const totals = await prisma.$queryRaw<
    {
      total_endpoints: bigint;
      active: bigint;
      inactive: bigint;
      crawled_30d: bigint;
      success_30d: bigint;
    }[]
  >`
    SELECT
      COUNT(*)::bigint AS total_endpoints,
      COUNT(*) FILTER (WHERE "isActive")::bigint AS active,
      COUNT(*) FILTER (WHERE NOT "isActive")::bigint AS inactive,
      COUNT(*) FILTER (WHERE "lastCrawledAt" >= NOW() - INTERVAL '30 days')::bigint AS crawled_30d,
      COUNT(*) FILTER (WHERE "lastSuccessAt" >= NOW() - INTERVAL '30 days')::bigint AS success_30d
    FROM "AtsEndpoint"
  `;

  const endpointsWithJobs30d = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(DISTINCT ep_id)::bigint AS cnt
    FROM (
      SELECT e.id AS ep_id
      FROM "AtsEndpoint" e
      JOIN "Job" j ON j."companyId" = e."companyId"
      WHERE j."createdAt" >= NOW() - INTERVAL '30 days'
        AND e."companyId" IS NOT NULL
      UNION
      SELECT l."endpointId" AS ep_id
      FROM "CompanyAtsEndpoint" l
      JOIN "Job" j ON j."companyId" = l."companyId"
      WHERE j."createdAt" >= NOW() - INTERVAL '30 days'
    ) x
  `;

  const coverage = await prisma.$queryRaw<
    Array<Record<string, bigint>>
  >`
    SELECT
      (SELECT COUNT(*)::bigint FROM "Company") AS total_companies,
      (SELECT COUNT(DISTINCT cid)::bigint FROM (
        SELECT "companyId" AS cid FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
        UNION
        SELECT "companyId" AS cid FROM "CompanyAtsEndpoint"
      ) x) AS companies_with_endpoint,
      (SELECT COUNT(DISTINCT cid)::bigint FROM (
        SELECT e."companyId" AS cid FROM "AtsEndpoint" e WHERE e."companyId" IS NOT NULL AND e."isActive" = true
        UNION
        SELECT l."companyId" AS cid FROM "CompanyAtsEndpoint" l
        JOIN "AtsEndpoint" e ON e.id = l."endpointId" WHERE e."isActive" = true
      ) x) AS companies_with_active_endpoint,
      (SELECT COUNT(*)::bigint FROM "AtsEndpoint" WHERE "companyId" IS NULL AND "isActive" = true) AS orphan_active_endpoints
  `;

  const jobStats = await prisma.$queryRaw<
    { total: bigint; active: bigint; created_30d: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE status = 'active')::bigint AS active,
      COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::bigint AS created_30d
    FROM "Job"
  `;

  const atsTypeOnCompanies = await prisma.$queryRaw<
    { atsType: string | null; cnt: bigint }[]
  >`
    SELECT "atsType", COUNT(*)::bigint AS cnt
    FROM "Company"
    WHERE "atsType" IS NOT NULL AND TRIM("atsType") <> ''
    GROUP BY "atsType"
    ORDER BY cnt DESC
  `;

  const existingSlugs = await prisma.$queryRaw<
    { type: string; slug: string; companyName: string | null; isActive: boolean }[]
  >`
    SELECT type, slug, "companyName", "isActive"
    FROM "AtsEndpoint"
    ORDER BY type, slug
  `;

  const existingDomains = await prisma.$queryRaw<
    { domain: string; name: string }[]
  >`
    SELECT domain, name FROM "Company" WHERE domain IS NOT NULL ORDER BY domain
  `;

  const out = {
    generatedAt: new Date().toISOString(),
    endpointsByType: byType,
    totals: totals[0],
    endpointsWithJobs30d: endpointsWithJobs30d[0]?.cnt,
    coverage: coverage[0],
    jobStats: jobStats[0],
    companyAtsTypes: atsTypeOnCompanies,
    existingEndpointCount: existingSlugs.length,
    existingDomainCount: existingDomains.length,
    existingSlugs,
    existingDomains,
  };

  console.log(JSON.stringify(out, ser, 2));
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
