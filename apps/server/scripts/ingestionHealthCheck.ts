/**
 * Phase 4/5 ingestion health snapshot. Run from apps/server:
 *   npx tsx scripts/ingestionHealthCheck.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== AtsEndpoint LIMIT 5 ===");
  const ep5 = await prisma.$queryRaw<
    Record<string, unknown>[]
  >`SELECT id, type, slug, "isActive", score, "successCount", "failureCount", "lastCrawledAt", source, "createdAt"
    FROM "AtsEndpoint" LIMIT 5`;
  console.log(JSON.stringify(ep5, null, 2));

  const jobC = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "Job"`;
  console.log("\n=== Job COUNT(*) ===", Number(jobC[0]?.c ?? 0));

  const checks = await prisma.$queryRaw<
    { active: bigint; score_ge_8: bigint; success_gt_0: bigint }[]
  >`SELECT
      COUNT(*) FILTER (WHERE "isActive")::bigint AS active,
      COUNT(*) FILTER (WHERE "isActive" AND score >= 8)::bigint AS score_ge_8,
      COUNT(*) FILTER (WHERE "successCount" > 0)::bigint AS success_gt_0
    FROM "AtsEndpoint"`;
  console.log("\n=== AtsEndpoint (active / score>=8 / successCount>0) ===");
  console.log(JSON.stringify(checks, (_, v) => (typeof v === "bigint" ? Number(v) : v), 2));

  console.log("\n=== SerpResult discoveredAt NOT NULL (10) ===");
  const serp = await prisma.$queryRaw<
    Record<string, unknown>[]
  >`SELECT id, url, "atsType", slug, score, "discoveredAt"
    FROM "SerpResult"
    WHERE "discoveredAt" IS NOT NULL
    LIMIT 10`;
  console.log(JSON.stringify(serp, null, 2));
  const serpDisc = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "SerpResult" WHERE "discoveredAt" IS NOT NULL`;
  console.log("discoveredAt set count:", Number(serpDisc[0]?.c ?? 0));

  console.log("\n=== AtsEndpoint ORDER BY createdAt DESC (10) ===");
  const epNew = await prisma.$queryRaw<
    Record<string, unknown>[]
  >`SELECT id, type, slug, "isActive", score, source, "createdAt"
    FROM "AtsEndpoint"
    ORDER BY "createdAt" DESC
    LIMIT 10`;
  console.log(JSON.stringify(epNew, null, 2));
}

void main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
