/**
 * Safe recovery of inactive endpoints that are likely still valid.
 *
 * Criteria for recovery:
 *   - lastSuccessAt within 30 days
 *   - failureCount < configurable threshold
 *   - endpoint type is a healthy provider (peer endpoints succeeding)
 *
 * Recovery action: reset failureCount to 0, set isActive=true
 * The endpoint re-enters the normal scheduling pool and will be validated on next crawl.
 *
 * Usage:
 *   npx tsx scripts/ingestion/recoverRecoverableEndpoints.ts [options]
 *
 * Options:
 *   --dry-run             Preview only (default: true)
 *   --no-dry-run          Execute recovery
 *   --limit <n>           Max endpoints to recover (default: 10)
 *   --max-failures <n>    Only recover if failureCount < this (default: 50)
 *   --provider <type>     Only recover this provider
 *   --delay-ms <n>        Delay between updates (default: 300)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CLIOptions {
  dryRun: boolean;
  limit: number;
  maxFailures: number;
  provider: string | null;
  delayMs: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    dryRun: true,
    limit: 10,
    maxFailures: 50,
    provider: null,
    delayMs: 300,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-dry-run") opts.dryRun = false;
    else if (arg === "--limit" && args[i + 1]) opts.limit = Math.max(1, Math.min(100, Number(args[++i]) || 10));
    else if (arg === "--max-failures" && args[i + 1]) opts.maxFailures = Math.max(5, Number(args[++i]) || 50);
    else if (arg === "--provider" && args[i + 1]) opts.provider = args[++i]!;
    else if (arg === "--delay-ms" && args[i + 1]) opts.delayMs = Math.max(50, Number(args[++i]) || 300);
  }

  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs();

  console.log("=== Recover Recoverable Endpoints ===");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Limit: ${opts.limit}`);
  console.log(`  Max failures threshold: ${opts.maxFailures}`);
  console.log(`  Provider filter: ${opts.provider ?? "all"}`);
  console.log("");

  // Check provider health: which providers have active endpoints succeeding?
  const healthyProviders = await prisma.atsEndpoint.groupBy({
    by: ["type"],
    where: {
      isActive: true,
      lastSuccessAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
    _count: { id: true },
  });

  const healthySet = new Set(healthyProviders.filter(p => p._count.id >= 3).map(p => p.type));
  console.log(`Healthy providers (≥3 active endpoints succeeded in 24h): ${[...healthySet].join(", ")}`);
  console.log("");

  const candidates = await prisma.atsEndpoint.findMany({
    where: {
      isActive: false,
      lastSuccessAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
      failureCount: { lt: opts.maxFailures },
      ...(opts.provider ? { type: opts.provider } : {}),
    },
    select: {
      id: true,
      type: true,
      slug: true,
      companyName: true,
      companyId: true,
      failureCount: true,
      successCount: true,
      lastSuccessAt: true,
      lastFailureAt: true,
    },
    orderBy: [{ lastSuccessAt: "desc" }],
    take: opts.limit * 2,
  });

  console.log(`Found ${candidates.length} candidate endpoints for recovery`);

  const stats = {
    recovered: 0,
    skipped_unhealthy_provider: 0,
    skipped_limit: 0,
  };

  for (const ep of candidates) {
    if (stats.recovered >= opts.limit) {
      stats.skipped_limit++;
      continue;
    }

    if (!healthySet.has(ep.type)) {
      stats.skipped_unhealthy_provider++;
      console.log(`  SKIP [unhealthy provider] ${ep.type}/${ep.slug} (${ep.companyName ?? "no company"})`);
      continue;
    }

    const daysSinceSuccess = ep.lastSuccessAt
      ? Math.round((Date.now() - ep.lastSuccessAt.getTime()) / (24 * 3600 * 1000))
      : null;

    console.log(`  [${stats.recovered + 1}] ${opts.dryRun ? "WOULD RECOVER" : "RECOVERING"}: ${ep.type}/${ep.slug}`);
    console.log(`       company: ${ep.companyName ?? ep.companyId ?? "orphan"}`);
    console.log(`       failureCount: ${ep.failureCount}, lastSuccess: ${daysSinceSuccess}d ago`);

    if (!opts.dryRun) {
      await prisma.atsEndpoint.update({
        where: { id: ep.id },
        data: {
          isActive: true,
          failureCount: 0,
        },
      });
      await sleep(opts.delayMs);
    }

    stats.recovered++;
  }

  console.log("\n=== Summary ===");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  Recovered: ${stats.recovered}`);
  console.log(`  Skipped (unhealthy provider): ${stats.skipped_unhealthy_provider}`);
  console.log(`  Skipped (limit reached): ${stats.skipped_limit}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
