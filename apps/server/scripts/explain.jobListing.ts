/**
 * Prints Postgres EXPLAIN for the discovery "latest" id-shaped query (listing sort keys).
 *
 * Usage:
 *   DATABASE_URL=… npm run explain:job-listing -w @jobseek/server
 *   DATABASE_URL=… npm run explain:job-listing -w @jobseek/server -- --analyze
 *
 * Expect `Index Scan using idx_jobs_listing_freshness_at` (or Bitmap) on listingFreshnessAt order.
 * `--analyze` runs the query (read-heavy); omit on production primaries if you prefer.
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { buildDiscoveryWhereSql } from "../src/modules/job/job.repository.js";

loadRootEnv();

async function main(): Promise<void> {
  const analyze = process.argv.includes("--analyze");
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required (load .env at repo root or export it).");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const whereSql = buildDiscoveryWhereSql(undefined, { includeProcessing: false });

  try {
    const rows = analyze
      ? await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT j.id FROM "Job" j
        WHERE ${whereSql}
        ORDER BY j."listingFreshnessAt" DESC, j."createdAt" DESC
        LIMIT 20 OFFSET 0
      `
      : await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN
        SELECT j.id FROM "Job" j
        WHERE ${whereSql}
        ORDER BY j."listingFreshnessAt" DESC, j."createdAt" DESC
        LIMIT 20 OFFSET 0
      `;

    console.log(analyze ? "EXPLAIN (ANALYZE, BUFFERS)" : "EXPLAIN");
    console.log(rows.map((r) => r["QUERY PLAN"]).join("\n"));

    const text = rows.map((r) => r["QUERY PLAN"]).join("\n").toLowerCase();
    const usesFreshnessIdx = text.includes("idx_jobs_listing_freshness_at");
    const seqScan = text.includes("seq scan") && text.includes("job");
    console.log("\n--- hints ---");
    console.log(`idx_jobs_listing_freshness_at mentioned: ${usesFreshnessIdx}`);
    console.log(`possible Seq Scan on Job: ${seqScan}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
