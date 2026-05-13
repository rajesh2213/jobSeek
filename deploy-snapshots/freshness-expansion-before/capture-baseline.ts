import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { join } from "path";

const SNAPSHOT_DIR = join(process.cwd(), "deploy-snapshots/freshness-expansion-before");

const prisma = new PrismaClient();

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`Capturing baseline at ${timestamp}`);

  const results: Record<string, unknown> = { timestamp };

  // 1. Endpoint active/inactive counts
  const endpointCounts = await prisma.$queryRaw<{ isActive: boolean; count: bigint }[]>`
    SELECT "isActive", COUNT(*) as count FROM "AtsEndpoint" GROUP BY "isActive"`;
  results.endpointCounts = endpointCounts.map(r => ({ isActive: r.isActive, count: Number(r.count) }));

  // 2. Provider distribution
  const providerDist = await prisma.$queryRaw<{ type: string; isActive: boolean; count: bigint }[]>`
    SELECT type, "isActive", COUNT(*) as count FROM "AtsEndpoint" GROUP BY type, "isActive" ORDER BY type`;
  results.providerDistribution = providerDist.map(r => ({ type: r.type, isActive: r.isActive, count: Number(r.count) }));

  // 3. Score distribution
  const scoreDist = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
    SELECT CASE WHEN score >= 80 THEN '80+' WHEN score >= 40 THEN '40-79' WHEN score >= 8 THEN '8-39' ELSE '0-7' END as bucket, COUNT(*) as count FROM "AtsEndpoint" GROUP BY bucket`;
  results.scoreDistribution = scoreDist.map(r => ({ bucket: r.bucket, count: Number(r.count) }));

  // 4. Failure count distribution
  const failDist = await prisma.$queryRaw<{ failureCount: number; count: bigint }[]>`
    SELECT "failureCount", COUNT(*) as count FROM "AtsEndpoint" GROUP BY "failureCount" ORDER BY "failureCount"`;
  results.failureDistribution = failDist.map(r => ({ failureCount: r.failureCount, count: Number(r.count) }));

  // 5. Freshness histogram
  const freshness = await prisma.$queryRaw<{ bucket: string; type: string; count: bigint }[]>`
    SELECT 
      CASE 
        WHEN "lastCrawledAt" IS NULL THEN 'never'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '30 minutes' THEN '<30m'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '1 hour' THEN '30m-1h'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '2 hours' THEN '1-2h'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '4 hours' THEN '2-4h'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '8 hours' THEN '4-8h'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '24 hours' THEN '8-24h'
        ELSE '>24h'
      END as bucket, type, COUNT(*) as count
    FROM "AtsEndpoint" WHERE "isActive" = true
    GROUP BY bucket, type ORDER BY bucket, type`;
  results.freshnessHistogram = freshness.map(r => ({ bucket: r.bucket, type: r.type, count: Number(r.count) }));

  // 6. Company coverage buckets
  const coverage = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
    SELECT 
      CASE
        WHEN EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id AND e."isActive" = true AND e."lastCrawledAt" > NOW() - INTERVAL '6 hours') THEN 'active_fresh'
        WHEN EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id AND e."isActive" = true) THEN 'active_stale'
        WHEN EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id AND e."isActive" = false) THEN 'endpoint_inactive'
        WHEN c."atsType" IS NOT NULL THEN 'ats_known_no_endpoint'
        WHEN c."careersUrl" IS NOT NULL THEN 'careers_unresolved'
        ELSE 'no_source'
      END as bucket,
      COUNT(*) as count
    FROM "Company" c GROUP BY bucket ORDER BY count DESC`;
  results.companyCoverage = coverage.map(r => ({ bucket: r.bucket, count: Number(r.count) }));

  // 7. Key metrics
  const metrics = await prisma.$queryRaw<{ metric: string; value: bigint }[]>`
    SELECT 'total_endpoints' as metric, COUNT(*) as value FROM "AtsEndpoint"
    UNION ALL SELECT 'active_endpoints', COUNT(*) FROM "AtsEndpoint" WHERE "isActive" = true
    UNION ALL SELECT 'inactive_endpoints', COUNT(*) FROM "AtsEndpoint" WHERE "isActive" = false
    UNION ALL SELECT 'orphan_active', COUNT(*) FROM "AtsEndpoint" WHERE "companyId" IS NULL AND "isActive" = true
    UNION ALL SELECT 'recently_succeeded_inactive', COUNT(*) FROM "AtsEndpoint" WHERE "isActive" = false AND "lastSuccessAt" > NOW() - INTERVAL '30 days'
    UNION ALL SELECT 'companies_with_atstype_no_endpoint', COUNT(*) FROM "Company" WHERE "atsType" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = "Company".id)
    UNION ALL SELECT 'total_jobs', COUNT(*) FROM "Job"
    UNION ALL SELECT 'jobs_last_7d', COUNT(*) FROM "Job" WHERE "createdAt" > NOW() - INTERVAL '7 days'
    UNION ALL SELECT 'freshly_monitored_companies', COUNT(DISTINCT "companyId") FROM "AtsEndpoint" WHERE "isActive" = true AND "companyId" IS NOT NULL AND "lastCrawledAt" > NOW() - INTERVAL '6 hours'`;
  results.metrics = Object.fromEntries(metrics.map(r => [r.metric, Number(r.value)]));

  // 8. Throughput last 24h
  const throughput = await prisma.$queryRaw<{ hour: Date; type: string; count: bigint }[]>`
    SELECT DATE_TRUNC('hour', "lastCrawledAt") as hour, type, COUNT(*) as count
    FROM "AtsEndpoint" WHERE "lastCrawledAt" > NOW() - INTERVAL '24 hours'
    GROUP BY hour, type ORDER BY hour DESC`;
  results.throughput24h = throughput.map(r => ({ hour: r.hour.toISOString(), type: r.type, count: Number(r.count) }));

  // 9. Env config
  results.envConfig = {
    ATS_ENDPOINT_WORKER_CONCURRENCY: process.env.ATS_ENDPOINT_WORKER_CONCURRENCY ?? "1",
    ATS_POOL_INGEST_CONCURRENCY: process.env.ATS_POOL_INGEST_CONCURRENCY ?? "3",
    ATS_PARSE_CONCURRENCY: process.env.ATS_PARSE_CONCURRENCY ?? "3",
    ATS_ENDPOINT_FETCH_TIMEOUT_MS: process.env.ATS_ENDPOINT_FETCH_TIMEOUT_MS ?? "600000",
    ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE: process.env.ATS_ENDPOINT_SCHEDULER_MAX_PER_TYPE ?? "unset",
    WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY ?? "4",
  };

  // Write output
  const output = JSON.stringify(results, null, 2);
  writeFileSync(join(SNAPSHOT_DIR, "baseline.json"), output);
  console.log("Baseline saved to baseline.json");

  // Write human-readable summary
  const summary = [
    `=== FRESHNESS EXPANSION BASELINE ===`,
    `Captured: ${timestamp}`,
    ``,
    `--- Key Metrics ---`,
    ...Object.entries(results.metrics as Record<string, number>).map(([k, v]) => `  ${k}: ${v}`),
    ``,
    `--- Endpoint Counts ---`,
    ...(results.endpointCounts as { isActive: boolean; count: number }[]).map(r => `  isActive=${r.isActive}: ${r.count}`),
    ``,
    `--- Provider Distribution ---`,
    ...(results.providerDistribution as { type: string; isActive: boolean; count: number }[]).map(r => `  ${r.type} active=${r.isActive}: ${r.count}`),
    ``,
    `--- Score Distribution ---`,
    ...(results.scoreDistribution as { bucket: string; count: number }[]).map(r => `  ${r.bucket}: ${r.count}`),
    ``,
    `--- Freshness Histogram (Active Endpoints) ---`,
    ...(results.freshnessHistogram as { bucket: string; type: string; count: number }[]).map(r => `  ${r.bucket} | ${r.type}: ${r.count}`),
    ``,
    `--- Company Coverage ---`,
    ...(results.companyCoverage as { bucket: string; count: number }[]).map(r => `  ${r.bucket}: ${r.count}`),
    ``,
    `--- Env Config ---`,
    ...Object.entries(results.envConfig as Record<string, string>).map(([k, v]) => `  ${k}=${v}`),
    ``,
  ].join("\n");

  writeFileSync(join(SNAPSHOT_DIR, "baseline-summary.txt"), summary);
  console.log("Summary saved to baseline-summary.txt");
  console.log("\n" + summary);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
