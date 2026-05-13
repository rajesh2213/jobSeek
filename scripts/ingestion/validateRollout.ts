/**
 * Post-rollout validation: captures current state and compares against baseline.
 *
 * Usage:
 *   npx tsx scripts/ingestion/validateRollout.ts
 *
 * Generates: deploy-snapshots/freshness-expansion-after/baseline.json
 * and POST_ROLLOUT_EXPANSION_REPORT.md
 */

import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const ROOT = join(process.cwd());
const BEFORE_DIR = join(ROOT, "deploy-snapshots/freshness-expansion-before");
const AFTER_DIR = join(ROOT, "deploy-snapshots/freshness-expansion-after");

async function captureMetrics() {
  const endpointCounts = await prisma.$queryRaw<{ isActive: boolean; count: bigint }[]>`
    SELECT "isActive", COUNT(*) as count FROM "AtsEndpoint" GROUP BY "isActive"`;

  const providerDist = await prisma.$queryRaw<{ type: string; isActive: boolean; count: bigint }[]>`
    SELECT type, "isActive", COUNT(*) as count FROM "AtsEndpoint" GROUP BY type, "isActive" ORDER BY type`;

  const scoreDist = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
    SELECT CASE WHEN score >= 80 THEN '80+' WHEN score >= 40 THEN '40-79' WHEN score >= 8 THEN '8-39' ELSE '0-7' END as bucket, COUNT(*) as count FROM "AtsEndpoint" GROUP BY bucket`;

  const freshness = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
    SELECT 
      CASE 
        WHEN "lastCrawledAt" IS NULL THEN 'never'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '1 hour' THEN '<1h'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '6 hours' THEN '1-6h'
        WHEN "lastCrawledAt" > NOW() - INTERVAL '24 hours' THEN '6-24h'
        ELSE '>24h'
      END as bucket, COUNT(*) as count
    FROM "AtsEndpoint" WHERE "isActive" = true GROUP BY bucket`;

  const metrics = await prisma.$queryRaw<{ metric: string; value: bigint }[]>`
    SELECT 'active_endpoints' as metric, COUNT(*) as value FROM "AtsEndpoint" WHERE "isActive" = true
    UNION ALL SELECT 'inactive_endpoints', COUNT(*) FROM "AtsEndpoint" WHERE "isActive" = false
    UNION ALL SELECT 'orphan_active', COUNT(*) FROM "AtsEndpoint" WHERE "companyId" IS NULL AND "isActive" = true
    UNION ALL SELECT 'freshly_monitored_companies', COUNT(DISTINCT "companyId") FROM "AtsEndpoint" WHERE "isActive" = true AND "companyId" IS NOT NULL AND "lastCrawledAt" > NOW() - INTERVAL '6 hours'
    UNION ALL SELECT 'recoverable_inactive', COUNT(*) FROM "AtsEndpoint" WHERE "isActive" = false AND "lastSuccessAt" > NOW() - INTERVAL '30 days'
    UNION ALL SELECT 'jobs_last_24h', COUNT(*) FROM "Job" WHERE "createdAt" > NOW() - INTERVAL '24 hours'`;

  return {
    timestamp: new Date().toISOString(),
    endpointCounts: endpointCounts.map(r => ({ isActive: r.isActive, count: Number(r.count) })),
    providerDistribution: providerDist.map(r => ({ type: r.type, isActive: r.isActive, count: Number(r.count) })),
    scoreDistribution: scoreDist.map(r => ({ bucket: r.bucket, count: Number(r.count) })),
    freshnessHistogram: freshness.map(r => ({ bucket: r.bucket, count: Number(r.count) })),
    metrics: Object.fromEntries(metrics.map(r => [r.metric, Number(r.value)])),
  };
}

function delta(before: number, after: number): string {
  const diff = after - before;
  const pct = before > 0 ? Math.round((diff / before) * 100) : diff > 0 ? 100 : 0;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff} (${sign}${pct}%)`;
}

async function main() {
  mkdirSync(AFTER_DIR, { recursive: true });

  console.log("Capturing post-rollout metrics...");
  const after = await captureMetrics();
  writeFileSync(join(AFTER_DIR, "baseline.json"), JSON.stringify(after, null, 2));

  let before: typeof after | null = null;
  try {
    const raw = readFileSync(join(BEFORE_DIR, "baseline.json"), "utf-8");
    before = JSON.parse(raw);
  } catch {
    console.warn("No BEFORE baseline found — generating report without comparison.");
  }

  const report: string[] = [
    "# Post-Rollout Expansion Report",
    "",
    `Generated: ${after.timestamp}`,
    "",
    "## Current State",
    "",
    "### Endpoint Counts",
    ...after.endpointCounts.map(r => `- isActive=${r.isActive}: ${r.count}`),
    "",
    "### Score Distribution",
    ...after.scoreDistribution.map(r => `- ${r.bucket}: ${r.count}`),
    "",
    "### Freshness Histogram (Active)",
    ...after.freshnessHistogram.map(r => `- ${r.bucket}: ${r.count}`),
    "",
    "### Key Metrics",
    ...Object.entries(after.metrics).map(([k, v]) => `- ${k}: ${v}`),
    "",
  ];

  if (before) {
    const bMetrics = before.metrics as Record<string, number>;
    const aMetrics = after.metrics;

    report.push(
      "## Before vs After Comparison",
      "",
      "| Metric | Before | After | Delta |",
      "|--------|--------|-------|-------|",
      ...Object.keys(aMetrics).map(k =>
        `| ${k} | ${bMetrics[k] ?? "n/a"} | ${aMetrics[k]} | ${bMetrics[k] != null ? delta(bMetrics[k]!, aMetrics[k]!) : "n/a"} |`
      ),
      "",
    );

    const bScores = Object.fromEntries((before.scoreDistribution as { bucket: string; count: number }[]).map(r => [r.bucket, r.count]));
    const aScores = Object.fromEntries(after.scoreDistribution.map(r => [r.bucket, r.count]));
    report.push(
      "### Score Distribution Change",
      "",
      "| Tier | Before | After | Delta |",
      "|------|--------|-------|-------|",
      ...["80+", "40-79", "8-39", "0-7"].map(b =>
        `| ${b} | ${bScores[b] ?? 0} | ${aScores[b] ?? 0} | ${delta(bScores[b] ?? 0, aScores[b] ?? 0)} |`
      ),
      "",
    );
  }

  report.push(
    "## Assessment",
    "",
    "### Safety Indicators",
    `- Active endpoint count: ${after.metrics.active_endpoints} (target: growing)`,
    `- Orphan endpoints: ${after.metrics.orphan_active} (target: decreasing)`,
    `- Recoverable inactive: ${after.metrics.recoverable_inactive} (target: decreasing via recovery)`,
    "",
    "### Next Steps",
    "1. Monitor for 12h after deploy",
    "2. Check queue health via /internal/ingestion/health",
    "3. Verify score distribution is diversifying (should see 40+ scores emerging)",
    "4. Run recovery script for inactive endpoints with recent success",
    "",
  );

  const reportText = report.join("\n");
  writeFileSync(join(ROOT, "POST_ROLLOUT_EXPANSION_REPORT.md"), reportText);
  console.log("Report written to POST_ROLLOUT_EXPANSION_REPORT.md");
  console.log("\n" + reportText);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
